package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/condition"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// provenanceRefTypes are the resource types a Condition's provenance chain can reference. They are
// loaded into a ResourceSet so "who said this" resolves to named practitioners/organizations.
var provenanceRefTypes = []string{"Practitioner", "PractitionerRole", "Organization", "Encounter", "Provenance"}

// GetConditionsClassified returns the classified Condition list for the authenticated user: a
// stateless compute-on-request derivation that synthesizes Condition.category and a display state,
// separating real health problems from social/administrative "Personal Health Conditions". Never
// materialized — see pkg/condition and docs/your-phr-dashboard/phase-1-condition-classifier-spec.md.
func GetConditionsClassified(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Condition"})
	if err != nil {
		logger.Errorf("error listing Condition resources for classification: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	inputs := make([]condition.InputResource, 0, len(resources))
	for i := range resources {
		inputs = append(inputs, condition.InputResource{
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			SourceID:           resources[i].SourceID.String(),
			Raw:                json.RawMessage(resources[i].ResourceRaw),
		})
	}

	// Build the resolver from the resources a provenance chain can reference, plus a SourceID -> name
	// map for the floor ("Source: <name>"). Both are best-effort: failures degrade to a lower rung.
	resolver := provenance.NewResourceSet(loadProvenanceResources(c, logger, databaseRepo))
	sourceLabel := sourceLabelFunc(c, logger, databaseRepo)

	classified := condition.Classify(inputs, time.Now().UTC(), resolver, sourceLabel)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}

// loadProvenanceResources loads the resource types a Condition's provenance chain references.
func loadProvenanceResources(c *gin.Context, logger *logrus.Entry, repo database.DatabaseRepository) []provenance.Resource {
	var out []provenance.Resource
	for _, rt := range provenanceRefTypes {
		resources, err := repo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: rt})
		if err != nil {
			logger.Warnf("provenance: could not list %s resources: %v", rt, err)
			continue
		}
		for i := range resources {
			out = append(out, provenance.Resource{
				SourceResourceType: resources[i].SourceResourceType,
				SourceResourceID:   resources[i].SourceResourceID,
				SourceID:           resources[i].SourceID.String(),
				Raw:                json.RawMessage(resources[i].ResourceRaw),
			})
		}
	}
	return out
}

// sourceLabelFunc returns a SourceID -> human source name lookup for the provenance floor.
func sourceLabelFunc(c *gin.Context, logger *logrus.Entry, repo database.DatabaseRepository) func(string) string {
	labels := map[string]string{}
	if sources, err := repo.GetSources(c); err == nil {
		for _, s := range sources {
			if s.Display != "" {
				labels[s.ID.String()] = s.Display
			}
		}
	} else {
		logger.Warnf("provenance: could not load sources for floor labels: %v", err)
	}
	return func(sourceID string) string { return labels[sourceID] }
}
