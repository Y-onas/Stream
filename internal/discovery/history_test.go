package discovery

import (
	"context"
	"errors"
	"github.com/gotd/td/tg"
	"reflect"
	"testing"
)

func messages(ids ...int) []tg.MessageClass {
	var result []tg.MessageClass
	for _, id := range ids {
		result = append(result, &tg.Message{ID: id})
	}
	return result
}

func TestWalkLimitAndResume(t *testing.T) {
	var requests [][2]int
	fetch := func(_ context.Context, offset, limit int) ([]tg.MessageClass, error) {
		requests = append(requests, [2]int{offset, limit})
		if offset == 0 {
			return messages(10, 9), nil
		}
		return messages(8), nil
	}
	var ids []int
	p, err := Walk(context.Background(), fetch, 2, 3, 0, func(m tg.MessageClass) error { ids = append(ids, m.GetID()); return nil })
	if err != nil || p.Inspected != 3 || p.NextOffset != 8 || !reflect.DeepEqual(ids, []int{10, 9, 8}) || !reflect.DeepEqual(requests, [][2]int{{0, 2}, {9, 1}}) {
		t.Fatalf("%+v %v %v %v", p, err, ids, requests)
	}
	requests = nil
	_, err = Walk(context.Background(), fetch, 2, 1, p.NextOffset, func(tg.MessageClass) error { return nil })
	if err == nil {
		t.Fatal("non-progressing page must fail")
	}
}

func TestWalkEmptyAndShortPages(t *testing.T) {
	calls := 0
	fetch := func(_ context.Context, offset, limit int) ([]tg.MessageClass, error) {
		calls++
		if calls == 1 {
			return messages(3), nil
		}
		if calls == 2 {
			return messages(2), nil
		}
		return nil, nil
	}
	p, err := Walk(context.Background(), fetch, 10, 100, 0, func(tg.MessageClass) error { return nil })
	if err != nil || p.Inspected != 2 || !p.Exhausted || calls != 3 {
		t.Fatalf("%+v %v", p, err)
	}
}

func TestWalkErrorsAndValidation(t *testing.T) {
	failure := errors.New("network")
	fetch := func(context.Context, int, int) ([]tg.MessageClass, error) { return nil, failure }
	if _, err := Walk(context.Background(), fetch, 101, 1, 0, nil); err == nil {
		t.Fatal("invalid page size")
	}
	if _, err := Walk(context.Background(), fetch, 1, 0, 0, nil); err == nil {
		t.Fatal("invalid max")
	}
	if _, err := Walk(context.Background(), fetch, 1, 1, 0, nil); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Walk(ctx, fetch, 1, 1, 0, nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestInspectDoesNotReturnNeighbor(t *testing.T) {
	fetch := func(_ context.Context, offset, limit int) ([]tg.MessageClass, error) {
		if offset != 43 || limit != 1 {
			t.Fatal("wrong request")
		}
		return messages(41), nil
	}
	if _, err := Inspect(context.Background(), fetch, 42); err == nil {
		t.Fatal("returned neighboring message")
	}
}

func TestMatches(t *testing.T) {
	if !Matches(" stream TEST ", "Stream Test") || Matches("Stream Test 2", "Stream Test") {
		t.Fatal("incorrect name matching")
	}
}

func TestWalkSkipsBoundaryAndDuplicates(t *testing.T) {
	fetch := func(context.Context, int, int) ([]tg.MessageClass, error) {
		return messages(10, 9, 9, 8, 7), nil
	}
	var ids []int
	p, err := Walk(context.Background(), fetch, 10, 2, 10, func(m tg.MessageClass) error {
		ids = append(ids, m.GetID())
		return nil
	})
	if err != nil || p.Inspected != 2 || !reflect.DeepEqual(ids, []int{9, 8}) {
		t.Fatalf("%+v %v %v", p, ids, err)
	}
}

func TestInspectExactMessage(t *testing.T) {
	fetch := func(context.Context, int, int) ([]tg.MessageClass, error) { return messages(42), nil }
	got, err := Inspect(context.Background(), fetch, 42)
	if err != nil || got.GetID() != 42 {
		t.Fatal("exact inspection failed")
	}
}
