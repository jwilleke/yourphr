package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Mission: "Your medical records, immediately and in your hands — for free." Let a user download every
// record retrieved for a connected source as a standard FHIR R4 Bundle (type=collection) — re-importable
// via the manual-upload path. Synthetic sandbox data can be saved to sample-data/ this way.

type fhirBundleEntry struct {
	Resource json.RawMessage `json:"resource"`
}

type fhirBundle struct {
	ResourceType string            `json:"resourceType"`
	Type         string            `json:"type"`
	Total        int               `json:"total"`
	Entry        []fhirBundleEntry `json:"entry"`
}

var unsafeFilenameChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// ExportSourceFHIRBundle (any authenticated user) streams all of a source's stored resources as a FHIR
// Bundle download. GetSource is user-scoped, so a user can only export their own source.
func ExportSourceFHIRBundle(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	sourceId := c.Param("sourceId")
	source, err := databaseRepo.GetSource(c, sourceId)
	if err != nil {
		logger.Errorln("could not load source for export", err)
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "source not found"})
		return
	}

	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceID: sourceId})
	if err != nil {
		logger.Errorln("could not list resources for export", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	bundle := fhirBundle{ResourceType: "Bundle", Type: "collection"}
	for i := range resources {
		raw := resources[i].GetResourceRaw()
		if len(raw) == 0 {
			continue
		}
		bundle.Entry = append(bundle.Entry, fhirBundleEntry{Resource: json.RawMessage(raw)})
	}
	bundle.Total = len(bundle.Entry)

	body, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		logger.Errorln("could not marshal export bundle", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not build bundle"})
		return
	}

	c.Header("Content-Type", "application/fhir+json")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", exportFilename(source)))
	c.Data(http.StatusOK, "application/fhir+json", body)
}

// exportFilename builds a safe, descriptive download name, e.g. yourphr-blue-button-2-0-20260618.json.
func exportFilename(source *models.SourceCredential) string {
	label := strings.TrimSpace(source.Display)
	if label == "" {
		label = source.ID.String()
	}
	slug := strings.Trim(unsafeFilenameChars.ReplaceAllString(strings.ToLower(label), "-"), "-")
	if slug == "" {
		slug = "source"
	}
	return fmt.Sprintf("yourphr-%s-%s.json", slug, time.Now().Format("20060102"))
}
