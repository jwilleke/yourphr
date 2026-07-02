# Embedded RxTerms crosswalk

`rxterms_crosswalk.tsv.gz` is a gzipped TSV of `<RXCUI>\t<DISPLAY_NAME[ - STRENGTH]>` — the offline
lookup that turns raw RxNorm names into patient-friendly ones (#387), e.g.
`313782 → Acetaminophen (Oral Pill) - 325 mg`. It is embedded into the binary via `go:embed`
(`../crosswalk.go`), so medication display works with **no network call**.

## Source & attribution

Derived from **NLM RxTerms** — a drug interface terminology derived from RxNorm, freely distributed by
the U.S. National Library of Medicine (Lister Hill National Center for Biomedical Communications):

- <https://lhncbc.nlm.nih.gov/MOR/RxTerms/>
- Releases: <https://data.lhncbc.nlm.nih.gov/public/rxterms/release/>

Only the RxTerms-generated `DISPLAY_NAME` and `STRENGTH` columns are used (RxTerms's own value-add over
RxNorm normal forms — no restricted UMLS source-vocabulary text). Current file built from release
**RxTerms202606**.

## Regenerating (refresh to a newer release)

```bash
make gen-rxterms-crosswalk                          # latest pinned release
make gen-rxterms-crosswalk RXTERMS_RELEASE=RxTerms202609
```

That downloads + unzips the release and rewrites this file via `../gen_crosswalk.go`. Commit the result.
