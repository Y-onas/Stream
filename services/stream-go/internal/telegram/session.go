package telegram

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/gotd/td/session"
)

// Storage stores only gotd's session, never login codes or passwords.
type Storage struct{ path string }

func NewStorage(path string) (*Storage, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("session path cannot be empty")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, errors.New("invalid session path")
	}
	dir := filepath.Dir(path)
	cwd, err := os.Getwd()
	if err != nil {
		return nil, errors.New("cannot determine working directory")
	}
	home, _ := os.UserHomeDir()
	rel, relErr := filepath.Rel(dir, cwd)
	ancestor := relErr == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
	if ancestor || strings.EqualFold(dir, home) || dir == filepath.VolumeName(dir)+string(os.PathSeparator) {
		return nil, errors.New("use a dedicated session directory")
	}
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() {
			return nil, errors.New("session path must name a regular file, not a directory or symbolic link")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("cannot inspect session file")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, errors.New("cannot create session directory")
	}
	if err := securePath(dir, true); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(path); err == nil {
		if err := securePath(path, false); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("cannot inspect session file")
	}
	return &Storage{path: path}, nil
}

func securePath(path string, dir bool) error {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || info.IsDir() != dir || (!dir && !info.Mode().IsRegular()) {
		return errors.New("session path must be a regular file in a real directory, not a symbolic link")
	}
	if err := restrict(path, dir); err != nil {
		return errors.New("cannot restrict session permissions; choose a private local session directory")
	}
	return nil
}

func (s *Storage) LoadSession(context.Context) ([]byte, error) {
	if _, err := os.Lstat(s.path); errors.Is(err, os.ErrNotExist) {
		return nil, session.ErrNotFound
	}
	if err := securePath(s.path, false); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(s.path)
	if err != nil {
		return nil, errors.New("cannot read saved Telegram session")
	}
	return b, nil
}

func (s *Storage) StoreSession(_ context.Context, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(s.path), ".session-*")
	if err != nil {
		return errors.New("cannot create session file")
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err := securePath(f.Name(), false); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return errors.New("cannot write Telegram session")
	}
	if err := f.Sync(); err != nil {
		return errors.New("cannot flush Telegram session")
	}
	if err := f.Close(); err != nil {
		return errors.New("cannot close Telegram session")
	}
	if err := os.Rename(f.Name(), s.path); err != nil {
		return errors.New("cannot replace Telegram session; ensure no other instance is running")
	}
	return nil
}
