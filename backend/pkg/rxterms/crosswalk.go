package rxterms

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"strings"
	"sync"
)

// crosswalkGz is the offline RxTerms crosswalk (#387): a gzipped TSV of "<RXCUI>\t<name - strength>",
// generated from NLM's RxTerms release by gen_crosswalk.go. Source: NLM RxTerms (RxNorm-derived
// interface terminology, freely distributed). Regenerate + commit to refresh.
//
//go:embed data/rxterms_crosswalk.tsv.gz
var crosswalkGz []byte

// Crosswalk is an in-memory RxCUI -> patient-friendly-name map backed by the embedded RxTerms data.
// Fully offline (no network). Lazy-loaded + cached on first lookup.
type Crosswalk struct {
	once sync.Once
	m    map[string]string
}

var defaultCrosswalk = &Crosswalk{}

// DefaultCrosswalk returns the process-wide embedded crosswalk.
func DefaultCrosswalk() *Crosswalk { return defaultCrosswalk }

// Lookup returns the RxTerms "<name> - <strength>" for an RxCUI, or "" if it isn't in the crosswalk.
func (c *Crosswalk) Lookup(rxcui string) string {
	rxcui = strings.TrimSpace(rxcui)
	if rxcui == "" {
		return ""
	}
	c.once.Do(c.load)
	return c.m[rxcui]
}

// Len returns the number of loaded entries (diagnostics/tests).
func (c *Crosswalk) Len() int {
	c.once.Do(c.load)
	return len(c.m)
}

func (c *Crosswalk) load() {
	c.m = map[string]string{}
	gr, err := gzip.NewReader(bytes.NewReader(crosswalkGz))
	if err != nil {
		return // embedded data is corrupt/absent — degrade to an empty crosswalk (callers fall back to the title)
	}
	defer gr.Close()
	sc := bufio.NewScanner(gr)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if tab := strings.IndexByte(line, '\t'); tab > 0 {
			c.m[line[:tab]] = line[tab+1:]
		}
	}
}
