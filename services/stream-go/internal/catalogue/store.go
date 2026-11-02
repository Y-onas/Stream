package catalogue

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gotd/td/tg"
	"os"
	"path/filepath"
	"streamweb/internal/media"
	"sync"
	"time"
)

type Video struct {
	ID              string   `json:"id"`
	MessageID       int      `json:"-"`
	Title           string   `json:"title"`
	TitleUnverified bool     `json:"titleUnverified"`
	Description     string   `json:"description"`
	Filename        string   `json:"filename"`
	MIME            string   `json:"mimeType"`
	Size            int64    `json:"sizeBytes"`
	UploadedAt      string   `json:"uploadedAt"`
	Duration        *float64 `json:"durationSeconds"`
	Artwork         *string  `json:"artwork"`
}
type Record struct {
	Video     Video `json:"video"`
	MessageID int   `json:"messageId"`
}
type State struct {
	Version         int               `json:"version"`
	Source          media.Source      `json:"source"`
	Videos          map[string]Record `json:"videos"`
	InitialComplete bool              `json:"initialComplete"`
	Offset          int               `json:"offset"`
	HighWater       int               `json:"highWater"`
	PendingHigh     int               `json:"pendingHigh"`
	AuditOffset     int               `json:"auditOffset"`
	LastSuccess     time.Time         `json:"lastSuccess"`
	LastError       string            `json:"lastError,omitempty"`
	Revision        uint64            `json:"revision"`
}
type Store struct {
	mu    sync.RWMutex
	path  string
	state State
}

func Open(path string) (*Store, error) {
	s := &Store{path: path, state: State{Version: 1, Videos: map[string]Record{}}}
	data, err := os.ReadFile(path)
	if err == nil {
		if json.Unmarshal(data, &s.state) != nil || s.state.Version != 1 || s.state.Videos == nil {
			return nil, errors.New("invalid catalogue state; restore its backup instead of discarding checkpoints")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}
func (s *Store) Snapshot() State { s.mu.RLock(); defer s.mu.RUnlock(); return clone(s.state) }
func clone(state State) State {
	out := state
	out.Videos = make(map[string]Record, len(state.Videos))
	for k, v := range state.Videos {
		out.Videos[k] = v
	}
	return out
}

// Update commits records and cursor together. Only one service instance may own a store.
func (s *Store) Update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.state)
	if err := fn(&next); err != nil {
		return err
	}
	next.Revision++
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".catalogue-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, s.path); err != nil {
		return err
	}
	// Persist the rename on filesystems that support directory fsync.
	if dir, e := os.Open(filepath.Dir(s.path)); e == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	s.state = next
	return nil
}
func Key(source media.Source, id int) string {
	return fmt.Sprintf("%s-%d-%d", source.Kind, source.ID, id)
}
func Upsert(state *State, message tg.MessageClass) {
	m := media.Extract(message, state.Source)
	key := Key(state.Source, m.MessageID)
	if m.MediaType != "video" || m.Size == nil || *m.Size <= 0 {
		delete(state.Videos, key)
		return
	}
	title := m.Filename
	if m.Candidate != nil && m.Candidate.Title != "" {
		title = m.Candidate.Title
	}
	if title == "" {
		title = fmt.Sprintf("Video %d", m.MessageID)
	}
	var duration *float64
	if msg, ok := message.(*tg.Message); ok {
		if attachment, ok := msg.Media.(*tg.MessageMediaDocument); ok {
			if doc, ok := attachment.Document.(*tg.Document); ok {
				for _, a := range doc.Attributes {
					if video, ok := a.(*tg.DocumentAttributeVideo); ok && video.Duration > 0 {
						v := video.Duration
						duration = &v
					}
				}
			}
		}
	}
	state.Videos[key] = Record{MessageID: m.MessageID, Video: Video{ID: key, Title: title, TitleUnverified: m.Candidate != nil && m.Candidate.Uncertain, Description: m.Text, Filename: m.Filename, MIME: m.MIME, Size: *m.Size, UploadedAt: m.Date, Duration: duration}}
}
