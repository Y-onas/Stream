// Package observability reads only the current Linux container's counters.
// Missing cgroup-v2/proc counters remain absent (for example on local Windows).
package observability

import (
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var sample struct {
	sync.Mutex
	at  time.Time
	cpu uint64
}

func Snapshot() map[string]any {
	result := map[string]any{}
	for _, field := range []struct{ path, name string }{
		{"/sys/fs/cgroup/memory.current", "memoryBytes"},
		{"/sys/fs/cgroup/memory.max", "memoryLimitBytes"},
	} {
		if raw, err := os.ReadFile(field.path); err == nil {
			if value, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64); err == nil {
				result[field.name] = value
			}
		}
	}
	if raw, err := os.ReadFile("/sys/fs/cgroup/cpu.stat"); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) != 2 || fields[0] != "usage_usec" {
				continue
			}
			if used, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
				now := time.Now()
				sample.Lock()
				if !sample.at.IsZero() && used >= sample.cpu && now.After(sample.at) {
					result["cpuCoresUsed"] = float64(used-sample.cpu) / 1e6 / now.Sub(sample.at).Seconds()
				}
				sample.at, sample.cpu = now, used
				sample.Unlock()
			}
		}
	}
	if raw, err := os.ReadFile("/sys/fs/cgroup/io.stat"); err == nil {
		var read, written uint64
		for _, field := range strings.Fields(string(raw)) {
			pair := strings.SplitN(field, "=", 2)
			if len(pair) != 2 {
				continue
			}
			value, _ := strconv.ParseUint(pair[1], 10, 64)
			if pair[0] == "rbytes" {
				read += value
			}
			if pair[0] == "wbytes" {
				written += value
			}
		}
		result["readBytes"], result["writtenBytes"] = read, written
	}
	if raw, err := os.ReadFile("/proc/net/dev"); err == nil {
		var received, sent uint64
		for _, line := range strings.Split(string(raw), "\n") {
			pair := strings.SplitN(line, ":", 2)
			if len(pair) != 2 || strings.TrimSpace(pair[0]) == "lo" {
				continue
			}
			fields := strings.Fields(pair[1])
			if len(fields) < 9 {
				continue
			}
			r, _ := strconv.ParseUint(fields[0], 10, 64)
			s, _ := strconv.ParseUint(fields[8], 10, 64)
			received += r
			sent += s
		}
		result["receivedBytes"], result["sentBytes"] = received, sent
	}
	return result
}
