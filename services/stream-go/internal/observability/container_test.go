package observability

import (
	"testing"
	"time"
)

func TestStaleCPUObservationsNeverReplaceNewerBaseline(t *testing.T) {
	var s cpuSample
	at := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	if _, ok := s.observe(1000000, at.Add(time.Second)); ok {
		t.Fatal("initial sample reported a rate")
	}
	if cores, ok := s.observe(2000000, at.Add(2*time.Second)); !ok || cores != 1 {
		t.Fatal(cores, ok)
	}
	if _, ok := s.observe(1000000, at.Add(3*time.Second)); ok {
		t.Fatal("regressing counter accepted")
	}
	if cores, ok := s.observe(4000000, at.Add(4*time.Second)); !ok || cores != 1 {
		t.Fatal("stale counter moved baseline", cores, ok)
	}
	if _, ok := s.observe(5000000, at.Add(3*time.Second)); ok {
		t.Fatal("regressing timestamp accepted")
	}
	if cores, ok := s.observe(6000000, at.Add(6*time.Second)); !ok || cores != 1 {
		t.Fatal("stale timestamp moved baseline", cores, ok)
	}
	if cores, ok := s.observe(6000000, at.Add(7*time.Second)); !ok || cores != 0 {
		t.Fatal("valid idle sample rejected", cores, ok)
	}
}
