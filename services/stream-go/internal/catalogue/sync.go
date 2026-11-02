package catalogue

import (
	"context"
	"errors"
	"github.com/gotd/td/tg"
	"streamweb/internal/discovery"
	"streamweb/internal/media"
	"time"
)

type Syncer struct {
	Store    *Store
	Fetch    discovery.FetchPage
	Source   media.Source
	PageSize int
}

func (s Syncer) Cycle(ctx context.Context) error {
	err := s.scan(ctx)
	if err == nil {
		err = s.audit(ctx)
	}
	if err != nil {
		_ = s.Store.Update(func(st *State) error { st.LastError = "Telegram synchronization failed; retry scheduled"; return nil })
		return err
	}
	return s.Store.Update(func(st *State) error { st.LastSuccess = time.Now().UTC(); st.LastError = ""; return nil })
}
func (s Syncer) scan(ctx context.Context) error {
	if s.PageSize < 1 || s.PageSize > 100 {
		return errors.New("invalid sync page size")
	}
	if err := s.Store.Update(func(st *State) error {
		if st.Source.ID != 0 && (st.Source.ID != s.Source.ID || st.Source.Kind != s.Source.Kind) {
			return errors.New("source identity changed; use a separate catalogue state")
		}
		st.Source = s.Source
		return nil
	}); err != nil {
		return err
	}
	for {
		st := s.Store.Snapshot()
		page, err := s.Fetch(ctx, st.Offset, s.PageSize)
		if err != nil {
			return err
		}
		next := st.Offset
		high := st.PendingHigh
		done := len(page) == 0
		for _, m := range page {
			if m.GetID() > high {
				high = m.GetID()
			}
			if m.GetID() > 0 && (next == 0 || m.GetID() < next) {
				next = m.GetID()
			}
			if st.InitialComplete && m.GetID() <= st.HighWater {
				done = true
			}
		}
		if !done && next == st.Offset {
			return errors.New("sync pagination made no progress")
		}
		if err = s.Store.Update(func(current *State) error {
			for _, m := range page {
				Upsert(current, m)
			}
			if done {
				current.InitialComplete = true
				current.HighWater = max(current.HighWater, high)
				current.Offset = 0
				current.PendingHigh = 0
			} else {
				current.Offset = next
				current.PendingHigh = high
			}
			return nil
		}); err != nil {
			return err
		}
		if done {
			return nil
		}
		// Pace history calls and propagate shutdown before starting another page.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// One rolling history page per recovery cycle reconciles old metadata without
// repeating a full archive scan on every poll. Live edits are handled immediately.
func (s Syncer) audit(ctx context.Context) error {
	st := s.Store.Snapshot()
	page, err := s.Fetch(ctx, st.AuditOffset, s.PageSize)
	if err != nil {
		return err
	}
	next := 0
	for _, m := range page {
		if m.GetID() > 0 && (next == 0 || m.GetID() < next) {
			next = m.GetID()
		}
	}
	if len(page) > 0 && next == st.AuditOffset {
		return errors.New("audit pagination made no progress")
	}
	return s.Store.Update(func(current *State) error {
		for _, m := range page {
			Upsert(current, m)
		}
		current.AuditOffset = next
		return nil
	})
}
func (s Syncer) Apply(message tg.MessageClass) error {
	return s.Store.Update(func(st *State) error { Upsert(st, message); return nil })
}
