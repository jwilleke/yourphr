package condition

import (
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// Reconcile derives the deduped "problem list" view of a patient's conditions: it runs Classify (the
// faithful, locked 1:1 classifier) and then collapses conditions that denote the SAME clinical concept
// — the same standard code, or the same title when uncoded — into a single entry.
//
// This is deliberately separate from Classify. Classify is locked to "report facts as the source
// provided them" (one row per Condition; see the package doc), so it never merges. Reconcile is the
// reconciler — the sanctioned home for dedup — mirroring medication.Reconcile. The route
// /conditions/classified stays faithful; /conditions/reconciled (this) backs the problem-list view,
// where a patient should see one "Ischemic chest pain", not the three visit-diagnosis copies Epic
// returns (#262).
func Reconcile(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedCondition {
	return dedupe(Classify(resources, now, resolver, sourceLabel))
}

// dedupe collapses same-concept conditions, preserving first-seen order so the list stays stable. The
// kept representative is the most recently recorded record (ties broken by richer coding).
func dedupe(conditions []ClassifiedCondition) []ClassifiedCondition {
	index := make(map[string]int, len(conditions)) // dedupe key -> position in out
	out := make([]ClassifiedCondition, 0, len(conditions))
	for _, c := range conditions {
		key := dedupeKey(c)
		if pos, seen := index[key]; seen {
			if preferCondition(c, out[pos]) {
				out[pos] = c // keep the better representative, in the original slot
			}
			continue
		}
		index[key] = len(out)
		out = append(out, c)
	}
	return out
}

// dedupeKey is a stable identity for a condition: its preferred standard code (SNOMED first, then any
// ICD), else the lowercased title. Two conditions with the same key denote the same clinical concept —
// e.g. a problem-list entry plus the encounter-diagnosis recordings of that same problem at each visit,
// which vendors (Epic) return as separate Condition resources. Never fuzzy: under-merge is safe,
// wrong-merge is dangerous (mirrors medication.dedupKey).
func dedupeKey(c ClassifiedCondition) string {
	var snomed, icd string
	for _, cd := range c.StandardCodings {
		sys := strings.ToLower(cd.System)
		switch {
		case strings.Contains(sys, "snomed") && snomed == "":
			snomed = "snomed|" + cd.Code
		case strings.Contains(sys, "icd") && icd == "":
			icd = "icd|" + cd.Code
		}
	}
	switch {
	case snomed != "":
		return snomed
	case icd != "":
		return icd
	default:
		return "title|" + strings.ToLower(strings.TrimSpace(c.Title))
	}
}

// preferCondition reports whether a should replace b as the representative for a duplicate group:
// more recently recorded wins; ties go to the one carrying more standard codings.
func preferCondition(a, b ClassifiedCondition) bool {
	if a.Recorded != b.Recorded {
		return a.Recorded > b.Recorded // ISO dates sort lexically; "" (unknown) loses
	}
	return len(a.StandardCodings) > len(b.StandardCodings)
}
