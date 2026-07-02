package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/medication"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/rxterms"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// rxTermsResolver is a process-wide, cached RxCUI -> patient-friendly-name resolver (#387 prototype).
var rxTermsResolver = rxterms.NewResolver()

// the resource types that feed the reconciled medications list (Medication is referenced by the
// others — contained or by-reference — and contributes a name, but is not a row on its own).
var medicationResourceTypes = []string{
	"MedicationRequest",
	"MedicationStatement",
	"MedicationDispense",
	"Medication",
}

// GetMedicationsReconciled returns the derived "Current Medications" list for the authenticated
// user. It is a stateless compute-on-request derivation over the stored medication resources (never
// materialized) — see docs/planning/medications-brainstorm-session.md and pkg/medication.
func GetMedicationsReconciled(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	var inputs []medication.InputResource
	for _, resourceType := range medicationResourceTypes {
		resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: resourceType})
		if err != nil {
			logger.Errorf("error listing %s resources for reconciliation: %v", resourceType, err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
			return
		}
		for i := range resources {
			inputs = append(inputs, medication.InputResource{
				SourceResourceType: resources[i].SourceResourceType,
				SourceResourceID:   resources[i].SourceResourceID,
				SourceID:           resources[i].SourceID.String(),
				Raw:                json.RawMessage(resources[i].ResourceRaw),
			})
		}
	}

	// Resolve "who said this" against the referenceable resources, with a SourceID -> name map for the
	// floor. Both best-effort (shared with the conditions handler); failures degrade to a lower rung.
	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, databaseRepo))
	sourceLabel := sourceLabelFunc(c, logger, databaseRepo)

	reconciled := medication.Reconcile(inputs, time.Now().UTC(), resolver, sourceLabel)

	// #387 (opt-in): enrich each coded med with a patient-friendly RxTerms name + strength. Primary
	// source is the embedded OFFLINE crosswalk (no network); meds without an RxCUI (or a crosswalk
	// miss) keep their raw title. Enable with medications.rxterms_enrich.
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	if appConfig.GetBool("medications.rxterms_enrich") {
		cw := rxterms.DefaultCrosswalk()
		for i := range reconciled {
			if reconciled[i].RxNormCode != "" {
				if name, strength := cw.Lookup(reconciled[i].RxNormCode); name != "" {
					reconciled[i].PatientDisplay = name
					reconciled[i].Strength = strength
				}
			}
		}
		// Optional external fallback for RxCUIs not in the bundled crosswalk (e.g. very new drugs):
		// query the RxNav API. Off by default so the enriched path stays fully offline.
		if appConfig.GetBool("medications.rxterms_api_fallback") {
			enrichRxTermsDisplayAPI(c.Request.Context(), reconciled)
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": reconciled})
}

// enrichRxTermsDisplayAPI fills PatientDisplay for coded meds still unresolved by the crosswalk, via
// the RxNav API — bounded-parallel so a long list doesn't serialize round-trips, best-effort (misses
// keep the raw title), and cached across requests by the resolver.
func enrichRxTermsDisplayAPI(ctx context.Context, meds []medication.ReconciledMedication) {
	const maxConcurrent = 8
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	for i := range meds {
		if meds[i].RxNormCode == "" || meds[i].PatientDisplay != "" {
			continue // no code, or already resolved by the crosswalk
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			if name, strength := rxTermsResolver.Resolve(ctx, meds[i].RxNormCode); name != "" {
				meds[i].PatientDisplay = name
				meds[i].Strength = strength
			}
		}(i)
	}
	wg.Wait()
}
