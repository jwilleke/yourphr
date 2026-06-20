package handler

import (
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/allergyintolerance"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/encounter"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/google/uuid"
)

// classifyOne dispatches a single resource to the right Layer-1 classifier and returns its view-model.
func TestClassifyOne(t *testing.T) {
	resolver := provenance.NewResourceSet(nil)
	now := time.Now().UTC()

	mk := func(typ, body string) *models.ResourceBase {
		r := &models.ResourceBase{ResourceRaw: []byte(body)}
		r.SourceResourceType = typ
		r.SourceResourceID = "x1"
		r.SourceID = uuid.Nil
		return r
	}

	// AllergyIntolerance -> ClassifiedAllergy with synthesized verification.
	got := classifyOne(mk("AllergyIntolerance", `{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[{"code":"confirmed"}]},"clinicalStatus":{"coding":[{"code":"active"}]},"code":{"text":"Penicillin"}}`), now, resolver, nil)
	allergy, ok := got.(allergyintolerance.ClassifiedAllergy)
	if !ok {
		t.Fatalf("expected ClassifiedAllergy, got %T", got)
	}
	if allergy.Verification != allergyintolerance.VerifConfirmed || allergy.State != allergyintolerance.StateActive {
		t.Errorf("allergy classified = %+v, want Confirmed/Active", allergy)
	}

	// Encounter -> ClassifiedEncounter with legible class category.
	got = classifyOne(mk("Encounter", `{"resourceType":"Encounter","status":"finished","class":{"code":"AMB"}}`), now, resolver, nil)
	enc, ok := got.(encounter.ClassifiedEncounter)
	if !ok {
		t.Fatalf("expected ClassifiedEncounter, got %T", got)
	}
	if enc.Category != "Office visit" || enc.State != encounter.StateFinished {
		t.Errorf("encounter classified = %+v, want Office visit/Finished", enc)
	}

	// A non-classifier-backed type returns nil (Patient has no single-resource classifier).
	if got := classifyOne(mk("Patient", `{"resourceType":"Patient","id":"p1"}`), now, resolver, nil); got != nil {
		t.Errorf("Patient should not classify, got %T", got)
	}
}

func TestClassifierBacked(t *testing.T) {
	for _, typ := range []string{"Condition", "AllergyIntolerance", "Immunization", "Procedure", "DiagnosticReport", "Encounter", "CarePlan"} {
		if !classifierBacked(typ) {
			t.Errorf("%s should be classifier-backed", typ)
		}
	}
	for _, typ := range []string{"Patient", "Device", "Goal", "ServiceRequest", "Observation", "MedicationRequest"} {
		if classifierBacked(typ) {
			t.Errorf("%s should NOT be classifier-backed (aggregate/raw)", typ)
		}
	}
}
