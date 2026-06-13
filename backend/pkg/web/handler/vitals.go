package handler

import (
	"encoding/json"
	"net/http"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/observation"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetVitalsRecognized returns the patient's vital-sign Observations as legible view-models: a
// stateless compute-on-request derivation that fills the human label US Core Vital Signs LOINC codes
// imply (sources such as FollowMyHealth leave code.coding[].display blank) and validates each unit
// against the US Core expectation. Non-vital Observations (step counts, labs, …) are skipped. Never
// materialized — see pkg/observation and docs/your-phr-dashboard/classification-and-display-architecture.md.
func GetVitalsRecognized(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Observation"})
	if err != nil {
		logger.Errorf("error listing Observation resources for vitals recognition: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]observation.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, observation.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	recognized := observation.RecognizeVitals(inputs)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": recognized})
}
