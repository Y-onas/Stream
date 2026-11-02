package telegram

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/gotd/td/session"
)

func TestSessionRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "test.session.json")
	s, err := NewStorage(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := s.LoadSession(ctx); !errors.Is(err, session.ErrNotFound) {
		t.Fatal("expected missing session")
	}
	for _, value := range []string{"first", "replacement"} {
		if err := s.StoreSession(ctx, []byte(value)); err != nil {
			t.Fatal(err)
		}
		data, err := s.LoadSession(ctx)
		if err != nil || string(data) != value {
			t.Fatalf("session round trip failed: %v", err)
		}
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("session permissions")
		}
	}
}

func TestRejectBroadSessionDirectory(t *testing.T) {
	for _, path := range []string{"test.session.json", "", ".", "../test.session.json"} {
		if _, err := NewStorage(path); err == nil {
			t.Fatal("must not change permissions of working directory or its ancestors")
		}
	}
}

func TestExplainDoesNotLeak(t *testing.T) {
	if got := Explain(errors.New("secret-session-data")); got == "secret-session-data" {
		t.Fatal("raw error leaked")
	}
}
