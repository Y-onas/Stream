package streaming

import (
	"context"
	"sync"

	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
)

// Connections reuse the existing authorized client through gotd's DC pool API.
// The mutex protects the map only, never a network call. The HTTP handler bounds
// simultaneous requests; each request performs one Telegram operation at a time.
type dcEntry struct {
	ready chan struct{}
	pool  telegram.CloseInvoker
	api   *tg.Client
	err   error
}
type dcPools struct {
	mu          sync.Mutex
	entries     map[int]*dcEntry
	closed      bool
	dial        func(context.Context, int, int64) (telegram.CloseInvoker, error)
	connections int64
}

func newDCPools(client *telegram.Client, connections int) *dcPools {
	return &dcPools{entries: make(map[int]*dcEntry), dial: func(ctx context.Context, dc int, max int64) (telegram.CloseInvoker, error) {
		if dc == client.Config().ThisDC {
			return client.Pool(max)
		}
		return client.DC(ctx, dc, max)
	}, connections: int64(connections)}
}

func (p *dcPools) get(ctx context.Context, dc int) (*tg.Client, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, context.Canceled
	}
	if e, ok := p.entries[dc]; ok {
		p.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-e.ready:
			return e.api, e.err
		}
	}
	if len(p.entries) >= 8 {
		p.mu.Unlock()
		return nil, ErrUnavailable
	}
	e := &dcEntry{ready: make(chan struct{})}
	p.entries[dc] = e
	p.mu.Unlock()
	connection, err := p.dial(ctx, dc, p.connections)
	p.mu.Lock()
	if p.closed && err == nil {
		err = context.Canceled
	}
	e.err = err
	if err == nil {
		e.pool = connection
		e.api = tg.NewClient(connection)
	} else {
		delete(p.entries, dc)
	}
	close(e.ready)
	p.mu.Unlock()
	if err != nil && connection != nil {
		_ = connection.Close()
	}
	return e.api, e.err
}

func (p *dcPools) close() {
	p.mu.Lock()
	p.closed = true
	var connections []telegram.CloseInvoker
	for _, e := range p.entries {
		if e.pool != nil {
			connections = append(connections, e.pool)
		}
	}
	p.mu.Unlock()
	for _, connection := range connections {
		_ = connection.Close()
	}
}
