package discovery

import (
	"context"
	"errors"
	"strings"

	"github.com/gotd/td/telegram/query"
	"github.com/gotd/td/telegram/query/dialogs"
	"github.com/gotd/td/tg"
	"streamweb/internal/media"
)

type Source struct {
	Info media.Source
	Peer tg.InputPeerClass
}

var ErrSourceMissing = errors.New("source not found among accessible group/channel dialogs; check the exact name and account membership")

func Matches(name, target string) bool {
	return strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(target))
}

func fromDialog(e dialogs.Elem) (Source, bool) {
	s := Source{Peer: e.Peer}
	switch p := e.Peer.(type) {
	case *tg.InputPeerChannel:
		c, ok := e.Entities.Channel(p.ChannelID)
		if !ok || c.Left {
			return Source{}, false
		}
		kind := "channel"
		if c.Megagroup {
			kind = "supergroup"
		}
		s.Info = media.Source{Name: c.Title, ID: c.ID, Kind: kind}
	case *tg.InputPeerChat:
		c, ok := e.Entities.Chat(p.ChatID)
		if !ok || c.Left || c.Deactivated {
			return Source{}, false
		}
		s.Info = media.Source{Name: c.Title, ID: c.ID, Kind: "group"}
	default:
		return Source{}, false
	}
	return s, true
}

// Find examines both the main dialog list and archived dialogs, retaining only matches.
func Find(ctx context.Context, api *tg.Client, name string) ([]Source, error) {
	var found []Source
	seen := map[media.Source]bool{}
	for _, folder := range []int{0, 1} {
		iter := query.GetDialogs(api).FolderID(folder).BatchSize(100).Iter()
		for iter.Next(ctx) {
			e := iter.Value()
			if e.Deleted() {
				continue
			}
			s, ok := fromDialog(e)
			if ok && Matches(s.Info.Name, name) && !seen[s.Info] {
				found = append(found, s)
				seen[s.Info] = true
			}
		}
		if err := iter.Err(); err != nil {
			return nil, err
		}
	}
	if len(found) == 0 {
		return nil, ErrSourceMissing
	}
	return found, nil
}
