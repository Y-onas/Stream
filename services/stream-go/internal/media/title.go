package media

import (
	"path"
	"regexp"
	"strings"
)

type Candidate struct {
	Title     string `json:"title"`
	Source    string `json:"derived_from"`
	Uncertain bool   `json:"uncertain"`
}

var explicitTitle = regexp.MustCompile(`(?i)^(?:movie(?: title)?|title|film)\s*[:=-]\s*(.+)$`)
var releaseStart = regexp.MustCompile(`(?i)(?:^|[ ._\[\](\-])(?:360p|480p|576p|720p|1080[pi]|1440p|2160p|4320p|4k|8k|web[ ._-]?dl|webrip|bluray|blu[ ._-]?ray|brrip|bdrip|dvdrip|hdtv|x26[45]|h[ ._-]?26[45]|hevc|av1|remux)(?:$|[ ._\[\])\-])`)
var yearPattern = regexp.MustCompile(`^(.*?)\s*[\[(]?((?:19|20)\d{2})[\])]?\s*$`)

// StripExtension removes one file extension, preserving dots in the base name.
func StripExtension(filename string) string {
	filename = path.Base(strings.ReplaceAll(strings.TrimSpace(filename), `\`, "/"))
	return strings.TrimSuffix(filename, path.Ext(filename))
}

func Title(caption, filename string) Candidate {
	for _, line := range strings.Split(caption, "\n") {
		if match := explicitTitle.FindStringSubmatch(strings.TrimSpace(line)); len(match) == 2 {
			if title := strings.TrimSpace(match[1]); title != "" {
				return Candidate{Title: title, Source: "explicit caption/text label", Uncertain: true}
			}
		}
	}
	if strings.TrimSpace(filename) == "" {
		return Candidate{Source: "unavailable: no explicit title or filename", Uncertain: true}
	}
	base := StripExtension(filename)
	clean := base
	removed := false
	if loc := releaseStart.FindStringIndex(clean); loc != nil && loc[0] > 0 {
		clean = clean[:loc[0]]
		removed = true
	}
	clean = strings.Join(strings.Fields(strings.NewReplacer(".", " ", "_", " ").Replace(clean)), " ")
	clean = strings.TrimSpace(strings.TrimRight(clean, " -_["))
	if match := yearPattern.FindStringSubmatch(clean); len(match) == 3 && strings.TrimSpace(match[1]) != "" {
		clean = strings.TrimSpace(match[1]) + " (" + match[2] + ")"
	}
	if clean == "" {
		clean = base
	}
	source := "filename without extension"
	if clean != base {
		source = "normalized filename"
	}
	if removed {
		source = "cleaned filename (release suffix removed heuristically)"
	}
	return Candidate{Title: clean, Source: source, Uncertain: true}
}
