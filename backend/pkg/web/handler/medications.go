package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/medication"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

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
				Raw:                json.RawMessage(resources[i].ResourceRaw),
			})
		}
	}

	reconciled := medication.Reconcile(inputs, time.Now().UTC())
	c.JSON(http.StatusOK, gin.H{"success": true, "data": reconciled})
}
