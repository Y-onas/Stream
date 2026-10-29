package telegram

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestTransferGateCancellation(t *testing.T) {
	hook := SerialTransfers()
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		_ = hook(context.Background(), nil, func(context.Context) error { close(entered); <-release; return nil })
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	err := hook(ctx, nil, func(context.Context) error { t.Error("overlapping authorization transfer"); return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	close(release)
	<-done
	if err := hook(context.Background(), nil, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
}
