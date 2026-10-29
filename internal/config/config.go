package config

import (
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	APIID   int
	APIHash string
}

// Load preserves existing process variables and never includes dotenv contents in errors.
func Load(path string) (Config, error) {
	if err := godotenv.Load(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, errors.New("cannot read or parse the .env file; check its permissions and KEY=value syntax")
	}
	return Validate(os.Getenv("TELEGRAM_API_ID"), os.Getenv("TELEGRAM_API_HASH"))
}

func Validate(id, hash string) (Config, error) {
	id, hash = strings.TrimSpace(id), strings.TrimSpace(hash)
	if id == "" {
		return Config{}, errors.New("TELEGRAM_API_ID is missing; set it in .env or the environment")
	}
	n, err := strconv.ParseInt(id, 10, 32)
	if err != nil || n <= 0 {
		return Config{}, errors.New("TELEGRAM_API_ID must be a positive 32-bit integer")
	}
	if hash == "" {
		return Config{}, errors.New("TELEGRAM_API_HASH is missing; set it in .env or the environment")
	}
	if len(hash) != 32 || strings.IndexFunc(hash, func(r rune) bool { return !strings.ContainsRune("0123456789abcdefABCDEF", r) }) >= 0 {
		return Config{}, errors.New("TELEGRAM_API_HASH must contain 32 hexadecimal characters")
	}
	return Config{APIID: int(n), APIHash: hash}, nil
}
