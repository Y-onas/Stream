package streaming

import (
	"context"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

type HTTPOptions struct {
	MessageID      int
	Host           string
	ChunkSize      int
	Concurrency    int
	RequestTimeout time.Duration
	WriteTimeout   time.Duration
	Logger         *log.Logger
}

type Handler struct {
	provider Provider
	opts     HTTPOptions
	slots    chan struct{}
}

func ValidateAddress(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("listen address must be a numeric loopback IP and port, for example 127.0.0.1:8080")
	}
	ip, err := netip.ParseAddr(host)
	p, e := strconv.Atoi(port)
	if err != nil || !ip.IsLoopback() || e != nil || p < 1 || p > 65535 {
		return errors.New("only numeric loopback addresses and ports 1..65535 are allowed")
	}
	return nil
}

func NewHandler(provider Provider, opts HTTPOptions) (*Handler, error) {
	if err := ValidateAddress(opts.Host); err != nil {
		return nil, err
	}
	if err := ValidateChunk(opts.ChunkSize); err != nil {
		return nil, err
	}
	if provider == nil || opts.MessageID <= 0 || opts.Concurrency < 1 || opts.Concurrency > 8 || opts.RequestTimeout <= 0 || opts.WriteTimeout <= 0 {
		return nil, errors.New("invalid streaming limits or selected message")
	}
	return &Handler{provider: provider, opts: opts, slots: make(chan struct{}, opts.Concurrency)}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	// Prevent DNS rebinding and cross-origin browser access to this local-only tool.
	if r.Host != h.opts.Host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+h.opts.Host) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "local same-origin requests only", http.StatusForbidden)
		return
	}
	if r.URL.Path != "/media/stream/"+strconv.Itoa(h.opts.MessageID) {
		http.NotFound(w, r)
		return
	}
	if r.URL.RawQuery != "" || r.ContentLength > 0 || len(r.TransferEncoding) != 0 {
		http.Error(w, "query parameters and request bodies are not supported", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		http.Error(w, "stream concurrency limit reached", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.opts.RequestTimeout)
	defer cancel()
	file, reader, err := h.provider.Open(ctx)
	if err != nil {
		upstreamError(w, err)
		return
	}
	if file.Size <= 0 || file.DocumentID == 0 || file.MessageID != h.opts.MessageID {
		upstreamError(w, ErrMetadata)
		return
	}
	contentType := file.MIME
	if contentType == "" {
		contentType = "application/octet-stream"
	} else if _, _, err := mime.ParseMediaType(contentType); err != nil {
		upstreamError(w, ErrMetadata)
		return
	}
	value := r.Header.Get("Range")
	// RFC 9110: Range modifies GET only. HEAD always describes the full representation.
	if r.Method == http.MethodHead {
		value = ""
	}
	if value != "" && r.Header.Get("If-Range") != "" && r.Header.Get("If-Range") != file.ETag() {
		value = ""
	}
	selected, err := ParseRange(value, file.Size)
	if len(r.Header.Values("Range")) > 1 && r.Method == http.MethodGet {
		err = ErrRange
	}
	if err != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", file.Size))
		http.Error(w, ErrRange.Error(), http.StatusRequestedRangeNotSatisfiable)
		return
	}
	status := http.StatusOK
	if value != "" {
		status = http.StatusPartialContent
	}
	// Fetch one bounded part before committing success headers so upstream failures
	// become HTTP errors. HEAD never retrieves any file bytes.
	var part []byte
	if r.Method == http.MethodGet {
		if reader == nil {
			upstreamError(w, ErrUnavailable)
			return
		}
		part, err = ReadChunk(ctx, reader, file.Size, selected.Start, selected.End, h.opts.ChunkSize)
		if err != nil {
			upstreamError(w, err)
			return
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(selected.Length(), 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", file.ETag())
	if status == http.StatusPartialContent {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", selected.Start, selected.End, file.Size))
	}
	controller := http.NewResponseController(w)
	defer controller.SetWriteDeadline(time.Time{})
	w.WriteHeader(status)
	if h.opts.Logger != nil {
		h.opts.Logger.Printf("stream %s status=%d bytes=%d-%d", r.Method, status, selected.Start, selected.End)
	}
	if r.Method == http.MethodHead {
		return
	}
	position := selected.Start
	for {
		if ctx.Err() != nil {
			h.abort("request canceled or timed out")
			return
		}
		if err := controller.SetWriteDeadline(time.Now().Add(h.opts.WriteTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			h.abort("write deadline failed")
			return
		}
		n, err := w.Write(part)
		if err != nil || n != len(part) {
			h.abort("client write failed")
			return
		}
		position += int64(n)
		if position > selected.End {
			return
		}
		if err := controller.Flush(); err != nil {
			h.abort("client disconnected")
			return
		}
		part = nil
		part, err = ReadChunk(ctx, reader, file.Size, position, selected.End, h.opts.ChunkSize)
		if err != nil {
			if ctx.Err() != nil {
				h.abort("client canceled or request timed out")
			} else {
				h.abort(SafeError(err))
			}
			return
		}
	}
}

func (h *Handler) abort(reason string) {
	if h.opts.Logger != nil {
		h.opts.Logger.Printf("stream aborted: %s", reason)
	}
	// net/http closes HTTP/1 connections or resets HTTP/2 streams. Do not write a
	// second status or append an error message to binary media.
	panic(http.ErrAbortHandler)
}

func upstreamError(w http.ResponseWriter, err error) {
	status, message := http.StatusBadGateway, ErrUnavailable.Error()
	switch {
	case errors.Is(err, ErrNotFound):
		status, message = 404, ErrNotFound.Error()
	case errors.Is(err, ErrUnsupported):
		status, message = 415, ErrUnsupported.Error()
	case errors.Is(err, ErrMetadata):
		status, message = 422, ErrMetadata.Error()
	case errors.Is(err, ErrChanged):
		status, message = 409, ErrChanged.Error()
	case errors.Is(err, ErrReference):
		message = ErrReference.Error()
	case errors.Is(err, ErrCDN):
		message = ErrCDN.Error()
	case errors.Is(err, ErrRateLimited):
		status, message = 503, ErrRateLimited.Error()
	case errors.Is(err, context.DeadlineExceeded):
		status, message = 504, "upstream request timed out"
	case errors.Is(err, context.Canceled):
		status, message = 503, "request canceled"
	}
	http.Error(w, message, status)
}

// SafeError is suitable for terminal startup errors; raw Telegram errors are never logged.
func SafeError(err error) string {
	for _, known := range []error{ErrNotFound, ErrUnsupported, ErrMetadata, ErrChanged, ErrUnavailable, ErrReference, ErrCDN, ErrRateLimited} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "Telegram operation timed out"
	}
	if errors.Is(err, context.Canceled) {
		return "operation canceled"
	}
	return "stream operation failed"
}

// NormalizeMIME retains Telegram's media type and strips surrounding whitespace.
func NormalizeMIME(s string) string { return strings.TrimSpace(s) }
