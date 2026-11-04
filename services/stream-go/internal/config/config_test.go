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

func TestRuntimeRequiresFourValuesAndChecksAccount(t *testing.T) {
	hash := strings.Repeat("b", 32)
	for _, tc := range []struct{ id, hash, source, user, field string }{
		{"", hash, "Channel", "fixture_user", "TELEGRAM_API_ID"},
		{"123", "", "Channel", "fixture_user", "TELEGRAM_API_HASH"},
		{"123", hash, "", "fixture_user", "TELEGRAM_SOURCE"},
		{"123", hash, "Channel", "", "USER_NAME"},
		{"123", hash, "Channel\nsecret-input", "fixture_user", "TELEGRAM_SOURCE"},
		{"123", hash, "Channel", "secret-input", "USER_NAME"},
	} {
		_, err := ValidateRuntime(tc.id, tc.hash, tc.source, tc.user)
		if err == nil || !strings.Contains(err.Error(), tc.field) || strings.Contains(err.Error(), "secret-input") {
			t.Fatalf("unsafe or missing field validation: %v", err)
		}
	}
	cfg, err := ValidateRuntime("123", hash, "  የፊልም Channel  ", " @Fixture_User ")
	if err != nil || cfg.Source != "የፊልም Channel" || cfg.Username != "Fixture_User" || !cfg.MatchesUsername("fixture_user") || cfg.MatchesUsername("different_user") {
		t.Fatal("source/account normalization or binding failed")
	}
}
