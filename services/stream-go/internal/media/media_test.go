package media

import (
	"github.com/gotd/td/tg"
	"testing"
)

func TestStripExtension(t *testing.T) {
	for in, want := range map[string]string{"Example.Movie.mkv": "Example.Movie", "Movie": "Movie", `C:\media\Movie.MP4`: "Movie", "a/b/Movie.part1.mkv": "Movie.part1"} {
		if got := StripExtension(in); got != want {
			t.Errorf("%q: %q != %q", in, got, want)
		}
	}
}

func TestTitle(t *testing.T) {
	for _, tc := range []struct{ caption, filename, want string }{
		{"", "Example.Movie.2024.1080p.WEB-DL.x264.mkv", "Example Movie (2024)"},
		{"Movie title: Actual Name (2023)\nEnjoy!", "Other.2024.mkv", "Actual Name (2023)"},
		{"Join our group!", "Example.Movie.mkv", "Example Movie"},
		{"", "Show.S01E02.1080p.mkv", "Show S01E02"},
		{"", "The.Web.2024.mkv", "The Web (2024)"},
		{"", "1917.2019.1080p.mkv", "1917 (2019)"},
		{"", "Movie.Trailer.2024.mp4", "Movie Trailer (2024)"},
		{"unlabelled caption", "", ""},
	} {
		got := Title(tc.caption, tc.filename)
		if got.Title != tc.want || !got.Uncertain || got.Source == "" {
			t.Errorf("%q: %#v", tc.filename, got)
		}
	}
}

func TestClassify(t *testing.T) {
	for _, tc := range []struct {
		name, mime                      string
		video, animated, sticker, audio bool
		want                            string
	}{
		{"movie.mkv", "application/octet-stream", false, false, false, false, "video"},
		{"", "video/mp4", false, false, false, false, "video"},
		{"", "", true, false, false, false, "video"},
		{"notes.pdf", "application/pdf", false, false, false, false, "document"},
		{"", "", false, false, false, false, "document"},
		{"anim.mp4", "video/mp4", true, true, false, false, "animation"},
		{"sticker.webm", "video/webm", true, false, true, false, "sticker"},
		{"", "audio/mpeg", false, false, false, false, "audio"},
	} {
		if got := Classify(tc.name, tc.mime, tc.video, tc.animated, tc.sticker, tc.audio); got != tc.want {
			t.Errorf("%+v => %s", tc, got)
		}
	}
}

func TestExtractPreservesMetadata(t *testing.T) {
	source := Source{Name: "Test", ID: 12, Kind: "channel"}
	msg := &tg.Message{ID: 42, Date: 1700000000, Message: "Title: Test Film", Media: &tg.MessageMediaDocument{Document: &tg.Document{ID: 9, Size: 1234, MimeType: "video/x-matroska", Attributes: []tg.DocumentAttributeClass{&tg.DocumentAttributeFilename{FileName: "Original.Name.mkv"}}}}}
	got := Extract(msg, source)
	if got.Source != source || got.MessageID != 42 || got.Text != msg.Message || got.Filename != "Original.Name.mkv" || got.Size == nil || *got.Size != 1234 || got.Candidate.Title != "Test Film" {
		t.Fatalf("%+v", got)
	}
	missing := Extract(&tg.Message{ID: 1, Media: &tg.MessageMediaDocument{Document: &tg.Document{}}}, source)
	if missing.MediaType != "document" || missing.Filename != "" || missing.MIME != "" || missing.Candidate != nil {
		t.Fatalf("%+v", missing)
	}
	if Extract(&tg.Message{ID: 2, Media: &tg.MessageMediaPhoto{}}, source).MediaType != "photo" {
		t.Fatal("photo classification")
	}
}
