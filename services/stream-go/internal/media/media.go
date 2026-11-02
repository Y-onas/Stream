package media

import (
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/gotd/td/tg"
)

type Source struct {
	Name string `json:"name"`
	ID   int64  `json:"id"`
	Kind string `json:"kind"`
}

type Metadata struct {
	Source     Source     `json:"source"`
	MessageID  int        `json:"message_id"`
	Date       string     `json:"date,omitempty"`
	Text       string     `json:"text_or_caption"`
	MediaType  string     `json:"media_type"`
	Filename   string     `json:"filename,omitempty"`
	Size       *int64     `json:"size_bytes,omitempty"`
	MIME       string     `json:"mime_type,omitempty"`
	DocumentID int64      `json:"document_id,omitempty"`
	Attributes []string   `json:"attributes,omitempty"`
	Candidate  *Candidate `json:"movie_title_candidate,omitempty"`
}

func Classify(filename, mime string, video, animated, sticker, audio bool) string {
	if sticker {
		return "sticker"
	}
	if animated {
		return "animation"
	}
	if video {
		return "video"
	}
	if audio || strings.HasPrefix(strings.ToLower(mime), "audio/") {
		return "audio"
	}
	if strings.HasPrefix(strings.ToLower(mime), "video/") {
		return "video"
	}
	switch strings.ToLower(path.Ext(filename)) {
	case ".mkv", ".mp4", ".mov", ".avi", ".webm", ".m4v", ".mpeg", ".mpg", ".wmv", ".ts":
		return "video"
	}
	return "document"
}

func Extract(message tg.MessageClass, source Source) Metadata {
	m := Metadata{Source: source, MessageID: message.GetID(), MediaType: "unavailable"}
	switch msg := message.(type) {
	case *tg.MessageService:
		m.MediaType = "service"
		m.Date = time.Unix(int64(msg.Date), 0).UTC().Format(time.RFC3339)
		return m
	case *tg.Message:
		m.Date = time.Unix(int64(msg.Date), 0).UTC().Format(time.RFC3339)
		m.Text = msg.Message
		switch attachment := msg.Media.(type) {
		case nil, *tg.MessageMediaEmpty:
			m.MediaType = "text"
		case *tg.MessageMediaPhoto:
			m.MediaType = "photo"
		case *tg.MessageMediaDocument:
			doc, ok := attachment.Document.(*tg.Document)
			if !ok {
				m.MediaType = "document_unavailable"
				return m
			}
			m.MIME, m.DocumentID = doc.MimeType, doc.ID
			size := doc.Size
			m.Size = &size
			video, animated, sticker, audio := false, false, false, false
			for _, attr := range doc.Attributes {
				switch a := attr.(type) {
				case *tg.DocumentAttributeFilename:
					m.Filename = a.FileName
					m.Attributes = append(m.Attributes, "filename: "+a.FileName)
				case *tg.DocumentAttributeVideo:
					video = true
					m.Attributes = append(m.Attributes, fmt.Sprintf("video: duration=%gs width=%d height=%d round=%t supports_streaming=%t", a.Duration, a.W, a.H, a.RoundMessage, a.SupportsStreaming))
				case *tg.DocumentAttributeAnimated:
					animated = true
					m.Attributes = append(m.Attributes, "animated")
				case *tg.DocumentAttributeSticker:
					sticker = true
					m.Attributes = append(m.Attributes, "sticker: "+a.Alt)
				case *tg.DocumentAttributeAudio:
					audio = true
					m.Attributes = append(m.Attributes, fmt.Sprintf("audio: duration=%ds voice=%t title=%s performer=%s", a.Duration, a.Voice, a.Title, a.Performer))
				case *tg.DocumentAttributeImageSize:
					m.Attributes = append(m.Attributes, fmt.Sprintf("image: width=%d height=%d", a.W, a.H))
				default:
					m.Attributes = append(m.Attributes, fmt.Sprintf("%T", attr))
				}
			}
			m.MediaType = Classify(m.Filename, m.MIME, video, animated, sticker, audio)
			if m.MediaType == "video" {
				title := Title(m.Text, m.Filename)
				m.Candidate = &title
			}
		default:
			m.MediaType = fmt.Sprintf("other:%T", attachment)
		}
	}
	return m
}
