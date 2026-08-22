package database

import (
	"context"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/utils/ips"
	sourcePkg "github.com/fastenhealth/fasten-onprem/backend/pkg/sources/clients/models"
	"github.com/google/uuid"
)

//go:generate mockgen -source=interface.go -destination=mock/mock_database.go
type DatabaseRepository interface {
	Close() error
	Migrate() error

	CreateUser(context.Context, *models.User) error
	// CreateProvisionedUser creates an account the instance provisions from its own configuration
	// (bootstrap admin, demo admin). Same as CreateUser except it accepts a reserved username,
	// because that name comes from an operator's configuration rather than from a caller (#519).
	CreateProvisionedUser(context.Context, *models.User) error
	GetUserCount(context.Context) (int, error)
	GetUserByUsername(context.Context, string) (*models.User, error)
	// GetUserByID returns the row unsanitized (the password hash intact), for paths that update it.
	GetUserByID(ctx context.Context, userID string) (*models.User, error)
	GetCurrentUser(ctx context.Context) (*models.User, error)
	DeleteCurrentUser(ctx context.Context) error
	UpdateUserPassword(ctx context.Context, hashedPassword string) error
	// BumpUserTokenGeneration ends every session already issued to this user (#508). Session JWTs
	// are stateless, so without it a stolen session survives a password change.
	BumpUserTokenGeneration(ctx context.Context, username string) error
	// RecordSuccessfulLogin stamps last_login and increments login_count (#512). Successes only —
	// a failure counter on the user row is the first half of account lockout, which #507 rejected.
	RecordSuccessfulLogin(ctx context.Context, username string) error
	// RecordAccessEvent increments the patient-visible access log for the current user (#563):
	// (actor, category, UTC day) buckets with a count and first/last timestamps. No IP, no
	// user-agent — identity and time answer "who has accessed my record?".
	RecordAccessEvent(ctx context.Context, category string) error
	// ListAccessEvents returns the current user's complete access log, newest day first (#563).
	ListAccessEvents(ctx context.Context) ([]models.AccessEvent, error)
	GetUsers(ctx context.Context) ([]models.User, error)

	//get a count of every resource type
	GetSummary(ctx context.Context) (*models.Summary, error)
	GetInternationalPatientSummaryExport(ctx context.Context) (*ips.InternationalPatientSummaryExportData, error)

	GetResourceByResourceTypeAndId(context.Context, string, string) (*models.ResourceBase, error)
	GetResourceBySourceId(context.Context, string, string) (*models.ResourceBase, error)
	QueryResources(ctx context.Context, query models.QueryResource) (interface{}, error)
	ListResources(context.Context, models.ListResourceQueryOptions) ([]models.ResourceBase, error)
	ListAllResources(ctx context.Context, queryOptions models.ListResourceQueryOptions) ([]models.ResourceBase, error)
	GetPatientForSources(ctx context.Context) ([]models.ResourceBase, error)
	AddResourceAssociation(ctx context.Context, source *models.SourceCredential, resourceType string, resourceId string, relatedSource *models.SourceCredential, relatedResourceType string, relatedResourceId string) error
	RemoveResourceAssociation(ctx context.Context, source *models.SourceCredential, resourceType string, resourceId string, relatedSource *models.SourceCredential, relatedResourceType string, relatedResourceId string) error
	RemoveBulkResourceAssociations(ctx context.Context, associationsToDelete []models.RelatedResource) (int64, error)
	FindResourceAssociationsByTypeAndId(ctx context.Context, source *models.SourceCredential, resourceType string, resourceId string) ([]models.RelatedResource, error)
	FindAllResourceAssociations(ctx context.Context, source *models.SourceCredential, resourceType string, resourceId string) ([]models.RelatedResource, error)
	GetFlattenedResourceGraph(ctx context.Context, graphType pkg.ResourceGraphType, options models.ResourceGraphOptions) (map[string][]*models.ResourceBase, error)
	DeleteResourceByTypeAndId(ctx context.Context, sourceResourceType string, sourceResourceId string) error
	FindPractitionerEncounters(ctx context.Context, practitionerId string) ([]models.ResourceBase, error)

	// Deprecated:This method has been deprecated. It has been replaced in favor of Fasten SourceCredential & associations
	AddResourceComposition(ctx context.Context, compositionTitle string, resources []*models.ResourceBase) error
	//UpsertProfile(context.Context, *models.Profile) error
	//UpsertOrganziation(context.Context, *models.Organization) error

	CreateSource(context.Context, *models.SourceCredential) error
	GetSource(context.Context, string) (*models.SourceCredential, error)
	GetSourceSummary(context.Context, string) (*models.SourceSummary, error)
	GetSources(context.Context) ([]models.SourceCredential, error)
	UpdateSource(ctx context.Context, sourceCreds *models.SourceCredential) error
	// DisconnectSource clears OAuth/tokens for the source but keeps the credential row and all
	// FHIR resources so Explore still works; user can Reconnect later (#437).
	DisconnectSource(ctx context.Context, sourceId string) error
	// RemoveSourceData deletes FHIR resources (+ related links) for the source; keeps credentials (#437).
	RemoveSourceData(ctx context.Context, sourceId string) (int64, error)
	// DeleteSource is disconnect + remove data + soft-delete credential (full teardown).
	DeleteSource(ctx context.Context, sourceId string) (int64, error)

	// Admin-configured provider catalog (#304). Instance-wide (not per-user).
	CreateProviderCatalogEntry(ctx context.Context, entry *models.ProviderCatalogEntry) error
	GetProviderCatalogEntry(ctx context.Context, id string) (*models.ProviderCatalogEntry, error)
	ListProviderCatalogEntries(ctx context.Context, enabledOnly bool) ([]models.ProviderCatalogEntry, error)
	UpdateProviderCatalogEntry(ctx context.Context, entry *models.ProviderCatalogEntry) error
	DeleteProviderCatalogEntry(ctx context.Context, id string) (int64, error)
	// UpsertProviderCatalogEntryByDisplay creates the entry or updates the existing one with the same
	// Display (used by the env-based sandbox seeding). #291
	UpsertProviderCatalogEntryByDisplay(ctx context.Context, entry *models.ProviderCatalogEntry) error

	CreateGlossaryEntry(ctx context.Context, glossaryEntry *models.Glossary) error
	GetGlossaryEntry(ctx context.Context, code string, codeSystem string) (*models.Glossary, error)

	//background jobs
	CreateBackgroundJob(ctx context.Context, backgroundJob *models.BackgroundJob) error
	GetBackgroundJob(ctx context.Context, backgroundJobId string) (*models.BackgroundJob, error)
	UpdateBackgroundJob(ctx context.Context, backgroundJob *models.BackgroundJob) error
	ListBackgroundJobs(ctx context.Context, queryOptions models.BackgroundJobQueryOptions) ([]models.BackgroundJob, error)

	//favorites (Address book)
	AddFavorite(ctx context.Context, userId string, sourceId string, resourceType string, resourceId string) error
	RemoveFavorite(ctx context.Context, userId string, sourceId string, resourceType string, resourceId string) error
	CheckFavoriteExists(ctx context.Context, userId string, sourceId string, resourceType string, resourceId string) (bool, error)
	GetUserFavorites(ctx context.Context, userId string, resourceType string) ([]models.Favorite, error)

	//settings
	LoadSystemSettings(ctx context.Context) (*models.SystemSettings, error)
	SaveSystemSettings(ctx context.Context, newSettings *models.SystemSettings) error
	LoadUserSettings(ctx context.Context) (*models.UserSettings, error)
	SaveUserSettings(context.Context, *models.UserSettings) error
	PopulateDefaultUserSettings(ctx context.Context, userId uuid.UUID) error
	// Legal consent (PP/ToS) — per-user; empty acceptedAt = not accepted (#427)
	GetLegalConsentAcceptedAt(ctx context.Context) (string, error)
	SetLegalConsentAcceptedAt(ctx context.Context, acceptedAt string) error

	//used by fasten-sources Clients
	BackgroundJobCheckpoint(ctx context.Context, checkpointData map[string]interface{}, errorData map[string]interface{})
	UpsertRawResource(ctx context.Context, sourceCredentials sourcePkg.SourceCredential, rawResource sourcePkg.RawResourceFhir) (bool, error)
	UpsertRawResourceAssociation(
		ctx context.Context,
		sourceId string,
		sourceResourceType string,
		sourceResourceId string,
		targetSourceId string,
		targetResourceType string,
		targetResourceId string,
	) error

	UnlinkResourceWithSharedNeighbors(ctx context.Context, resourceType string, resourceId string, relatedResourceType string, relatedResourceId string) (int64, error)

	// Access Token Management
	CreateAccessToken(ctx context.Context, accessToken *models.AccessToken) error
	GetUserAccessTokens(ctx context.Context) ([]models.AccessToken, error)
	DeleteAccessToken(ctx context.Context, tokenID string) error
	GetAccessToken(ctx context.Context, tokenID string) (*models.AccessToken, error)
	GetAccessTokenByTokenIDAndUsername(ctx context.Context, tokenID string, username string) (*models.AccessToken, error)
}
