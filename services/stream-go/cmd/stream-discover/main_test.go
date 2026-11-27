package main

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckConfigValidatesSelectedSource(t *testing.T) {
	for _, tc := range []struct {
		name, environment, override string
		valid                       bool
	}{
		{"override without environment", "", "Archive", true},
		{"override replaces invalid environment", "Bad\nDefault", "Archive", true},
		{"environment default", "የፊልም Channel", "", true},
		{"override is validated", "Default", "Bad\nOverride", false},
		{"missing source", "", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TELEGRAM_API_ID", "12345")
			t.Setenv("TELEGRAM_API_HASH", strings.Repeat("b", 32))
			t.Setenv("TELEGRAM_SOURCE", tc.environment)
			previousFlags, previousArgs := flag.CommandLine, os.Args
			t.Cleanup(func() { flag.CommandLine, os.Args = previousFlags, previousArgs })
			flag.CommandLine = flag.NewFlagSet("stream-discover", flag.ContinueOnError)
			os.Args = []string{"stream-discover", "-env", filepath.Join(t.TempDir(), "absent.env"), "-check-config"}
			if tc.override != "" {
				os.Args = append(os.Args, "-source", tc.override)
			}
			err := run()
			if (err == nil) != tc.valid {
				t.Fatalf("expected valid=%v, got %v", tc.valid, err)
			}
			if err != nil && !strings.Contains(err.Error(), "TELEGRAM_SOURCE") {
				t.Fatal(err)
			}
		})
	}
}
