// Stub for github.com/fastenhealth/fasten-sources/clients/models
package models

import (
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/fastenhealth/fasten-sources/pkg"
	"github.com/sirupsen/logrus"
)

// UpsertSummary summarises an import operation.
type UpsertSummary struct {
	TotalResources   int
	UpdatedResources []string
}

// RawResourceFhir is the struct passed to UpsertRawResource.
// Fields are flat (not embedded) to match composite literal usage in handlers.
type RawResourceFhir struct {
	SourceResourceID    string
	SourceResourceType  string
	ResourceRaw         json.RawMessage
	SourceUri           string
	ReferencedResources []string
	SortTitle           *string
	SortDate            *time.Time
}

// SourceCredential is the interface implemented by models.SourceCredential.
type SourceCredential interface {
	GetSourceId() string
	GetEndpointId() string
	GetPortalId() string
	GetBrandId() string
	GetPlatformType() pkg.PlatformType
	GetClientId() string
	GetPatientId() string
	GetRefreshToken() string
	GetAccessToken() string
	GetExpiresAt() int64
	SetTokens(accessToken string, refreshToken string, expiresAt int64)
	IsDynamicClient() bool

	// SMART config (self-describing credential — issue #49): the FHIR base URL the client
	// talks to, and the requested scopes. Authorize/token endpoints are discovered from
	// {ApiEndpointBaseUrl}/.well-known/smart-configuration.
	GetApiEndpointBaseUrl() string
	GetScopes() []string
}

// DatabaseRepository is the subset of the DB interface needed by source clients.
type DatabaseRepository interface {
	UpsertRawResource(ctx context.Context, sourceCredential SourceCredential, rawResource RawResourceFhir) (bool, error)
}

// ResourceInterface is implemented by FHIR resource types that carry a type+id reference.
type ResourceInterface interface {
	ResourceRef() (string, *string)
}

// SourceClient is the interface for provider sync clients (all methods are stubs).
type SourceClient interface {
	SyncAll(db DatabaseRepository) (UpsertSummary, error)
	SyncAllBundle(db DatabaseRepository, bundleFile io.Reader, fhirVersion pkg.FhirVersionType) (UpsertSummary, error)
	SyncAllByResourceName(db DatabaseRepository, resourceNames []string) (UpsertSummary, error)
	ExtractPatientId(bundleFile io.Reader) (string, pkg.FhirVersionType, error)
	GetRequest(resourceSubpath string, decodeTarget interface{}) (interface{}, error)
	GetLogger() *logrus.Entry
	GetSourceCredential() SourceCredential
}
