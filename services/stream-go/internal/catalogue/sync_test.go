package catalogue

import (
	"context"
	"errors"
	"github.com/gotd/td/tg"
	"path/filepath"
	"streamweb/internal/discovery"
	"streamweb/internal/media"
	"testing"
)

func message(id int, video bool) *tg.Message {
	m := &tg.Message{ID: id, Date: 1700000000 + id, Message: "original"}
	if video {
		m.Media = &tg.MessageMediaDocument{Document: &tg.Document{ID: int64(id), Size: 100, MimeType: "video/quicktime", Attributes: []tg.DocumentAttributeClass{&tg.DocumentAttributeFilename{FileName: "phone.MOV"}, &tg.DocumentAttributeVideo{Duration: 12, W: 100, H: 100}}}}
	}
	return m
}
func history(items *[]tg.MessageClass) discovery.FetchPage {
	return func(ctx context.Context, offset, limit int) ([]tg.MessageClass, error) {
		var out []tg.MessageClass
		for _, m := range *items {
			if offset == 0 || m.GetID() < offset {
				out = append(out, m)
				if len(out) == limit {
					break
				}
			}
		}
		return out, nil
	}
}
func TestInitialIncrementalDuplicatesAndEdits(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	items := []tg.MessageClass{message(7, true), message(6, false), message(5, true)}
	source := media.Source{ID: 42, Kind: "channel", Name: "Stream Test"}
	syncer := Syncer{Store: store, Fetch: history(&items), Source: source, PageSize: 2}
	if err = syncer.Cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := store.Snapshot()
	if !st.InitialComplete || len(st.Videos) != 2 || st.HighWater != 7 {
		t.Fatalf("bad initial state: %+v", st)
	}
	items = append([]tg.MessageClass{message(10, true), message(9, true), message(8, true)}, items...)
	for range 2 {
		if err = syncer.Cycle(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	st = store.Snapshot()
	if len(st.Videos) != 5 || st.HighWater != 10 {
		t.Fatal("missing new videos or duplicate records")
	}
	edited := message(5, true)
	edited.Message = "updated caption"
	if err = syncer.Apply(edited); err != nil {
		t.Fatal(err)
	}
	if store.Snapshot().Videos[Key(source, 5)].Video.Description != "updated caption" {
		t.Fatal("edit not applied")
	}
	if len(store.Snapshot().Videos) != 5 {
		t.Fatal("edit duplicated video")
	}
	source.ID = 99
	syncer.Source = source
	if syncer.Cycle(context.Background()) == nil {
		t.Fatal("accepted different source into existing store")
	}
}
func TestInterruptionResumesCommittedPage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalogue.json")
	store, _ := Open(path)
	items := []tg.MessageClass{message(8, true), message(7, true), message(6, true), message(5, true)}
	fetch := history(&items)
	calls := 0
	syncer := Syncer{Store: store, Source: media.Source{ID: 10, Kind: "channel"}, PageSize: 2, Fetch: func(ctx context.Context, offset, limit int) ([]tg.MessageClass, error) {
		calls++
		if calls == 2 {
			return nil, errors.New("network interrupted")
		}
		return fetch(ctx, offset, limit)
	}}
	if syncer.Cycle(context.Background()) == nil {
		t.Fatal("expected interruption")
	}
	st := store.Snapshot()
	if st.Offset != 7 || st.InitialComplete || len(st.Videos) != 2 {
		t.Fatal("cursor not committed atomically")
	}
	restored, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	syncer.Store = restored
	first := 0
	syncer.Fetch = func(ctx context.Context, offset, limit int) ([]tg.MessageClass, error) {
		if first == 0 {
			first = offset
		}
		return fetch(ctx, offset, limit)
	}
	if err = syncer.Cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if first != 7 || len(restored.Snapshot().Videos) != 4 || !restored.Snapshot().InitialComplete {
		t.Fatal("did not resume saved cursor")
	}
}
func TestStoreCommitFailurePreservesMemory(t *testing.T) {
	store, _ := Open(filepath.Join(t.TempDir(), "state.json"))
	_ = store.Update(func(st *State) error { st.HighWater = 3; return nil })
	if store.Update(func(st *State) error { st.HighWater = 99; return errors.New("failed") }) == nil {
		t.Fatal("expected error")
	}
	if store.Snapshot().HighWater != 3 {
		t.Fatal("failed mutation leaked")
	}
}
