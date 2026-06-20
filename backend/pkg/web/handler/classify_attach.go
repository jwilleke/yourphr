package handler

import (
	"encoding/json"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/allergyintolerance"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/careplan"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/condition"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/diagnosticreport"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/encounter"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/immunization"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/procedure"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// attachClassification runs the matching Layer-1 classifier for each classifier-backed resource and
// attaches the synthesized view-model to ResourceBase.Classified at read time. This keeps the legible
// state/verification/category synthesis in ONE place (the Go classifiers): detail cards (#308) and the
// /medical-history rows (#315/#351) consume the attached result — neither re-derives the rules in TS.
//
// Aggregate classifiers (medication.Reconcile, observation.RecognizeVitals) are intentionally NOT here:
// they classify ACROSS resources, so a single-resource view is degenerate — those keep their dedicated
// list endpoints. The resolver (shared with attachProvenance) is built only when at least one resource
// is classifier-backed.
func attachClassification(c *gin.Context, logger *logrus.Entry, repo database.DatabaseRepository, resources []*models.ResourceBase) {
	if len(resources) == 0 {
		return
	}
	any := false
	for _, r := range resources {
		if classifierBacked(r.SourceResourceType) {
			any = true
			break
		}
	}
	if !any {
		return
	}

	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, repo))
	sourceLabel := sourceLabelFunc(c, logger, repo)
	now := time.Now().UTC()
	for _, r := range resources {
		if classified := classifyOne(r, now, resolver, sourceLabel); classified != nil {
			r.Classified = classified
		}
	}
}

// classifierBacked reports whether a single resource of this type has a Layer-1 classifier that maps
// cleanly to one resource (excludes the aggregate medication/vitals recognizers).
func classifierBacked(resourceType string) bool {
	switch resourceType {
	case "Condition", "AllergyIntolerance", "Immunization", "Procedure", "DiagnosticReport", "Encounter", "CarePlan":
		return true
	}
	return false
}

// classifyOne dispatches a single resource to its classifier and returns the one synthesized row (or
// nil). Each classifier takes a slice; we pass a one-element slice and take the first result.
func classifyOne(r *models.ResourceBase, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(string) string) any {
	raw := json.RawMessage(r.ResourceRaw)
	st, sid, src := r.SourceResourceType, r.SourceResourceID, r.SourceID.String()
	switch st {
	case "Condition":
		if out := condition.Classify([]condition.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "AllergyIntolerance":
		if out := allergyintolerance.Classify([]allergyintolerance.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "Immunization":
		if out := immunization.Classify([]immunization.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "Procedure":
		if out := procedure.Classify([]procedure.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "DiagnosticReport":
		if out := diagnosticreport.Classify([]diagnosticreport.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "Encounter":
		if out := encounter.Classify([]encounter.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	case "CarePlan":
		if out := careplan.Classify([]careplan.InputResource{{SourceResourceType: st, SourceResourceID: sid, SourceID: src, Raw: raw}}, now, resolver, sourceLabel); len(out) > 0 {
			return out[0]
		}
	}
	return nil
}
