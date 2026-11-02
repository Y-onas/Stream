package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	hash := strings.Repeat("a", 32)
	for _, tc := range []struct {
		name, id, hash string
		valid          bool
	}{
		{"valid", "12345", hash, true}, {"whitespace", " 12345 ", " " + hash + " ", true},
		{"missing id", "", hash, false}, {"bad id", "secret-input", hash, false},
		{"zero", "0", hash, false}, {"negative", "-1", hash, false},
		{"overflow", "2147483648", hash, false}, {"missing hash", "12", "", false},
		{"bad hash", "12", "secret-input", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Validate(tc.id, tc.hash)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if err != nil && strings.Contains(err.Error(), "secret-input") {
				t.Fatal("value leaked")
			}
		})
	}
}

func TestLoadPreservesEnvironmentAndIgnoresDatabase(t *testing.T) {
	t.Setenv("TELEGRAM_API_ID", "123")
	t.Setenv("TELEGRAM_API_HASH", strings.Repeat("b", 32))
	t.Setenv("DATA_BASE_URL", "")
	file := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(file, []byte("TELEGRAM_API_ID=999\nTELEGRAM_API_HASH="+strings.Repeat("c", 32)), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(file)
	if err != nil || cfg.APIID != 123 {
		t.Fatalf("unexpected config result: %v", err)
	}
	if _, err := Load(filepath.Join(t.TempDir(), "absent")); err != nil {
		t.Fatal(err)
	}
}

func TestMalformedDotenvDoesNotLeak(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(file, []byte("SECRET='unclosed-secret-value"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := Load(file)
	if err == nil || strings.Contains(err.Error(), "unclosed-secret-value") {
		t.Fatal("unsafe dotenv error")
	}
}
