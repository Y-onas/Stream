package streaming

import (
	"errors"
	"strconv"
	"strings"
)

var ErrRange = errors.New("invalid or unsatisfiable single byte range (multiple ranges are not supported)")

// ByteRange uses inclusive endpoints, as HTTP does.
type ByteRange struct{ Start, End int64 }

func (r ByteRange) Length() int64 { return r.End - r.Start + 1 }

func ParseRange(value string, size int64) (ByteRange, error) {
	if size <= 0 {
		return ByteRange{}, ErrRange
	}
	if value == "" {
		return ByteRange{0, size - 1}, nil
	}
	unit, spec, ok := strings.Cut(strings.TrimSpace(value), "=")
	if len(value) > 128 || !ok || !strings.EqualFold(unit, "bytes") || strings.Contains(value, ",") {
		return ByteRange{}, ErrRange
	}
	parts := strings.Split(spec, "-")
	if len(parts) != 2 {
		return ByteRange{}, ErrRange
	}
	decimal := func(s string) (int64, error) {
		if s == "" {
			return 0, ErrRange
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return 0, ErrRange
			}
		}
		return strconv.ParseInt(s, 10, 64)
	}
	if parts[0] == "" {
		n, err := decimal(parts[1])
		if err != nil || n == 0 {
			return ByteRange{}, ErrRange
		}
		return ByteRange{size - min(n, size), size - 1}, nil
	}
	start, err := decimal(parts[0])
	if err != nil || start >= size {
		return ByteRange{}, ErrRange
	}
	end := size - 1
	if parts[1] != "" {
		end, err = decimal(parts[1])
		if err != nil || end < start {
			return ByteRange{}, ErrRange
		}
		end = min(end, size-1)
	}
	return ByteRange{start, end}, nil
}
