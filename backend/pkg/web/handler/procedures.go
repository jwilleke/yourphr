package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/procedure"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// GetProceduresClassified returns the classified Procedure list for the authenticated user: a
// stateless compute-on-request derivation that maps the status to a legible state, surfaces body
// site / reason / outcome, and resolves "who performed it". See pkg/procedure and #309.
func GetProceduresClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Procedure"})
	if err != nil {
		logger.Errorf("error listing Procedure resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]procedure.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, procedure.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, databaseRepo))
	sourceLabel := sourceLabelFunc(c, logger, databaseRepo)

	classified := procedure.Classify(inputs, time.Now().UTC(), resolver, sourceLabel)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}
