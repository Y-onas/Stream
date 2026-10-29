package telegram

import (
	"context"
	"github.com/gotd/td/telegram"
)

// SerialTransfers satisfies gotd's AuthTransferHandler requirement to serialize
// authorization exports/imports for an account. This per-client gate never blocks
// normal file reads or holds the streaming pool's map lock during network calls.
func SerialTransfers() telegram.AuthTransferHandler {
	gate := make(chan struct{}, 1)
	return func(ctx context.Context, _ *telegram.Client, transfer func(context.Context) error) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case gate <- struct{}{}:
		}
		defer func() { <-gate }()
		return transfer(ctx)
	}
}
