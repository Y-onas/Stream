package streaming

import (
	"context"
	"errors"
	"io"
	"net"
	"time"

	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
	"github.com/gotd/td/tgerr"
	"streamweb/internal/discovery"
	"streamweb/internal/media"
)

type resolveDocument func(context.Context) (*tg.Document, error)
type getPart func(context.Context, int, *tg.UploadGetFileRequest) (tg.UploadFileClass, error)

type TelegramBackend struct {
	selected    File
	resolve     resolveDocument
	get         getPart
	pools       *dcPools
	partTimeout time.Duration
}

func NewTelegramBackend(ctx context.Context, client *telegram.Client, source discovery.Source, messageID, concurrency int, partTimeout time.Duration) (*TelegramBackend, error) {
	if concurrency < 1 || concurrency > 8 || partTimeout <= 0 {
		return nil, ErrMetadata
	}
	resolve := func(ctx context.Context) (*tg.Document, error) {
		message, err := discovery.Inspect(ctx, discovery.History(client.API(), source), messageID)
		if errors.Is(err, discovery.ErrMessageMissing) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, classifyTelegramError(err)
		}
		return videoDocument(message, source.Info)
	}
	doc, err := resolve(ctx)
	if err != nil {
		return nil, err
	}
	pools := newDCPools(client, concurrency)
	backend := &TelegramBackend{selected: fileInfo(messageID, doc), resolve: resolve, pools: pools, partTimeout: partTimeout}
	backend.get = func(ctx context.Context, dc int, request *tg.UploadGetFileRequest) (tg.UploadFileClass, error) {
		api, err := pools.get(ctx, dc)
		if err != nil {
			return nil, err
		}
		return api.UploadGetFile(ctx, request)
	}
	return backend, nil
}

func videoDocument(message tg.MessageClass, source media.Source) (*tg.Document, error) {
	if media.Extract(message, source).MediaType != "video" {
		return nil, ErrUnsupported
	}
	m, ok := message.(*tg.Message)
	if !ok {
		return nil, ErrUnsupported
	}
	attachment, ok := m.Media.(*tg.MessageMediaDocument)
	if !ok {
		return nil, ErrUnsupported
	}
	doc, ok := attachment.Document.(*tg.Document)
	if !ok {
		return nil, ErrMetadata
	}
	if doc.ID == 0 || doc.AccessHash == 0 || len(doc.FileReference) == 0 || doc.DCID <= 0 || doc.Size <= 0 {
		return nil, ErrMetadata
	}
	return doc, nil
}

func fileInfo(messageID int, doc *tg.Document) File {
	return File{MessageID: messageID, DocumentID: doc.ID, Size: doc.Size, MIME: NormalizeMIME(doc.MimeType)}
}

func (b *TelegramBackend) Open(ctx context.Context) (File, PartReader, error) {
	ctx, cancel := context.WithTimeout(ctx, b.partTimeout)
	defer cancel()
	doc, err := b.resolve(ctx)
	if err != nil {
		return File{}, nil, err
	}
	if doc.ID != b.selected.DocumentID || doc.Size != b.selected.Size {
		return File{}, nil, ErrChanged
	}
	return fileInfo(b.selected.MessageID, doc), &telegramReader{doc: doc, resolve: b.resolve, get: b.get, timeout: b.partTimeout}, nil
}

func (b *TelegramBackend) Close() { b.pools.close() }

type telegramReader struct {
	doc     *tg.Document
	resolve resolveDocument
	get     getPart
	timeout time.Duration
}

func (r *telegramReader) Part(parent context.Context, offset int64, limit int) ([]byte, error) {
	if err := ValidateChunk(limit); err != nil {
		return nil, err
	}
	if offset < 0 || offset >= r.doc.Size || offset%4096 != 0 || offset%TelegramWindow+int64(limit) > TelegramWindow {
		return nil, ErrRange
	}
	ctx, cancel := context.WithTimeout(parent, r.timeout)
	defer cancel()
	refreshed, migrated, transient := false, false, false
	// At most three attempts per part, including reference refresh, DC migration,
	// one transient retry, or one short-read retry. Every operation uses this deadline.
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		result, err := r.get(ctx, r.doc.DCID, &tg.UploadGetFileRequest{
			Location: &tg.InputDocumentFileLocation{ID: r.doc.ID, AccessHash: r.doc.AccessHash, FileReference: r.doc.FileReference},
			Offset:   offset, Limit: limit, Precise: false, CDNSupported: false,
		})
		if err == nil {
			switch part := result.(type) {
			case *tg.UploadFile:
				if int64(len(part.Bytes)) == min(int64(limit), r.doc.Size-offset) {
					return part.Bytes, nil
				}
				err = io.ErrUnexpectedEOF
			case *tg.UploadFileCDNRedirect:
				return nil, ErrCDN
			default:
				return nil, ErrUnavailable
			}
		}
		if rpc, ok := tgerr.As(err); ok {
			switch rpc.Type {
			case "FILE_REFERENCE_EXPIRED", "FILE_REFERENCE_INVALID", "FILE_REFERENCE_EMPTY":
				if refreshed {
					return nil, ErrReference
				}
				refreshed = true
				updated, e := r.resolve(ctx)
				if e != nil {
					return nil, e
				}
				if updated.ID != r.doc.ID || updated.Size != r.doc.Size {
					return nil, ErrChanged
				}
				r.doc = updated
				continue
			case "FILE_MIGRATE":
				if migrated || rpc.Argument <= 0 {
					return nil, ErrUnavailable
				}
				migrated = true
				copy := *r.doc
				copy.DCID = rpc.Argument
				r.doc = &copy
				continue
			}
		}
		if !transient && retryable(err) && attempt < 2 {
			transient = true
			timer := time.NewTimer(150 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
			continue
		}
		return nil, classifyTelegramError(err)
	}
	return nil, ErrUnavailable
}

func retryable(err error) bool {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var network net.Error
	if errors.As(err, &network) {
		return true
	}
	if rpc, ok := tgerr.As(err); ok {
		return rpc.Code >= 500 || rpc.Type == "UPLOAD_GETFILE_TIMEOUT"
	}
	return false
}

func classifyTelegramError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if rpc, ok := tgerr.As(err); ok {
		switch rpc.Type {
		case "FLOOD_WAIT", "FLOOD_PREMIUM_WAIT":
			return ErrRateLimited
		case "CHANNEL_PRIVATE", "CHANNEL_INVALID", "CHAT_FORBIDDEN", "MESSAGE_ID_INVALID":
			return ErrNotFound
		case "FILE_REFERENCE_EXPIRED", "FILE_REFERENCE_INVALID", "FILE_REFERENCE_EMPTY":
			return ErrReference
		}
	}
	return ErrUnavailable
}
