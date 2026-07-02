//go:build ignore

// gen_crosswalk builds the embedded offline RxTerms crosswalk (#387) from NLM's RxTerms release file.
//
// Usage (from repo root), after downloading + unzipping a release from
// https://data.lhncbc.nlm.nih.gov/public/rxterms/release/ (e.g. RxTerms202606.zip):
//
//	go run backend/pkg/rxterms/gen_crosswalk.go /path/to/RxTerms<YYYYMM>.txt
//
// It writes backend/pkg/rxterms/data/rxterms_crosswalk.tsv.gz — a gzipped TSV of
// "<RXCUI>\t<DISPLAY_NAME[ - STRENGTH]>" — which crosswalk.go embeds. Re-run to refresh; commit the
// regenerated file. Source data: NLM RxTerms (RxNorm-derived interface terminology, freely distributed).
package main

import (
	"bufio"
	"compress/gzip"
	"fmt"
	"os"
	"strings"
)

// pipe-delimited column indexes in the RxTerms release file (0-based).
const (
	colRXCUI       = 0
	colDisplayName = 7
	colStrength    = 10
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run gen_crosswalk.go /path/to/RxTerms<YYYYMM>.txt")
		os.Exit(2)
	}
	in, err := os.Open(os.Args[1])
	must(err)
	defer in.Close()

	const outPath = "backend/pkg/rxterms/data/rxterms_crosswalk.tsv.gz"
	must(os.MkdirAll("backend/pkg/rxterms/data", 0o755))
	out, err := os.Create(outPath)
	must(err)
	defer out.Close()
	gw := gzip.NewWriter(out)

	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	first, n := true, 0
	for sc.Scan() {
		if first { // header row
			first = false
			continue
		}
		cols := strings.Split(sc.Text(), "|")
		if len(cols) <= colStrength {
			continue
		}
		rxcui, name, strength := cols[colRXCUI], strings.TrimSpace(cols[colDisplayName]), strings.TrimSpace(cols[colStrength])
		if rxcui == "" || name == "" {
			continue
		}
		if strength != "" {
			name = name + " - " + strength
		}
		fmt.Fprintf(gw, "%s\t%s\n", rxcui, name)
		n++
	}
	must(sc.Err())
	must(gw.Close())
	fmt.Printf("wrote %d entries to %s\n", n, outPath)
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
