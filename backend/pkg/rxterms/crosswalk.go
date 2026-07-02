package rxterms

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"strings"
	"sync"
)

// crosswalkGz is the offline RxTerms crosswalk (#387): a gzipped TSV of "<RXCUI>\t<name>\t<strength>",
// generated from NLM's RxTerms release by gen_crosswalk.go. Source: NLM RxTerms (RxNorm-derived
// interface terminology, freely distributed). Regenerate + commit to refresh.
//
//go:embed data/rxterms_crosswalk.tsv.gz
var crosswalkGz []byte

type entry struct{ name, strength string }

// Crosswalk is an in-memory RxCUI -> {name, strength} map backed by the embedded RxTerms data. Fully
// offline (no network). Lazy-loaded + cached on first lookup.
type Crosswalk struct {
	once sync.Once
	m    map[string]entry
}

var defaultCrosswalk = &Crosswalk{}

// DefaultCrosswalk returns the process-wide embedded crosswalk.
func DefaultCrosswalk() *Crosswalk { return defaultCrosswalk }

// Lookup returns the patient-friendly name and strength for an RxCUI (either may be "" if absent).
// name is the drug identity (e.g. "Acetaminophen (Oral Pill)"); strength is per-unit (e.g. "325 mg").
func (c *Crosswalk) Lookup(rxcui string) (name, strength string) {
	rxcui = strings.TrimSpace(rxcui)
	if rxcui == "" {
		return "", ""
	}
	c.once.Do(c.load)
	e := c.m[rxcui]
	return e.name, e.strength
}

// Len returns the number of loaded entries (diagnostics/tests).
func (c *Crosswalk) Len() int {
	c.once.Do(c.load)
	return len(c.m)
}

func (c *Crosswalk) load() {
	c.m = map[string]entry{}
	gr, err := gzip.NewReader(bytes.NewReader(crosswalkGz))
	if err != nil {
		return // embedded data corrupt/absent — degrade to empty (callers fall back to the title)
	}
	defer gr.Close()
	sc := bufio.NewScanner(gr)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	for sc.Scan() {
		parts := strings.SplitN(sc.Text(), "\t", 3)
		if len(parts) < 2 || parts[0] == "" {
			continue
		}
		e := entry{name: parts[1]}
		if len(parts) == 3 {
			e.strength = parts[2]
		}
		c.m[parts[0]] = e
	}
}
