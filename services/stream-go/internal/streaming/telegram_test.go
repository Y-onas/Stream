package streaming

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
	"github.com/gotd/td/tgerr"
	"streamweb/internal/media"
)

func testDoc() *tg.Document {
	return &tg.Document{ID: 99, AccessHash: 77, FileReference: []byte("old"), DCID: 2, Size: 8192, MimeType: "video/mp4"}
}

func TestDocumentValidation(t *testing.T) {
	d := testDoc()
	message := &tg.Message{ID: 7, Media: &tg.MessageMediaDocument{Document: d}}
	if _, err := videoDocument(message, media.Source{}); err != nil {
		t.Fatal(err)
	}
	d.MimeType = "application/pdf"
	if _, err := videoDocument(message, media.Source{}); !errors.Is(err, ErrUnsupported) {
		t.Fatal("generic document accepted")
	}
	d.MimeType = ""
	d.Attributes = []tg.DocumentAttributeClass{&tg.DocumentAttributeFilename{FileName: "movie.mkv"}}
	if _, err := videoDocument(message, media.Source{}); err != nil {
		t.Fatal("video filename with missing MIME rejected")
	}
	d.Size = 0
	if _, err := videoDocument(message, media.Source{}); !errors.Is(err, ErrMetadata) {
		t.Fatal("unknown size accepted")
	}
	d.Size = 100
	d.FileReference = nil
	if _, err := videoDocument(message, media.Source{}); !errors.Is(err, ErrMetadata) {
		t.Fatal("missing reference accepted")
	}
}

func TestFileReferenceRefreshAndMigration(t *testing.T) {
	calls, refreshes := 0, 0
	r := &telegramReader{doc: testDoc(), timeout: time.Second}
	r.resolve = func(context.Context) (*tg.Document, error) {
		refreshes++
		d := testDoc()
		d.FileReference = []byte("new")
		return d, nil
	}
	r.get = func(_ context.Context, dc int, req *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		calls++
		if req.Offset != 4096 || req.Limit != 4096 || req.Precise || req.CDNSupported {
			t.Fatal("incorrect file part request")
		}
		location := req.Location.(*tg.InputDocumentFileLocation)
		if location.ID != 99 || location.AccessHash != 77 || location.ThumbSize != "" {
			t.Fatal("incorrect document location")
		}
		switch calls {
		case 1:
			return nil, tgerr.New(400, "FILE_REFERENCE_EXPIRED")
		case 2:
			if !bytes.Equal(location.FileReference, []byte("new")) {
				t.Fatal("stale reference reused")
			}
			return nil, tgerr.New(303, "FILE_MIGRATE_4")
		default:
			if dc != 4 {
				t.Fatal("wrong migrated data center")
			}
			return &tg.UploadFile{Bytes: make([]byte, 4096)}, nil
		}
	}
	data, err := r.Part(context.Background(), 4096, 4096)
	if err != nil || len(data) != 4096 || calls != 3 || refreshes != 1 {
		t.Fatal(calls, refreshes, err)
	}
}

func TestRetryLimitsAndChangedDocument(t *testing.T) {
	for _, failure := range []error{tgerr.New(500, "INTERNAL"), tgerr.New(420, "FLOOD_WAIT_100")} {
		calls := 0
		r := &telegramReader{doc: testDoc(), timeout: time.Second, get: func(context.Context, int, *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
			calls++
			return nil, failure
		}}
		if _, err := r.Part(context.Background(), 0, 4096); err == nil {
			t.Fatal("error hidden")
		}
		want := 2
		if tgerr.Is(failure, "FLOOD_WAIT") {
			want = 1
		}
		if calls != want {
			t.Fatalf("retry count %d != %d", calls, want)
		}
	}
	r := &telegramReader{doc: testDoc(), timeout: time.Second, get: func(context.Context, int, *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		return nil, tgerr.New(400, "FILE_REFERENCE_EXPIRED")
	}, resolve: func(context.Context) (*tg.Document, error) { d := testDoc(); d.ID++; return d, nil }}
	if _, err := r.Part(context.Background(), 0, 4096); !errors.Is(err, ErrChanged) {
		t.Fatal("file replacement silently mixed into response")
	}
	calls := 0
	r = &telegramReader{doc: testDoc(), timeout: time.Second, get: func(context.Context, int, *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		calls++
		return &tg.UploadFile{Bytes: []byte{1}}, nil
	}}
	if _, err := r.Part(context.Background(), 0, 4096); err == nil || calls != 2 {
		t.Fatal("short read retry unbounded or silently accepted")
	}
}

func TestPartTimeoutAndCDN(t *testing.T) {
	r := &telegramReader{doc: testDoc(), timeout: 10 * time.Millisecond, get: func(ctx context.Context, _ int, _ *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	if _, err := r.Part(context.Background(), 0, 4096); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	r.get = func(context.Context, int, *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		return &tg.UploadFileCDNRedirect{}, nil
	}
	if _, err := r.Part(context.Background(), 0, 4096); !errors.Is(err, ErrCDN) {
		t.Fatal("unexpected CDN redirect treated as media")
	}
}

type fakeInvoker struct{ closed atomic.Bool }

func (*fakeInvoker) Invoke(context.Context, bin.Encoder, bin.Decoder) error { return nil }
func (f *fakeInvoker) Close() error                                         { f.closed.Store(true); return nil }

func TestPoolDoesNotLockDuringNetworkOrDuplicateDC(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	invoker := &fakeInvoker{}
	p := &dcPools{entries: make(map[int]*dcEntry), connections: 1, dial: func(ctx context.Context, dc int, _ int64) (telegram.CloseInvoker, error) {
		calls.Add(1)
		if dc == 2 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return invoker, nil
	}}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := p.get(context.Background(), 2); err != nil {
			t.Error(err)
		}
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := p.get(ctx, 4); err != nil {
		t.Fatal("other DC blocked by global lock", err)
	}
	waitCtx, stop := context.WithCancel(context.Background())
	stop()
	if _, err := p.get(waitCtx, 2); !errors.Is(err, context.Canceled) {
		t.Fatal("pool wait ignored cancellation")
	}
	close(release)
	wg.Wait()
	if _, err := p.get(ctx, 2); err != nil || calls.Load() != 2 {
		t.Fatal("duplicate pool", err)
	}
	p.close()
	if !invoker.closed.Load() {
		t.Fatal("pool not closed")
	}
}
