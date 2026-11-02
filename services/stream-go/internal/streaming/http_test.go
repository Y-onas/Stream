package streaming

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type partFunc func(context.Context, int64, int) ([]byte, error)

func (f partFunc) Part(ctx context.Context, offset int64, limit int) ([]byte, error) {
	return f(ctx, offset, limit)
}

type providerFunc func(context.Context) (File, PartReader, error)

func (f providerFunc) Open(ctx context.Context) (File, PartReader, error) { return f(ctx) }

func fixture() []byte {
	data := make([]byte, 2*TelegramWindow+57)
	for i := range data {
		data[i] = byte((i*17 + i/257) % 251)
	}
	return data
}
func fakeProvider(data []byte, calls *atomic.Int32) Provider {
	return providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 99, Size: int64(len(data)), MIME: "video/mp4"}, partFunc(func(ctx context.Context, offset int64, limit int) ([]byte, error) {
			calls.Add(1)
			if offset%4096 != 0 || TelegramWindow%limit != 0 || offset%TelegramWindow+int64(limit) > TelegramWindow {
				return nil, errors.New("invalid Telegram request")
			}
			return data[offset:min(offset+int64(limit), int64(len(data)))], ctx.Err()
		}), nil
	})
}
func handler(t *testing.T, p Provider) *Handler {
	t.Helper()
	h, err := NewHandler(p, HTTPOptions{MessageID: 7, Host: "127.0.0.1:8080", ChunkSize: 4096, Concurrency: 1, RequestTimeout: time.Second, WriteTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func call(h *Handler, method, value string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8080/media/stream/7", nil)
	if value != "" {
		r.Header.Set("Range", value)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestHTTPExactBytesAndHeaders(t *testing.T) {
	data := fixture()
	var calls atomic.Int32
	h := handler(t, fakeProvider(data, &calls))
	for _, tc := range []struct {
		rangeValue string
		start, end int
		status     int
	}{
		{"", 0, len(data) - 1, 200}, {"bytes=100-199", 100, 199, 206}, {"bytes=4090-4105", 4090, 4105, 206},
		{"bytes=1048570-1048590", 1048570, 1048590, 206}, {"bytes=2097180-", 2097180, len(data) - 1, 206}, {"bytes=-17", len(data) - 17, len(data) - 1, 206},
	} {
		w := call(h, "GET", tc.rangeValue)
		if w.Code != tc.status || !bytes.Equal(w.Body.Bytes(), data[tc.start:tc.end+1]) {
			t.Fatalf("range %q: status=%d length=%d", tc.rangeValue, w.Code, w.Body.Len())
		}
		if w.Header().Get("Content-Type") != "video/mp4" || w.Header().Get("Accept-Ranges") != "bytes" || w.Result().ContentLength != int64(tc.end-tc.start+1) {
			t.Fatal(w.Header())
		}
		if tc.status == 206 && w.Header().Get("Content-Range") == "" {
			t.Fatal("missing content range")
		}
	}
	before := calls.Load()
	w := call(h, "HEAD", "bytes=0-10")
	if w.Code != 200 || w.Body.Len() != 0 || w.Result().ContentLength != int64(len(data)) || calls.Load() != before || w.Header().Get("Content-Range") != "" {
		t.Fatal("HEAD retrieved bytes or returned incorrect metadata")
	}
}

func TestHTTPErrorsAndSecurity(t *testing.T) {
	data := fixture()
	var calls atomic.Int32
	h := handler(t, fakeProvider(data, &calls))
	for _, value := range []string{"bytes=5-1", "bytes=999999999-", "bytes=1-2,5-6", "garbage"} {
		w := call(h, "GET", value)
		if w.Code != 416 || !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes */") {
			t.Fatal(w.Code, w.Header())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid ranges fetched media")
	}
	for _, tc := range []struct {
		method, url, host, origin, site string
		status                          int
	}{
		{"POST", "/media/stream/7", "127.0.0.1:8080", "", "", 405},
		{"GET", "/media/stream/8", "127.0.0.1:8080", "", "", 404},
		{"GET", "/media/stream/7?peer=1", "127.0.0.1:8080", "", "", 400},
		{"GET", "/media/stream/7", "evil.example", "", "", 403},
		{"GET", "/media/stream/7", "127.0.0.1:8080", "https://evil.example", "", 403},
		{"GET", "/media/stream/7", "127.0.0.1:8080", "", "cross-site", 403},
	} {
		r := httptest.NewRequest(tc.method, "http://"+tc.host+tc.url, nil)
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Sec-Fetch-Site", tc.site)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%+v => %d", tc, w.Code)
		}
	}
}

func TestMetadataAndUpstreamErrorsBeforeHeaders(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
	}{{ErrNotFound, 404}, {ErrUnsupported, 415}, {ErrMetadata, 422}, {ErrChanged, 409}, {ErrRateLimited, 503}, {context.DeadlineExceeded, 504}, {errors.New("sensitive upstream detail"), 502}} {
		h := handler(t, providerFunc(func(context.Context) (File, PartReader, error) { return File{}, nil, tc.err }))
		w := call(h, "GET", "")
		if w.Code != tc.status || strings.Contains(w.Body.String(), "sensitive") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	h := handler(t, providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 1, Size: 0}, nil, nil
	}))
	if call(h, "GET", "").Code != 422 {
		t.Fatal("unknown size accepted")
	}
	h = handler(t, providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 1, Size: 4096}, partFunc(func(context.Context, int64, int) ([]byte, error) { return nil, ErrUnavailable }), nil
	}))
	if call(h, "GET", "bytes=0-10").Code != 502 {
		t.Fatal("first-part failure was reported as success")
	}
	h = handler(t, providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 1, Size: 4096}, partFunc(func(context.Context, int64, int) ([]byte, error) { return make([]byte, 4096), nil }), nil
	}))
	if call(h, "GET", "bytes=0-10").Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatal("missing MIME was fabricated")
	}
}

func TestLateFailureAbortsWithoutSecondStatus(t *testing.T) {
	var calls atomic.Int32
	p := providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 1, Size: 8192, MIME: "video/mp4"}, partFunc(func(context.Context, int64, int) ([]byte, error) {
			if calls.Add(1) == 1 {
				return make([]byte, 4096), nil
			}
			return nil, ErrUnavailable
		}), nil
	})
	h := handler(t, p)
	server := httptest.NewServer(h)
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL+"/media/stream/7", nil)
	req.Host = h.opts.Host
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !errors.Is(err, io.ErrUnexpectedEOF) || len(data) != 4096 {
		t.Fatalf("status=%d bytes=%d err=%v", response.StatusCode, len(data), err)
	}
}

func TestCancellationAndConcurrency(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	h := handler(t, providerFunc(func(ctx context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 1, Size: 4096}, partFunc(func(ctx context.Context, _ int64, _ int) ([]byte, error) {
			close(started)
			<-ctx.Done()
			close(stopped)
			return nil, ctx.Err()
		}), nil
	}))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("GET", "http://127.0.0.1:8080/media/stream/7", nil).WithContext(ctx)
	done := make(chan struct{})
	go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), req) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("upstream never started")
	}
	if call(h, "GET", "").Code != 503 {
		t.Fatal("concurrency limit not enforced")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("upstream ignored cancellation")
	}
	<-done
}

func TestShortReadAndAlignedSlice(t *testing.T) {
	p := partFunc(func(_ context.Context, offset int64, limit int) ([]byte, error) {
		if offset != 4096 || limit != 4096 {
			t.Fatal(offset, limit)
		}
		return fixture()[4096:8192], nil
	})
	got, err := ReadChunk(context.Background(), p, 10000, 4100, 4107, 4096)
	if err != nil || !bytes.Equal(got, fixture()[4100:4108]) {
		t.Fatal("aligned slice incorrect")
	}
	p = partFunc(func(context.Context, int64, int) ([]byte, error) { return []byte{1, 2}, nil })
	if _, err := ReadChunk(context.Background(), p, 10000, 0, 1, 4096); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("unexpected short read silently accepted")
	}
}
