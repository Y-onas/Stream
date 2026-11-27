package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"flag"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"streamweb/internal/config"
)

func TestPortConflictFailsBeforeTelegramStarts(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	directory := t.TempDir()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(directory, "public.pem")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public}), 0600); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{
		"TELEGRAM_API_ID": "12345", "TELEGRAM_API_HASH": strings.Repeat("a", 32),
		"TELEGRAM_SOURCE": "Fixture channel", "USER_NAME": "",
		"STREAM_SERVICE_TOKEN": strings.Repeat("s", 32), "STREAM_LISTEN": listener.Addr().String(),
		"CATALOGUE_PATH": filepath.Join(directory, "catalogue.json"), "PLAYBACK_PUBLIC_KEY_PATH": keyPath,
		"PLAYBACK_PREVIOUS_KEYS_PATH": "", "PLAYBACK_KEY_ID": "", "PLAYBACK_CHECK_INTERVAL": "15s",
		"PLAYBACK_CLOCK_TOLERANCE": "30s", "SYNC_INTERVAL": "30s",
		"TELEGRAM_FILE_CONNECTIONS": "32",
	} {
		t.Setenv(name, value)
	}
	oldFlags, oldArgs := flag.CommandLine, os.Args
	t.Cleanup(func() { flag.CommandLine, os.Args = oldFlags, oldArgs })
	flag.CommandLine = flag.NewFlagSet("stream-service", flag.ContinueOnError)
	os.Args = []string{"stream-service", "-env", filepath.Join(directory, "missing.env")}
	err = run()
	var invalid config.ValidationError
	if !errors.As(err, &invalid) || !strings.Contains(invalid.Error(), "STREAM_LISTEN cannot be opened") {
		t.Fatalf("expected a safe port configuration error, got %v", err)
	}
}
