package telegram

import (
	"context"
	"errors"
	"fmt"

	"github.com/gotd/td/tgerr"
)

// Explain intentionally never includes the raw MTProto error or session data.
func Explain(err error) string {
	if errors.Is(err, ErrInteractive) {
		return ErrInteractive.Error()
	}
	if errors.Is(err, context.Canceled) {
		return "operation canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "operation timed out; check connectivity or increase -timeout"
	}
	if rpc, ok := tgerr.As(err); ok {
		switch rpc.Type {
		case "API_ID_INVALID", "API_ID_PUBLISHED_FLOOD":
			return "Telegram rejected the API credentials; check TELEGRAM_API_ID and TELEGRAM_API_HASH"
		case "PHONE_NUMBER_INVALID":
			return "invalid phone number; include its country code"
		case "PHONE_CODE_INVALID", "PHONE_CODE_EMPTY":
			return "Telegram rejected the login code; run again and enter the current code"
		case "PHONE_CODE_EXPIRED":
			return "login code expired; run again to request a fresh code"
		case "PASSWORD_HASH_INVALID":
			return "incorrect two-step verification password"
		case "AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "SESSION_EXPIRED", "AUTH_KEY_DUPLICATED":
			return "Telegram session is expired or revoked; run with a new -session path to authenticate again"
		case "CHANNEL_PRIVATE", "CHANNEL_INVALID", "CHAT_FORBIDDEN", "PEER_ID_INVALID":
			return "the selected source is inaccessible; check account membership and history permissions"
		case "FLOOD_WAIT", "FLOOD_PREMIUM_WAIT", "PHONE_NUMBER_FLOOD":
			return fmt.Sprintf("Telegram rate-limited this request (wait value: %d seconds); stop and retry later", rpc.Argument)
		default:
			return "Telegram rejected the request; check account access and retry later"
		}
	}
	return "Telegram operation failed; check network/proxy access, session-file permissions, and whether this terminal supports interactive login"
}
