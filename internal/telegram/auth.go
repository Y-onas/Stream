package telegram

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/gotd/td/telegram/auth"
	"github.com/gotd/td/tg"
	"golang.org/x/term"
)

// Terminal deliberately rejects piped authentication input to avoid echoing secrets.
type Terminal struct{}

var ErrInteractive = errors.New("authentication requires an interactive terminal; run the CLI locally to sign in")

func hidden(label string, trim bool) (string, error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return "", ErrInteractive
	}
	fmt.Fprint(os.Stderr, label)
	b, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", errors.New("could not read hidden terminal input")
	}
	s := string(b)
	clear(b)
	if trim {
		s = strings.TrimSpace(s)
	}
	if s == "" {
		return "", errors.New("authentication input cannot be empty")
	}
	return s, nil
}
func (Terminal) Phone(context.Context) (string, error) {
	return hidden("Phone number with country code (hidden): ", true)
}
func (Terminal) Code(context.Context, *tg.AuthSentCode) (string, error) {
	return hidden("Telegram login code (hidden): ", true)
}
func (Terminal) Password(context.Context) (string, error) {
	return hidden("Two-step verification password (hidden): ", false)
}
func (Terminal) SignUp(context.Context) (auth.UserInfo, error) {
	return auth.UserInfo{}, errors.New("use an existing Telegram account; account registration is not supported")
}
func (Terminal) AcceptTermsOfService(context.Context, tg.HelpTermsOfService) error {
	return errors.New("account registration is not supported; sign up in the official Telegram app")
}
