package streaming

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
)

var activeDCPools atomic.Int64

func ActiveDCPools() int64 { return activeDCPools.Load() }

// FileConnections owns reusable transports for exactly one Telegram client.
// It contains no video bytes, playback grants, or shared reader positions.
type FileConnections struct {
	client *telegram.Client
	pools  *dcPools
	stop   func() bool
}

func NewFileConnections(ctx context.Context, client *telegram.Client, connections int) (*FileConnections, error) {
	if ctx == nil || client == nil || connections < 1 || connections > 256 {
		return nil, ErrMetadata
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	pools := newDCPools(client, connections)
	pools.lifetime = ctx
	owner := &FileConnections{client: client, pools: pools}
	owner.stop = context.AfterFunc(ctx, pools.close)
	return owner, nil
}

func (c *FileConnections) Close() {
	c.stop()
	c.pools.close()
}

// The mutex protects the map only, never network calls. Multiple viewers share
// transports, not a stream; pool contention waits for a connection rather than
// admitting/rejecting playback sessions using a global viewer counter.
type dcEntry struct {
	ready  chan struct{}
	cancel context.CancelFunc
	pool   telegram.CloseInvoker
	api    *tg.Client
	err    error
}
type dcPools struct {
	mu          sync.Mutex
	entries     map[int]*dcEntry
	closed      bool
	done        chan struct{}
	lifetime    context.Context
	dial        func(context.Context, int, int64) (telegram.CloseInvoker, error)
	connections int64
}

func newDCPools(client *telegram.Client, connections int) *dcPools {
	return &dcPools{entries: make(map[int]*dcEntry), connections: int64(connections), dial: func(ctx context.Context, dc int, max int64) (telegram.CloseInvoker, error) {
		if dc == client.Config().ThisDC {
			return client.Pool(max)
		}
		return client.DC(ctx, dc, max)
	}}
}

func (p *dcPools) get(ctx context.Context, dc int) (*tg.Client, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, context.Canceled
	}
	if p.done == nil {
		p.done = make(chan struct{})
	}
	e, exists := p.entries[dc]
	if !exists && len(p.entries) >= 8 {
		p.mu.Unlock()
		return nil, ErrUnavailable
	}
	if !exists {
		// Setup belongs to the runtime, not its first viewer. A viewer leaving must
		// not poison connection setup for other waiting requests.
		parent := p.lifetime
		if parent == nil {
			// The development CLI owns its pool separately.
			parent = ctx
		}
		setup, cancel := context.WithTimeout(parent, 20*time.Second)
		e = &dcEntry{ready: make(chan struct{}), cancel: cancel}
		p.entries[dc] = e
		go p.connect(setup, dc, e)
	}
	done := p.done
	p.mu.Unlock()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-done:
		return nil, context.Canceled
	case <-e.ready:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return e.api, e.err
	}
}

func (p *dcPools) connect(ctx context.Context, dc int, e *dcEntry) {
	defer e.cancel()
	connection, err := p.dial(ctx, dc, p.connections)
	if err == nil {
		err = ctx.Err()
	}
	p.mu.Lock()
	if p.closed && err == nil {
		err = context.Canceled
	}
	e.err = err
	if err == nil {
		e.pool = connection
		activeDCPools.Add(1)
		e.api = tg.NewClient(connection)
	} else {
		delete(p.entries, dc)
	}
	close(e.ready)
	p.mu.Unlock()
	if err != nil && connection != nil {
		_ = connection.Close()
	}
}

func (p *dcPools) close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	if p.done != nil {
		close(p.done)
	}
	var connections []telegram.CloseInvoker
	for _, e := range p.entries {
		if e.cancel != nil {
			e.cancel()
		}
		if e.pool != nil {
			connections = append(connections, e.pool)
			activeDCPools.Add(-1)
		}
	}
	p.mu.Unlock()
	for _, connection := range connections {
		_ = connection.Close()
	}
}
