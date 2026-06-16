package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/coverage"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetCoveragesClassified returns the authenticated user's Coverage resources rendered in plain
// language (e.g. "Medicare Part A — Hospital, active since 1999-09-08"), plus a rolled-up summary
// ("Active Medicare: Part A, B, C, D"). Stateless compute-on-request — see pkg/coverage and #295.
func GetCoveragesClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Coverage"})
	if err != nil {
		logger.Errorf("error listing Coverage resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]coverage.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, coverage.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	classified := coverage.Classify(inputs, time.Now().UTC())
	summary := coverage.Summarize(classified)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"coverages": classified, "summary": summary}})
}
