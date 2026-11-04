package config

import (
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/joho/godotenv"
)

type Config struct {
	APIID    int
	APIHash  string
	Source   string
	Username string
}

// ValidationError contains field names/instructions only, never supplied values.
type ValidationError string

func (e ValidationError) Error() string { return string(e) }

var usernamePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{4,31}$`)

// Load preserves existing process variables and never includes dotenv contents in errors.
func Load(path string) (Config, error) {
	if err := godotenv.Load(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, ValidationError("cannot read or parse the .env file; check its permissions and KEY=value syntax")
	}
	return Validate(os.Getenv("TELEGRAM_API_ID"), os.Getenv("TELEGRAM_API_HASH"))
}

// LoadRuntime validates all four operator-supplied Telegram values. No source
// or account fallback is permitted in either daemon or interactive discovery.
func LoadRuntime(path string) (Config, error) {
	cfg, err := Load(path)
	if err != nil {
		return Config{}, err
	}
	return ValidateRuntime(strconv.Itoa(cfg.APIID), cfg.APIHash, os.Getenv("TELEGRAM_SOURCE"), os.Getenv("USER_NAME"))
}
func ValidateRuntime(id, hash, source, username string) (Config, error) {
	cfg, err := Validate(id, hash)
	if err != nil {
		return Config{}, err
	}
	source = strings.TrimSpace(source)
	if source == "" {
		return Config{}, ValidationError("TELEGRAM_SOURCE is required; set the exact accessible group/channel display name")
	}
	if utf8.RuneCountInString(source) > 256 || strings.IndexFunc(source, unicode.IsControl) >= 0 {
		return Config{}, ValidationError("TELEGRAM_SOURCE must be a single group/channel display name of at most 256 characters")
	}
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	if !usernamePattern.MatchString(username) {
		return Config{}, ValidationError("USER_NAME is required and must be a Telegram username: 5–32 letters, digits or underscores, starting with a letter (optional @)")
	}
	cfg.Source = source
	cfg.Username = username
	return cfg, nil
}

func (c Config) MatchesUsername(actual string) bool {
	return c.Username != "" && strings.EqualFold(c.Username, strings.TrimPrefix(actual, "@"))
}

func Validate(id, hash string) (Config, error) {
	id, hash = strings.TrimSpace(id), strings.TrimSpace(hash)
	if id == "" {
		return Config{}, ValidationError("TELEGRAM_API_ID is missing; set it in .env or the environment")
	}
	n, err := strconv.ParseInt(id, 10, 32)
	if err != nil || n <= 0 {
		return Config{}, ValidationError("TELEGRAM_API_ID must be a positive 32-bit integer")
	}
	if hash == "" {
		return Config{}, ValidationError("TELEGRAM_API_HASH is missing; set it in .env or the environment")
	}
	if len(hash) != 32 || strings.IndexFunc(hash, func(r rune) bool { return !strings.ContainsRune("0123456789abcdefABCDEF", r) }) >= 0 {
		return Config{}, ValidationError("TELEGRAM_API_HASH must contain 32 hexadecimal characters")
	}
	return Config{APIID: int(n), APIHash: hash}, nil
}
