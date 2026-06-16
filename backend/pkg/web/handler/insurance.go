package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/coverage"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/explanationofbenefit"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/patientlink"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// patientInsuranceGroup is the claims + coverage that resolve to one imported patient, rendered for
// display (the classified items themselves, not just their IDs).
type patientInsuranceGroup struct {
	Patient  patientlink.PatientCard              `json:"patient"`
	Claims   []explanationofbenefit.ClassifiedEOB `json:"claims"`
	Coverage []coverage.ClassifiedCoverage        `json:"coverage"`
}

// GetPatientInsuranceClaims surfaces the patient's Medicare/insurance claims (ExplanationOfBenefit) and
// Coverage grouped under the patient each explicitly references — the third leg of the Medicare display
// work (#296), tying the EOB classifier (#294) and Coverage classifier (#295) to the imported Patient.
//
// Association is explicit-reference only (no-guessing): a claim/coverage is shown under a patient solely
// because its `patient`/`beneficiary` reference resolves to an imported Patient. Anything that names no
// resolvable patient is returned in `unresolved` rather than silently attached. Stateless compute-on-request.
func GetPatientInsuranceClaims(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	patientsRaw, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Patient"})
	if err != nil {
		logger.Errorf("error listing Patient resources: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	eobRaw, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "ExplanationOfBenefit"})
	if err != nil {
		logger.Errorf("error listing ExplanationOfBenefit resources: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	coverageRaw, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Coverage"})
	if err != nil {
		logger.Errorf("error listing Coverage resources: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// Build the patient resolver and classify the two resource types.
	patients := make([]provenance.Resource, 0, len(patientsRaw))
	for i := range patientsRaw {
		patients = append(patients, provenance.Resource{
			SourceResourceType: patientsRaw[i].SourceResourceType,
			SourceResourceID:   patientsRaw[i].SourceResourceID,
			SourceID:           patientsRaw[i].SourceID.String(),
			Raw:                json.RawMessage(patientsRaw[i].ResourceRaw),
		})
	}
	resolver := patientlink.NewResolver(patients)

	eobInputs := make([]explanationofbenefit.InputResource, 0, len(eobRaw))
	for i := range eobRaw {
		eobInputs = append(eobInputs, explanationofbenefit.InputResource{
			SourceResourceType: eobRaw[i].SourceResourceType,
			SourceResourceID:   eobRaw[i].SourceResourceID,
			SourceID:           eobRaw[i].SourceID.String(),
			Raw:                json.RawMessage(eobRaw[i].ResourceRaw),
		})
	}
	claims := explanationofbenefit.Classify(eobInputs, time.Now().UTC())

	covInputs := make([]coverage.InputResource, 0, len(coverageRaw))
	for i := range coverageRaw {
		covInputs = append(covInputs, coverage.InputResource{
			SourceResourceType: coverageRaw[i].SourceResourceType,
			SourceResourceID:   coverageRaw[i].SourceResourceID,
			SourceID:           coverageRaw[i].SourceID.String(),
			Raw:                json.RawMessage(coverageRaw[i].ResourceRaw),
		})
	}
	coverages := coverage.Classify(covInputs, time.Now().UTC())

	// Associate by explicit reference, then re-attach the classified items to their patient group.
	claimItems := make([]patientlink.Item, len(claims))
	claimByID := make(map[string]explanationofbenefit.ClassifiedEOB, len(claims))
	for i, e := range claims {
		claimItems[i] = patientlink.Item{ID: e.SourceResourceID, PatientRef: e.PatientRef}
		claimByID[e.SourceResourceID] = e
	}
	covItems := make([]patientlink.Item, len(coverages))
	covByID := make(map[string]coverage.ClassifiedCoverage, len(coverages))
	for i, cv := range coverages {
		covItems[i] = patientlink.Item{ID: cv.SourceResourceID, PatientRef: cv.BeneficiaryRef}
		covByID[cv.SourceResourceID] = cv
	}

	assoc := resolver.Associate(claimItems, covItems)

	groups := make([]patientInsuranceGroup, 0, len(assoc.Patients))
	for _, g := range assoc.Patients {
		grp := patientInsuranceGroup{Patient: g.Patient, Claims: []explanationofbenefit.ClassifiedEOB{}, Coverage: []coverage.ClassifiedCoverage{}}
		for _, id := range g.ClaimIDs {
			grp.Claims = append(grp.Claims, claimByID[id])
		}
		for _, id := range g.CoverageIDs {
			grp.Coverage = append(grp.Coverage, covByID[id])
		}
		groups = append(groups, grp)
	}

	unresolvedClaims := make([]explanationofbenefit.ClassifiedEOB, 0, len(assoc.UnresolvedClaims))
	for _, id := range assoc.UnresolvedClaims {
		unresolvedClaims = append(unresolvedClaims, claimByID[id])
	}
	unresolvedCoverage := make([]coverage.ClassifiedCoverage, 0, len(assoc.UnresolvedCoverage))
	for _, id := range assoc.UnresolvedCoverage {
		unresolvedCoverage = append(unresolvedCoverage, covByID[id])
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"patients": groups,
			"unresolved": gin.H{
				"claims":   unresolvedClaims,
				"coverage": unresolvedCoverage,
			},
		},
	})
}
