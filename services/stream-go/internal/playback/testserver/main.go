// Development-only integration fixture. Never built into the production image.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"streamweb/internal/playback"
	"streamweb/internal/streaming"
	"strings"
	"time"
)

type provider struct {
	data  []byte
	delay time.Duration
}

func (p provider) Open(context.Context) (streaming.File, streaming.PartReader, error) {
	return streaming.File{MessageID: 7, DocumentID: 99, Size: int64(len(p.data)), MIME: "video/mp4"}, p, nil
}
func (p provider) Part(ctx context.Context, offset int64, limit int) ([]byte, error) {
	if p.delay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(p.delay):
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if offset >= int64(len(p.data)) {
		return nil, nil
	}
	return p.data[offset:min(offset+int64(limit), int64(len(p.data)))], nil
}
func main() {
	address := flag.String("listen", "127.0.0.1:0", "loopback test listener")
	check := flag.String("check-url", "", "private test callback")
	pub := flag.String("public-key", "", "test public key file")
	media := flag.String("media", "", "optional disposable video fixture")
	partDelay := flag.Duration("part-delay", 0, "test-only delay for cancellation checks")
	flag.Parse()
	if !strings.HasPrefix(*address, "127.0.0.1:") {
		panic("loopback only")
	}
	token := os.Getenv("STREAM_SERVICE_TOKEN")
	key, err := os.ReadFile(*pub)
	if err != nil {
		panic("test key unavailable")
	}
	verifier, err := playback.New(key, "habeshan-hub", "habeshan-stream", *check, token, 25*time.Millisecond)
	if err != nil {
		panic("test configuration invalid")
	}
	data := make([]byte, 2*1024*1024+57)
	for i := range data {
		data[i] = byte(i % 251)
	}
	if *media != "" {
		data, err = os.ReadFile(*media)
		if err != nil || len(data) > 4*1024*1024 {
			panic("invalid disposable fixture")
		}
	}
	stream, err := streaming.NewHandler(provider{data: data, delay: *partDelay}, streaming.HTTPOptions{TrustedInternal: true, MessageID: 7, ChunkSize: 4096, Concurrency: 4, RequestTimeout: time.Minute, WriteTimeout: time.Second})
	if err != nil {
		panic(err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/readyz" {
			json.NewEncoder(w).Encode(map[string]bool{"ready": true})
			return
		}
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/internal/videos/"), "/stream")
		ctx, stop, _, err := verifier.Open(r.Context(), w, r.Header.Get("X-Playback-Grant"), id)
		if err != nil {
			status := 401
			var denied playback.Denied
			if errors.As(err, &denied) {
				status = denied.Status
			}
			w.WriteHeader(status)
			return
		}
		defer stop()
		request := r.Clone(ctx)
		u := *r.URL
		request.URL = &u
		request.URL.Path = "/media/stream/7"
		stream.ServeHTTP(w, request)
	})
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		panic(err)
	}
	fmt.Println("http://" + listener.Addr().String())
	http.Serve(listener, handler)
}
