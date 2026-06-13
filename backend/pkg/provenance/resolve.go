// Package provenance resolves FHIR references and answers "who said this?" for a resource, with the
// quirks real exports require. It is the shared plumbing the architecture calls for (solve once):
// the same reference resolver underpins both provenance and the medication card's reference needs
// (#264), and the same provenance ladder works for any resource type.
//
// Reference resolution handles three forms: relative "Type/id", absolute-URL references, and the
// FollowMyHealth Encounter trap "Encounter/<patientId>_<encounterId>" (underscore-joined) — where a
// naive lookup of the whole blob silently finds nothing until the patient prefix is stripped.
//
// Pure and stateless over a provided resource set — no DB, no HTTP. See
// docs/your-phr-dashboard/classification-and-display-architecture.md and
// docs/vendors/followmyhealth-ehi-mapping.md.
package provenance

import (
	"encoding/json"
	"strings"
)

// Resource is one stored FHIR resource available for reference resolution.
type Resource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// Reference is a FHIR reference (the string plus the optional display the source may have inlined).
type Reference struct {
	Reference string `json:"reference"`
	Display   string `json:"display"`
}

// ResourceSet indexes resources by "Type/id" for reference resolution, and indexes any Provenance
// resources by the targets they point at (for the provenance ladder).
type ResourceSet struct {
	byKey        map[string]Resource   // "Type/id" -> resource
	provByTarget map[string][]Resource // "Type/id" -> Provenance resources targeting it
}

// NewResourceSet builds the lookup indexes from a flat resource list.
func NewResourceSet(resources []Resource) *ResourceSet {
	s := &ResourceSet{
		byKey:        make(map[string]Resource, len(resources)),
		provByTarget: map[string][]Resource{},
	}
	for _, r := range resources {
		if r.SourceResourceType != "" && r.SourceResourceID != "" {
			s.byKey[r.SourceResourceType+"/"+r.SourceResourceID] = r
		}
		if r.SourceResourceType == "Provenance" {
			var p struct {
				Target []Reference `json:"target"`
			}
			if json.Unmarshal(r.Raw, &p) == nil {
				for _, t := range p.Target {
					if typ, id := parseReference(t.Reference); typ != "" {
						key := typ + "/" + id
						s.provByTarget[key] = append(s.provByTarget[key], r)
					}
				}
			}
		}
	}
	return s
}

// Resolve resolves a FHIR reference string to a stored resource, handling relative, absolute-URL, and
// the FollowMyHealth Encounter "<patientId>_<encounterId>" underscore form.
func (s *ResourceSet) Resolve(reference string) (Resource, bool) {
	typ, id := parseReference(reference)
	if typ == "" || id == "" {
		return Resource{}, false
	}
	// FollowMyHealth Encounter trap: strip the "<patientId>_" prefix and match Encounter.id first.
	if typ == "Encounter" {
		if i := strings.Index(id, "_"); i >= 0 {
			if r, ok := s.lookup(typ, id[i+1:]); ok {
				return r, true
			}
		}
	}
	return s.lookup(typ, id)
}

func (s *ResourceSet) lookup(typ, id string) (Resource, bool) {
	r, ok := s.byKey[typ+"/"+id]
	return r, ok
}

// parseReference extracts (type, id) from a reference string, taking the last two path segments so
// that both "Type/id" and absolute URLs ".../Type/id" resolve. Returns ("","") when malformed.
func parseReference(ref string) (typ, id string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ""
	}
	// drop a fragment/contained marker; keep it simple — references we handle are literal.
	parts := strings.Split(strings.Trim(ref, "/"), "/")
	if len(parts) < 2 {
		return "", ""
	}
	return parts[len(parts)-2], parts[len(parts)-1]
}
