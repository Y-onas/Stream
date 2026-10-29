package discovery

import (
	"github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/telegram/query/dialogs"
	"github.com/gotd/td/tg"
	"testing"
)

func TestSourceResolutionFromEntities(t *testing.T) {
	entities := peer.NewEntities(nil, map[int64]*tg.Chat{11: {ID: 11, Title: "Stream Test"}}, map[int64]*tg.Channel{22: {ID: 22, Title: "Stream Test", Megagroup: true}})
	for _, tc := range []struct {
		p    tg.InputPeerClass
		kind string
		id   int64
	}{
		{&tg.InputPeerChat{ChatID: 11}, "group", 11},
		{&tg.InputPeerChannel{ChannelID: 22, AccessHash: 123}, "supergroup", 22},
	} {
		s, ok := fromDialog(dialogs.Elem{Peer: tc.p, Entities: entities})
		if !ok || s.Info.ID != tc.id || s.Info.Kind != tc.kind || s.Info.Name != "Stream Test" || s.Peer != tc.p {
			t.Fatalf("incorrect entity resolution: %+v", s.Info)
		}
	}
	if _, ok := fromDialog(dialogs.Elem{Peer: &tg.InputPeerUser{UserID: 11}, Entities: entities}); ok {
		t.Fatal("user dialog must not match group/channel source")
	}
}
