package streaming

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
	"streamweb/internal/discovery"
)

type reusableInvoker struct {
	closes atomic.Int32
	invoke func(context.Context, bin.Encoder, bin.Decoder) error
}

func (f *reusableInvoker) Invoke(ctx context.Context, in bin.Encoder, out bin.Decoder) error {
	if f.invoke != nil {
		return f.invoke(ctx, in, out)
	}
	return nil
}
func (f *reusableInvoker) Close() error { f.closes.Add(1); return nil }

func TestSharedPoolSurvivesFirstViewerCancellation(t *testing.T) {
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	invoker := &reusableInvoker{}
	p := &dcPools{lifetime: ctx, entries: make(map[int]*dcEntry), connections: 32, dial: func(setup context.Context, _ int, count int64) (telegram.CloseInvoker, error) {
		calls.Add(1)
		if count != 32 {
			t.Errorf("wrong transport parallelism: %d", count)
		}
		close(entered)
		select {
		case <-release:
			return invoker, nil
		case <-setup.Done():
			return nil, setup.Err()
		}
	}}
	defer p.close()
	viewer, cancel := context.WithCancel(ctx)
	first := make(chan error, 1)
	go func() { _, err := p.get(viewer, 2); first <- err }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatal("viewer cancellation lost", err)
	}
	close(release)
	api, err := p.get(ctx, 2)
	if err != nil {
		t.Fatal("first viewer cancelled shared setup", err)
	}
	other := &TelegramBackend{pools: p}
	other.Close()
	reused, err := p.get(ctx, 2)
	if err != nil || reused != api || calls.Load() != 1 || invoker.closes.Load() != 0 {
		t.Fatal("backend closed or duplicated shared pool", calls.Load(), err)
	}
	p.close()
	p.close()
	if invoker.closes.Load() != 1 {
		t.Fatal("owner did not close exactly once")
	}
}

func TestSharedPoolIndependentReadsAndBackendOwnership(t *testing.T) {
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	entered := make(chan struct{})
	invoker := &reusableInvoker{invoke: func(ctx context.Context, in bin.Encoder, out bin.Decoder) error {
		req := in.(*tg.UploadGetFileRequest)
		id := req.Location.(*tg.InputDocumentFileLocation).ID
		if id == 99 {
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}
		if id != 100 || req.Offset != 4096 {
			return errors.New("reader position mixed")
		}
		out.(*tg.UploadFileBox).File = &tg.UploadFile{Bytes: make([]byte, req.Limit)}
		return nil
	}}
	p := &dcPools{lifetime: ctx, entries: make(map[int]*dcEntry), connections: 32, dial: func(context.Context, int, int64) (telegram.CloseInvoker, error) { return invoker, nil }}
	defer p.close()
	api, err := p.get(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	get := func(ctx context.Context, _ int, req *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		return api.UploadGetFile(ctx, req)
	}
	a := &telegramReader{doc: testDoc(), timeout: time.Second, get: get}
	b := &telegramReader{doc: testDoc(), timeout: time.Second, get: get}
	b.doc.ID = 100
	viewer, cancel := context.WithCancel(ctx)
	defer cancel()
	first := make(chan error, 1)
	go func() { _, err := a.Part(viewer, 0, 4096); first <- err }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if data, err := b.Part(ctx, 4096, 4096); err != nil || len(data) != 4096 {
		t.Fatal("one viewer blocked another", err)
	}
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := b.Part(ctx, 4096, 4096); err != nil {
		t.Fatal("other read cancelled", err)
	}
	if invoker.closes.Load() != 0 {
		t.Fatal("read cancellation closed shared transport")
	}
	owned := &TelegramBackend{pools: p, ownsPools: true}
	owned.Close()
	if invoker.closes.Load() != 1 {
		t.Fatal("CLI-owned backend failed to close pool")
	}
}

func TestSharedPoolFailedSetupCanRetry(t *testing.T) {
	var calls atomic.Int32
	invoker := &reusableInvoker{}
	p := &dcPools{lifetime: context.Background(), entries: make(map[int]*dcEntry), connections: 32, dial: func(context.Context, int, int64) (telegram.CloseInvoker, error) {
		if calls.Add(1) == 1 {
			return nil, ErrUnavailable
		}
		return invoker, nil
	}}
	defer p.close()
	if _, err := p.get(context.Background(), 2); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	if _, err := p.get(context.Background(), 2); err != nil || calls.Load() != 2 {
		t.Fatal("failed setup retained", err)
	}
}

func TestSharedPoolCloseDuringSetup(t *testing.T) {
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	entered, finished := make(chan struct{}), make(chan struct{})
	invoker := &reusableInvoker{}
	baseline := ActiveDCPools()
	p := &dcPools{lifetime: ctx, entries: make(map[int]*dcEntry), connections: 32, dial: func(setup context.Context, _ int, _ int64) (telegram.CloseInvoker, error) {
		close(entered)
		<-setup.Done()
		// Even a dialer returning a late success must not leak a connection.
		return invoker, nil
	}}
	go func() { defer close(finished); _, _ = p.get(ctx, 2) }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	p.mu.Lock()
	entry := p.entries[2]
	p.mu.Unlock()
	p.close()
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal("waiter not released")
	}
	select {
	case <-entry.ready:
	case <-ctx.Done():
		t.Fatal("setup not cancelled")
	}
	// connect closes ready before disposing of a rejected late connection.
	for invoker.closes.Load() == 0 && ctx.Err() == nil {
		time.Sleep(time.Millisecond)
	}
	if invoker.closes.Load() != 1 || ActiveDCPools() != baseline {
		t.Fatal("late connection leaked")
	}
	if _, err := p.get(ctx, 2); !errors.Is(err, context.Canceled) {
		t.Fatal("closed pool reused", err)
	}
}

func TestFileConnectionsValidateOwnerAndRuntimeLifetime(t *testing.T) {
	client := &telegram.Client{}
	for _, count := range []int{0, -1, 257} {
		if _, err := NewFileConnections(context.Background(), client, count); !errors.Is(err, ErrMetadata) {
			t.Fatal("invalid count accepted", count)
		}
	}
	if _, err := NewFileConnections(context.Background(), nil, 32); !errors.Is(err, ErrMetadata) {
		t.Fatal("nil client accepted")
	}
	if _, err := NewFileConnections(nil, client, 32); !errors.Is(err, ErrMetadata) {
		t.Fatal("nil lifetime accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	owner, err := NewFileConnections(ctx, client, 32)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	if _, err := NewTelegramBackendWithConnections(ctx, &telegram.Client{}, discovery.Source{}, 1, owner, time.Second); !errors.Is(err, ErrMetadata) {
		t.Fatal("foreign Telegram client accepted")
	}
	if _, err := NewTelegramBackendWithConnections(ctx, client, discovery.Source{}, 1, nil, time.Second); !errors.Is(err, ErrMetadata) {
		t.Fatal("missing pool accepted")
	}
	invoker := &reusableInvoker{}
	owner.pools.dial = func(context.Context, int, int64) (telegram.CloseInvoker, error) { return invoker, nil }
	if _, err := owner.pools.get(ctx, 2); err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.Now().Add(time.Second)
	for invoker.closes.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if invoker.closes.Load() != 1 {
		t.Fatal("runtime cancellation did not close pools")
	}
	owner.Close()
	if invoker.closes.Load() != 1 {
		t.Fatal("owner closed twice")
	}
	if _, err := NewFileConnections(ctx, client, 32); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled runtime accepted")
	}
}
