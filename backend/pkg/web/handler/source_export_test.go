package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_database "github.com/fastenhealth/fasten-onprem/backend/pkg/database/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/web/handler"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"gorm.io/datatypes"
)

// The export endpoint streams the source's stored resources as a downloadable FHIR Bundle.
func TestExportSourceFHIRBundle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	sourceID := uuid.New()
	source := &models.SourceCredential{ModelBase: models.ModelBase{ID: sourceID}, Display: "Blue Button 2.0 (Sandbox)"}
	mockDB.EXPECT().GetSource(gomock.Any(), sourceID.String()).Return(source, nil)

	resources := []models.ResourceBase{
		{ResourceRaw: datatypes.JSON(`{"resourceType":"Patient","id":"p1"}`)},
		{ResourceRaw: datatypes.JSON(`{"resourceType":"Observation","id":"o1"}`)},
		{ResourceRaw: datatypes.JSON(``)}, // empty raw is skipped
	}
	mockDB.EXPECT().ListResources(gomock.Any(), gomock.Any()).Return(resources, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", "export"))
	c.Set(pkg.ContextKeyTypeDatabase, mockDB)
	c.Params = gin.Params{{Key: "sourceId", Value: sourceID.String()}}
	c.Request, _ = http.NewRequest(http.MethodGet, "/source/"+sourceID.String()+"/export", nil)

	handler.ExportSourceFHIRBundle(c)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/fhir+json")
	assert.Contains(t, w.Header().Get("Content-Disposition"), "attachment; filename=yourphr-blue-button-2.0-sandbox-")

	var bundle struct {
		ResourceType string `json:"resourceType"`
		Type         string `json:"type"`
		Total        int    `json:"total"`
		Entry        []struct {
			Resource json.RawMessage `json:"resource"`
		} `json:"entry"`
	}
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &bundle))
	assert.Equal(t, "Bundle", bundle.ResourceType)
	assert.Equal(t, "collection", bundle.Type)
	assert.Equal(t, 2, bundle.Total, "empty resource_raw must be skipped")
	assert.Len(t, bundle.Entry, 2)
	assert.Contains(t, string(bundle.Entry[0].Resource), "Patient")
}
