package streaming

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

type observedWrite struct {
	*httptest.ResponseRecorder
	first   int
	largest int
}

func (w *observedWrite) Write(p []byte) (int, error) {
	if w.first == 0 {
		w.first = len(p)
	}
	w.largest = max(w.largest, len(p))
	return w.ResponseRecorder.Write(p)
}

func growingHandler(t *testing.T, provider Provider) *Handler {
	t.Helper()
	h, err := NewHandler(provider, HTTPOptions{Host: "127.0.0.1:8080", MessageID: 7, ChunkSize: 256 * 1024, SteadyChunkSize: TelegramWindow, Concurrency: 1, RequestTimeout: time.Second, WriteTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestSmallStartupThenLargerParts(t *testing.T) {
	data := make([]byte, 4*TelegramWindow)
	for i := range data {
		data[i] = byte((i*17 + i/257) % 251)
	}
	type part struct {
		offset int64
		size   int
	}
	var parts []part
	p := providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 99, Size: int64(len(data))}, partFunc(func(_ context.Context, offset int64, size int) ([]byte, error) {
			if offset%4096 != 0 || TelegramWindow%size != 0 || offset%TelegramWindow+int64(size) > TelegramWindow {
				t.Fatal("invalid Telegram part", offset, size)
			}
			parts = append(parts, part{offset, size})
			return data[offset:min(offset+int64(size), int64(len(data)))], nil
		}), nil
	})
	h := growingHandler(t, p)
	w := &observedWrite{ResponseRecorder: httptest.NewRecorder()}
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:8080/media/stream/7", nil))
	if w.first != 64*1024 || w.largest > 64*1024 || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatal("startup part enlarged or output corrupted", w.first)
	}
	if len(parts) != 5 || parts[0].size != 256*1024 || parts[1].size != TelegramWindow {
		t.Fatalf("expected five RPCs instead of sixteen 256 KiB RPCs: %+v", parts)
	}
	for _, value := range []string{"bytes=101-200", "bytes=65530-65540", "bytes=1048570-1048590", "bytes=300123-3500000", "bytes=-17"} {
		parts = nil
		rangeValue, err := ParseRange(value, int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		response := call(h, "GET", value)
		if response.Code != 206 || !bytes.Equal(response.Body.Bytes(), data[rangeValue.Start:rangeValue.End+1]) {
			t.Fatal("range changed", value)
		}
		if rangeValue.Length() < TelegramWindow {
			for _, request := range parts {
				if request.size != 256*1024 {
					t.Fatal("small range fetched a large part", parts)
				}
			}
		}
	}
	parts = nil
	if call(h, "HEAD", "").Code != 200 || len(parts) != 0 {
		t.Fatal("HEAD fetched media")
	}
}

func TestCancellationStopsGrowingPart(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	p := providerFunc(func(context.Context) (File, PartReader, error) {
		return File{MessageID: 7, DocumentID: 99, Size: 4 * TelegramWindow}, partFunc(func(ctx context.Context, _ int64, size int) ([]byte, error) {
			if size == TelegramWindow {
				close(started)
				<-ctx.Done()
				close(stopped)
				return nil, ctx.Err()
			}
			return make([]byte, size), nil
		}), nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := growingHandler(t, p)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() { _ = recover() }()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "http://127.0.0.1:8080/media/stream/7", nil).WithContext(ctx))
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("large read did not start")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("large read ignored cancellation")
	}
	<-done
}

func TestInvalidSteadyPartSizeRejected(t *testing.T) {
	for _, size := range []int{-1, 300000, 2 * TelegramWindow, 4096} {
		_, err := NewHandler(providerFunc(func(context.Context) (File, PartReader, error) { return File{}, nil, errors.New("unused") }), HTTPOptions{Host: "127.0.0.1:8080", MessageID: 7, ChunkSize: 64 * 1024, SteadyChunkSize: size, Concurrency: 1, RequestTimeout: time.Second, WriteTimeout: time.Second})
		if err == nil {
			t.Fatal("invalid steady part accepted", size)
		}
	}
}
