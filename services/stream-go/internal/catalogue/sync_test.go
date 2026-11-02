package catalogue

import (
	"context"
	"errors"
	"github.com/gotd/td/tg"
	"path/filepath"
	"slices"
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

func TestAuditRemovesOfflineDeletionsAcrossPages(t *testing.T) {
	for _, kind := range []string{"channel", "group"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "catalogue.json")
			store, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			source := media.Source{ID: 42, Kind: kind}
			if err = store.Update(func(st *State) error {
				st.Source = source
				for _, id := range []int{14, 12, 11, 10, 9, 8, 7, 6, 5, 2} {
					Upsert(st, message(id, true))
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			items := []tg.MessageClass{message(12, true), message(10, true), message(9, false), message(7, true), message(5, true)}
			syncer := Syncer{Store: store, Fetch: history(&items), Source: source, PageSize: 3}
			for _, step := range []struct {
				offset int
				ids    []int
			}{
				{9, []int{2, 5, 6, 7, 8, 10, 12}},
				{5, []int{2, 5, 7, 10, 12}},
				{0, []int{5, 7, 10, 12}},
			} {
				if err = syncer.audit(context.Background()); err != nil {
					t.Fatal(err)
				}
				// Reopen after every page to verify records and cursor commit together.
				store, err = Open(path)
				if err != nil {
					t.Fatal(err)
				}
				syncer.Store = store
				st := store.Snapshot()
				var ids []int
				for _, record := range st.Videos {
					ids = append(ids, record.MessageID)
				}
				slices.Sort(ids)
				if st.AuditOffset != step.offset || !slices.Equal(ids, step.ids) {
					t.Fatalf("offset=%d ids=%v; want offset=%d ids=%v", st.AuditOffset, ids, step.offset, step.ids)
				}
			}
		})
	}
}

func TestAuditEmptyHistoryRemovesAllStaleRecords(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	syncer := Syncer{Store: store, PageSize: 2, Fetch: func(context.Context, int, int) ([]tg.MessageClass, error) { return nil, nil }}
	if err = syncer.Apply(message(10, true)); err != nil {
		t.Fatal(err)
	}
	if err = syncer.audit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st := store.Snapshot(); len(st.Videos) != 0 || st.AuditOffset != 0 {
		t.Fatalf("empty history left stale records: %+v", st)
	}
}

func TestAuditPreservesConcurrentLiveRecords(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	syncer := Syncer{Store: store, PageSize: 3}
	for _, id := range []int{10, 9, 7, 5} {
		if err = syncer.Apply(message(id, true)); err != nil {
			t.Fatal(err)
		}
	}
	syncer.Fetch = func(context.Context, int, int) ([]tg.MessageClass, error) {
		if err := syncer.Apply(message(11, true)); err != nil {
			return nil, err
		}
		edited := message(9, true)
		edited.Message = "live edit during history request"
		if err := syncer.Apply(edited); err != nil {
			return nil, err
		}
		edited = message(5, true)
		edited.Message = "newer than returned history page"
		if err := syncer.Apply(edited); err != nil {
			return nil, err
		}
		if err := store.Update(func(st *State) error { delete(st.Videos, Key(st.Source, 7)); return nil }); err != nil {
			return nil, err
		}
		return []tg.MessageClass{message(8, true), message(7, true), message(5, true)}, nil
	}
	if err = syncer.audit(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := store.Snapshot()
	for _, id := range []int{11, 9, 8, 5} {
		if _, exists := st.Videos[Key(st.Source, id)]; !exists {
			t.Fatalf("lost live or returned record %d", id)
		}
	}
	if len(st.Videos) != 4 || st.Videos[Key(st.Source, 9)].Video.Description != "live edit during history request" || st.Videos[Key(st.Source, 5)].Video.Description != "newer than returned history page" {
		t.Fatalf("incorrect concurrent reconciliation: %+v", st.Videos)
	}
}

func TestAuditFailureDoesNotPruneOrAdvance(t *testing.T) {
	for _, scenario := range []string{"fetch error", "invalid ID", "boundary repeated", "wrong window"} {
		t.Run(scenario, func(t *testing.T) {
			store, err := Open(filepath.Join(t.TempDir(), "catalogue.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err = store.Update(func(st *State) error { st.AuditOffset = 10; Upsert(st, message(8, true)); return nil }); err != nil {
				t.Fatal(err)
			}
			before := store.Snapshot()
			syncer := Syncer{Store: store, PageSize: 2, Fetch: func(context.Context, int, int) ([]tg.MessageClass, error) {
				switch scenario {
				case "fetch error":
					return nil, errors.New("network interrupted")
				case "invalid ID":
					return []tg.MessageClass{message(0, true)}, nil
				case "boundary repeated":
					return []tg.MessageClass{message(10, true)}, nil
				default:
					return []tg.MessageClass{message(12, true)}, nil
				}
			}}
			if syncer.audit(context.Background()) == nil {
				t.Fatal("expected failed audit")
			}
			st := store.Snapshot()
			if st.Revision != before.Revision || st.AuditOffset != before.AuditOffset || len(st.Videos) != 1 {
				t.Fatal("failed audit mutated the catalogue")
			}
		})
	}
}
