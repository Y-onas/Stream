package discovery

import (
	"context"
	"errors"

	"github.com/gotd/td/tg"
)

type FetchPage func(context.Context, int, int) ([]tg.MessageClass, error)

var ErrMessageMissing = errors.New("message not found in the selected source; it may be deleted or inaccessible")

type Progress struct {
	Inspected  int
	NextOffset int
	Exhausted  bool
}

func History(api *tg.Client, source Source) FetchPage {
	return func(ctx context.Context, offset, limit int) ([]tg.MessageClass, error) {
		result, err := api.MessagesGetHistory(ctx, &tg.MessagesGetHistoryRequest{Peer: source.Peer, OffsetID: offset, Limit: limit})
		if err != nil {
			return nil, err
		}
		switch r := result.(type) {
		case *tg.MessagesMessages:
			return r.Messages, nil
		case *tg.MessagesMessagesSlice:
			return r.Messages, nil
		case *tg.MessagesChannelMessages:
			return r.Messages, nil
		default:
			return nil, errors.New("unexpected message-history response")
		}
	}
}

// Walk retains one page at a time and never inspects more than max messages.
func Walk(ctx context.Context, fetch FetchPage, pageSize, max, offset int, visit func(tg.MessageClass) error) (Progress, error) {
	p := Progress{NextOffset: offset}
	if pageSize < 1 || pageSize > 100 || max < 1 || offset < 0 {
		return p, errors.New("page size must be 1..100, max must be positive, and offset must be nonnegative")
	}
	for p.Inspected < max {
		if err := ctx.Err(); err != nil {
			return p, err
		}
		limit := min(pageSize, max-p.Inspected)
		messages, err := fetch(ctx, p.NextOffset, limit)
		if err != nil {
			return p, err
		}
		if len(messages) == 0 {
			p.Exhausted = true
			return p, nil
		}
		before := p.NextOffset
		for _, message := range messages {
			id := message.GetID()
			if id <= 0 || (p.NextOffset > 0 && id >= p.NextOffset) {
				continue
			}
			if err := visit(message); err != nil {
				return p, err
			}
			p.Inspected++
			p.NextOffset = id
			if p.Inspected == max {
				break
			}
		}
		if p.NextOffset == before {
			return p, errors.New("history pagination made no progress; stopped to avoid repeated requests")
		}
	}
	return p, nil
}

func Inspect(ctx context.Context, fetch FetchPage, id int) (tg.MessageClass, error) {
	if id <= 0 || int64(id) >= 2147483647 {
		return nil, errors.New("message ID must be between 1 and 2147483646")
	}
	items, err := fetch(ctx, id+1, 1)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.GetID() == id {
			if _, empty := item.(*tg.MessageEmpty); !empty {
				return item, nil
			}
		}
	}
	return nil, ErrMessageMissing
}
