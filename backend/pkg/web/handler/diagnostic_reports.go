package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/diagnosticreport"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetDiagnosticReportsClassified returns the classified DiagnosticReport list: status -> legible state,
// a legible service category (Laboratory/Imaging/Pathology), and resolved provenance. See #309.
func GetDiagnosticReportsClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "DiagnosticReport"})
	if err != nil {
		logger.Errorf("error listing DiagnosticReport resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]diagnosticreport.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, diagnosticreport.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, databaseRepo))
	sourceLabel := sourceLabelFunc(c, logger, databaseRepo)

	classified := diagnosticreport.Classify(inputs, time.Now().UTC(), resolver, sourceLabel)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}
