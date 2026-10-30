package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gotd/td/telegram"
	"streamweb/internal/discovery"
	"streamweb/internal/streaming"
)

type serveOptions struct {
	address                                   string
	messageID, chunk, concurrency             int
	setupTimeout, partTimeout, requestTimeout time.Duration
	verify                                    bool
}

func serve(ctx context.Context, client *telegram.Client, source discovery.Source, opts serveOptions) error {
	setup, cancel := context.WithTimeout(ctx, opts.setupTimeout)
	backend, err := streaming.NewTelegramBackend(setup, client, source, opts.messageID, opts.concurrency, opts.partTimeout)
	cancel()
	if err != nil {
		return fmt.Errorf("select video: %s", streaming.SafeError(err))
	}
	defer backend.Close()
	handler, err := streaming.NewHandler(backend, streaming.HTTPOptions{MessageID: opts.messageID, Host: opts.address, ChunkSize: opts.chunk, Concurrency: opts.concurrency, RequestTimeout: opts.requestTimeout, WriteTimeout: 15 * time.Second, Logger: log.New(os.Stderr, "", log.LstdFlags)})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", opts.address)
	if err != nil {
		return errors.New("cannot bind local stream address; check whether the port is already in use")
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }}
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	defer func() {
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
		}
	}()
	url := fmt.Sprintf("http://%s/media/stream/%d", opts.address, opts.messageID)
	fmt.Printf("Development-only stream: %s\nSelected source: %q; message: %d\nNo public playback authorization. Loopback access only. No media cache.\n", url, source.Info.Name, opts.messageID)
	if opts.verify {
		checkCtx, stop := context.WithTimeout(ctx, 5*time.Minute)
		defer stop()
		return backend.VerifyHTTP(checkCtx, url, opts.chunk, os.Stdout)
	}
	select {
	case <-ctx.Done():
		return nil
	case err := <-result:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("local streaming server stopped unexpectedly")
		}
		return nil
	}
}
