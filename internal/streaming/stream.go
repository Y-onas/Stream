package streaming

import (
	"context"
	"errors"
	"fmt"
	"io"
)

const TelegramWindow = 1024 * 1024

var (
	ErrNotFound    = errors.New("selected message is missing or inaccessible")
	ErrUnsupported = errors.New("selected message is not a supported video document")
	ErrMetadata    = errors.New("video has missing or invalid file metadata")
	ErrChanged     = errors.New("selected document changed; restart the service and select it again")
	ErrUnavailable = errors.New("Telegram file retrieval failed; check account access and network connectivity")
	ErrReference   = errors.New("Telegram file reference could not be refreshed; reselect the message")
	ErrCDN         = errors.New("unexpected Telegram CDN redirect; this module supports origin-DC retrieval only")
	ErrRateLimited = errors.New("Telegram rate limit reached; wait before retrying")
)

type File struct {
	MessageID  int
	DocumentID int64
	Size       int64
	MIME       string
}

func (f File) ETag() string { return fmt.Sprintf(`"tg-%d-%d"`, f.DocumentID, f.Size) }

// Provider resolves the CLI-selected message for each request. PartReader is
// private to that request: mutable file references are never shared by handlers.
type Provider interface {
	Open(context.Context) (File, PartReader, error)
}
type PartReader interface {
	Part(context.Context, int64, int) ([]byte, error)
}

func ValidateChunk(size int) error {
	if size < 4096 || size > TelegramWindow || TelegramWindow%size != 0 {
		return errors.New("chunk size must be a power of two from 4096 through 1048576 bytes")
	}
	return nil
}

// ReadChunk aligns down to the configured Telegram part boundary, then returns
// only the intersection with the HTTP range. A part never crosses a 1 MiB window.
func ReadChunk(ctx context.Context, reader PartReader, fileSize, position, end int64, chunkSize int) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := ValidateChunk(chunkSize); err != nil {
		return nil, err
	}
	if position < 0 || end < position || end >= fileSize {
		return nil, ErrRange
	}
	base := position / int64(chunkSize) * int64(chunkSize)
	part, err := reader.Part(ctx, base, chunkSize)
	if err != nil {
		return nil, err
	}
	expected := min(int64(chunkSize), fileSize-base)
	if int64(len(part)) != expected {
		return nil, io.ErrUnexpectedEOF
	}
	start := position - base
	length := min(int64(len(part))-start, end-position+1)
	return part[start : start+length], nil
}
