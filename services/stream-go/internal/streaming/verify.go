package streaming

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gotd/td/tg"
)

// referenceRange is a bounded diagnostic only (maximum 4096 returned bytes).
// It independently uses precise 1 KiB Telegram reads, rather than the HTTP
// handler's non-precise configurable chunks and ReadChunk translation.
func (b *TelegramBackend) referenceRange(ctx context.Context, start, length int64) ([]byte, error) {
	if start < 0 || length < 1 || length > 4096 || start > b.selected.Size-length {
		return nil, ErrRange
	}
	doc, err := b.resolve(ctx)
	if err != nil {
		return nil, err
	}
	if doc.ID != b.selected.DocumentID || doc.Size != b.selected.Size {
		return nil, ErrChanged
	}
	var out []byte
	for offset := start / 1024 * 1024; offset < start+length; offset += 1024 {
		callCtx, cancel := context.WithTimeout(ctx, b.partTimeout)
		result, err := b.get(callCtx, doc.DCID, &tg.UploadGetFileRequest{Precise: true, Location: &tg.InputDocumentFileLocation{ID: doc.ID, AccessHash: doc.AccessHash, FileReference: doc.FileReference}, Offset: offset, Limit: 1024})
		cancel()
		if err != nil {
			return nil, classifyTelegramError(err)
		}
		part, ok := result.(*tg.UploadFile)
		if !ok || int64(len(part.Bytes)) != min(int64(1024), doc.Size-offset) {
			return nil, ErrUnavailable
		}
		from, to := max(start-offset, 0), min(start+length-offset, int64(len(part.Bytes)))
		out = append(out, part.Bytes[from:to]...)
	}
	return out, nil
}

// VerifyHTTP runs bounded live checks, then returns. It never writes media to disk.
func (b *TelegramBackend) VerifyHTTP(ctx context.Context, url string, chunk int, output io.Writer) error {
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
	request := func(method, rangeValue string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, url, nil)
		if err != nil {
			return nil, err
		}
		if rangeValue != "" {
			req.Header.Set("Range", rangeValue)
		}
		return client.Do(req)
	}
	head, err := request("HEAD", "")
	if err != nil {
		return fmt.Errorf("HEAD connection check failed")
	}
	data, readErr := io.ReadAll(io.LimitReader(head.Body, 1))
	head.Body.Close()
	if readErr != nil || len(data) != 0 || head.StatusCode != 200 || head.ContentLength != b.selected.Size || head.Header.Get("Accept-Ranges") != "bytes" {
		return fmt.Errorf("HEAD metadata verification failed")
	}
	fmt.Fprintln(output, "PASS HEAD: full metadata, no body")
	ranges := []ByteRange{{0, min(1023, b.selected.Size-1)}}
	for _, boundary := range []int64{int64(chunk), TelegramWindow, b.selected.Size / 2} {
		if boundary > 16 && boundary+32 < b.selected.Size {
			ranges = append(ranges, ByteRange{boundary - 13, boundary + 31})
		}
	}
	ranges = append(ranges, ByteRange{max(0, b.selected.Size-33), b.selected.Size - 1})
	for _, selected := range ranges {
		value := fmt.Sprintf("bytes=%d-%d", selected.Start, selected.End)
		response, err := request("GET", value)
		if err != nil {
			return fmt.Errorf("range HTTP connection check failed")
		}
		body, e := io.ReadAll(io.LimitReader(response.Body, selected.Length()+1))
		response.Body.Close()
		expectedHeader := fmt.Sprintf("bytes %d-%d/%d", selected.Start, selected.End, b.selected.Size)
		if e != nil || response.StatusCode != 206 || response.Header.Get("Content-Range") != expectedHeader || response.ContentLength != selected.Length() || int64(len(body)) != selected.Length() {
			return fmt.Errorf("range response verification failed for %s", value)
		}
		reference, e := b.referenceRange(ctx, selected.Start, selected.Length())
		if e != nil {
			return fmt.Errorf("independent reference read: %s", SafeError(e))
		}
		if !bytes.Equal(body, reference) {
			return fmt.Errorf("range byte comparison failed for %s", value)
		}
		fmt.Fprintf(output, "PASS %s: 206, %d exact bytes, matches independent precise Telegram reads\n", value, len(body))
	}
	response, err := request("GET", "bytes="+strconv.FormatInt(b.selected.Size, 10)+"-")
	if err != nil {
		return fmt.Errorf("416 check failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 416 || response.Header.Get("Content-Range") != fmt.Sprintf("bytes */%d", b.selected.Size) {
		return fmt.Errorf("416 headers incorrect")
	}
	fmt.Fprintln(output, "PASS unsatisfiable range: 416 with total file size")
	return nil
}
