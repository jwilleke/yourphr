package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/explanationofbenefit"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetClaimsClassified returns the authenticated user's ExplanationOfBenefit (claims) rendered in plain
// language: a category ("Professional / doctor services", "Hospital — inpatient", …), service date,
// provider, insurer, diagnoses, and the costs as the record states them plus the amount paid. Stateless
// compute-on-request. Claims are NOT joined to clinical encounters here — that coordination is a
// separate, patient-confirmed step. See pkg/explanationofbenefit and #294.
func GetClaimsClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "ExplanationOfBenefit"})
	if err != nil {
		logger.Errorf("error listing ExplanationOfBenefit resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]explanationofbenefit.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, explanationofbenefit.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	classified := explanationofbenefit.Classify(inputs, time.Now().UTC())
	c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}
