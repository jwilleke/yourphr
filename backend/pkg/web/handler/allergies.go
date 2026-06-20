package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/allergyintolerance"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetAllergiesClassified returns the classified AllergyIntolerance list for the authenticated user: a
// stateless compute-on-request derivation that synthesizes a patient-legible verification label
// (Confirmed/Presumed/Unconfirmed/Refuted) + display state and resolves "who said this". Never
// materialized — see pkg/allergyintolerance and #309.
func GetAllergiesClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "AllergyIntolerance"})
	if err != nil {
		logger.Errorf("error listing AllergyIntolerance resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]allergyintolerance.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, allergyintolerance.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	// Reuse the shared provenance plumbing (loadProvenanceResources + sourceLabelFunc, conditions.go).
	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, databaseRepo))
	sourceLabel := sourceLabelFunc(c, logger, databaseRepo)

	classified := allergyintolerance.Classify(inputs, time.Now().UTC(), resolver, sourceLabel)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}
