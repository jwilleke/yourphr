package database

import (
	"context"
	"fmt"
	"log"

	_20231017112246 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20231017112246"
	_20231201122541 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20231201122541"
	_0240114092806 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20240114092806"
	_20240114103850 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20240114103850"
	_20240208112210 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20240208112210"
	_20240813222836 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20240813222836"
	_20250730100000 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20250730100000"
	_20260812120000 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20260812120000"
	_20260812160000 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20260812160000"
	_20260819100000 "github.com/fastenhealth/fasten-onprem/backend/pkg/database/migrations/20260819100000"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	databaseModel "github.com/fastenhealth/fasten-onprem/backend/pkg/models/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/search"
	sourceCatalog "github.com/fastenhealth/fasten-onprem/backend/pkg/sources/catalog"
	sourcePkg "github.com/fastenhealth/fasten-onprem/backend/pkg/sources/pkg"
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (gr *GormRepository) Migrate() error {

	gr.Logger.Infoln("Database migration starting. Please wait, this process may take a long time....")

	gormMigrateOptions := gormigrate.DefaultOptions
	gormMigrateOptions.UseTransaction = true

	//use "echo $(date '+%Y%m%d%H%M%S')" to generate new ID's
	m := gormigrate.New(gr.GormClient, gormMigrateOptions, []*gormigrate.Migration{
		{
			ID: "20231017112246",
			Migrate: func(tx *gorm.DB) error {

				return tx.AutoMigrate(
					&_20231017112246.BackgroundJob{},
					&_20231017112246.Glossary{},
					&_20231017112246.SourceCredential{},
					&_20231017112246.UserSettingEntry{},
					&_20231017112246.User{},
				)
			},
		},
		{
			ID: "20231017113858", // FHIR Resource Database models.
			Migrate: func(tx *gorm.DB) error {

				//automigrate Fhir Resource Tables
				return databaseModel.Migrate(tx)
			},
		},
		{
			ID: "20231201122541", // Adding Fasten Source Credential for each user
			Migrate: func(tx *gorm.DB) error {

				users := []_20231201122541.User{}
				results := tx.Find(&users)
				if results.Error != nil {
					return results.Error
				}
				for _, user := range users {
					tx.Logger.Info(context.Background(), fmt.Sprintf("Creating Fasten Source Credential for user: %s", user.ID))

					fastenUserCred := _20231201122541.SourceCredential{
						UserID:     user.ID,
						SourceType: string(sourcePkg.PlatformTypeFasten),
					}
					fastenUserCredCreateResp := tx.Create(&fastenUserCred)
					if fastenUserCredCreateResp.Error != nil {
						tx.Logger.Error(context.Background(), fmt.Sprintf("An error occurred creating Fasten Source Credential for user: %s", user.ID))
						return fastenUserCredCreateResp.Error
					}
				}
				return nil
			},
		},
		{
			ID: "20240114092806", // Adding additional fields to Source Credential
			Migrate: func(tx *gorm.DB) error {

				err := tx.AutoMigrate(
					&_0240114092806.SourceCredential{},
				)
				if err != nil {
					return err
				}

				//attempt to populate the endpoint id, portal id and brand id for each existing source credential
				sourceCredentials := []_0240114092806.SourceCredential{}
				results := tx.Find(&sourceCredentials)
				if results.Error != nil {
					return results.Error
				}

				for ndx, _ := range sourceCredentials {
					sourceCredential := &sourceCredentials[ndx]

					if sourceCredential.SourceType == string(sourcePkg.PlatformTypeFasten) || sourceCredential.SourceType == string(sourcePkg.PlatformTypeManual) {
						tx.Logger.Info(context.Background(), fmt.Sprintf("Updating Legacy SourceType (%s) to PlatformType: %s", sourceCredential.SourceType, sourceCredential.ID))

						sourceCredential.PlatformType = string(sourceCredential.SourceType)

						fastenUpdateSourceCredential := tx.Save(sourceCredential)
						if fastenUpdateSourceCredential.Error != nil {
							tx.Logger.Error(context.Background(), fmt.Sprintf("An error occurred update Fasten Source Credential: %s", sourceCredential.ID))
							return fastenUpdateSourceCredential.Error
						}

						continue
					}

					tx.Logger.Info(context.Background(), fmt.Sprintf("Mapping Legacy SourceType (%s) to Brand, Portal and Endpoint IDs: %s", sourceCredential.SourceType, sourceCredential.ID))

					matchingBrand, matchingPortal, matchingEndpoint, endpointEnv, err := sourceCatalog.GetPatientAccessInfoForLegacySourceType(sourceCredential.SourceType, sourceCredential.ApiEndpointBaseUrl)
					if err != nil {
						log.Printf("An error occurred getting Patient Access Info for Legacy SourceType: %s", sourceCredential.SourceType)
						tx.Logger.Error(context.Background(), err.Error())
						return err
					}
					portalId := uuid.MustParse(matchingPortal.Id)
					sourceCredential.PortalID = &portalId
					brandId := uuid.MustParse(matchingBrand.Id)
					sourceCredential.Display = matchingPortal.Name
					sourceCredential.BrandID = &brandId
					sourceCredential.EndpointID = uuid.MustParse(matchingEndpoint.Id)
					sourceCredential.PlatformType = string(matchingEndpoint.GetPlatformType())
					sourceCredential.LighthouseEnvType = endpointEnv

					fastenUpdateSourceCredential := tx.Save(sourceCredential)
					if fastenUpdateSourceCredential.Error != nil {
						tx.Logger.Error(context.Background(), fmt.Sprintf("An error occurred update Fasten Source Credential: %s", sourceCredential.ID))
						return fastenUpdateSourceCredential.Error
					}
				}
				return nil
			},
		},
		{
			ID: "20240114103850", // cleanup unnecessary fields, now that we're using Brands, Portals and Endpoints.
			Migrate: func(tx *gorm.DB) error {

				return tx.AutoMigrate(
					&_20240114103850.SourceCredential{},
				)
			},
		},
		{
			ID: "20240208112210", // add system settings
			Migrate: func(tx *gorm.DB) error {

				err := tx.AutoMigrate(
					&_20240208112210.SystemSettingEntry{},
				)
				if err != nil {
					return err
				}

				//add the default system settings
				defaultSystemSettings := []_20240208112210.SystemSettingEntry{
					{
						SettingKeyName:        "installation_id",
						SettingKeyDescription: "installation id is used to identify this installation when making external calls to Fasten Health, Inc. infrastructure. It does not contain any personally identifiable information",
						SettingDataType:       "string",
						SettingValueString:    "",
					},
					{
						SettingKeyName:        "installation_secret",
						SettingKeyDescription: "installation secret is used to sign requests/updates to Fasten Health, Inc. infrastructure",
						SettingDataType:       "string",
						SettingValueString:    "",
					},
				}

				for _, setting := range defaultSystemSettings {
					tx.Logger.Info(context.Background(), fmt.Sprintf("Creating System Setting: %s", setting.SettingKeyName))

					settingCreateResp := tx.Create(&setting)
					if settingCreateResp.Error != nil {
						tx.Logger.Error(context.Background(), fmt.Sprintf("An error occurred creating System Setting: %s", setting.SettingKeyName))
						return settingCreateResp.Error
					}
				}
				return nil
			},
		},
		{
			ID: "20240212142126", // remove unnecessary admin user if present.
			Migrate: func(tx *gorm.DB) error {

				deleteResp := tx.Delete(&models.User{}, "username = ?", "admin")
				if deleteResp.Error != nil {
					tx.Logger.Error(context.Background(), fmt.Sprintf("An error occurred while removing placeholder admin user: %v", deleteResp.Error))
					return deleteResp.Error
				}
				return nil
			},
		},
		{
			ID: "20240813222836", // add role to user
			Migrate: func(tx *gorm.DB) error {

				err := tx.AutoMigrate(
					&_20240813222836.User{},
				)
				if err != nil {
					return err
				}

				// set first user to admin
				// set all other users to user
				users := []_20240813222836.User{}
				results := tx.Order("created_at ASC").Find(&users)
				if results.Error != nil {
					return results.Error
				}
				for ndx, user := range users {
					if ndx == 0 {
						user.Role = _20240813222836.RoleAdmin
					} else {
						user.Role = _20240813222836.RoleUser
					}
					tx.Save(&user)
				}
				return nil
			},
		},
		{
			ID: "20250730100000",
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&_20250730100000.Favorite{})
			},
		},
		{
			// Session JWTs are stateless, so a stolen one survived a password change until it expired
			// (#508). This counter is what lets a password change, an admin reset, or "sign out
			// everywhere" actually end sessions. Existing rows default to 0 and pre-#508 tokens carry
			// no claim, which also reads as 0 — so applying this migration logs nobody out.
			ID: "20260812120000", // add users.token_generation for session revocation (#508)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&_20260812120000.User{})
			},
		},
		{
			// Records USE, so an admin can tell a live account from an abandoned one and a patient can
			// answer "has anyone else been in my record?" (#512). No IP, no user-agent — see the model
			// comment. Existing rows migrate with NULL/0 and read as "Never".
			ID: "20260812160000", // add users.last_login and users.login_count (#512)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&_20260812160000.User{})
			},
		},
		{
			// The patient-visible access log: who accessed which category of a user's records on
			// which day. Aggregated, no IP/user-agent — see the model comment (#563).
			ID: "20260819100000", // create access_events (#563)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&_20260819100000.AccessEvent{})
			},
		},
		{
			ID: "20250117131051", // add access token models for health wallet
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&models.AccessToken{},
				)
			},
		},
		{
			ID: "20260604000000", // add SMART config fields (api_endpoint_base_url, scopes) to source_credential (#49)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&models.SourceCredential{},
				)
			},
		},
		{
			ID: "20260614000000", // add client_secret (confidential SMART client) to source_credential (#286)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&models.SourceCredential{},
				)
			},
		},
		{
			ID: "20260616000000", // admin-configured provider catalog (#304)
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&models.ProviderCatalogEntry{},
				)
			},
		},
		{
			ID: "20260616000001", // seed default (disabled, credential-free) catalog entries: Blue Button, Epic (#304)
			Migrate: func(tx *gorm.DB) error {
				for _, entry := range models.DefaultProviderCatalogEntries() {
					var count int64
					if err := tx.Model(&models.ProviderCatalogEntry{}).
						Where("display = ?", entry.Display).Count(&count).Error; err != nil {
						return err
					}
					if count > 0 {
						continue // already present (admin-created or re-run) — never duplicate
					}
					e := entry
					if err := tx.Create(&e).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
		{
			ID: "20260618000000", // add environment (production/sandbox) to provider catalog; mark seeded sandboxes (#291)
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(&models.ProviderCatalogEntry{}); err != nil {
					return err
				}
				// Existing seeded entries (created before the column) default to production; they are
				// test sandboxes, so move them to the sandbox environment (never shown to patients).
				for _, s := range models.SandboxProviderSeeds() {
					if err := tx.Model(&models.ProviderCatalogEntry{}).
						Where("display = ?", s.Display).
						Update("environment", models.ProviderEnvironmentSandbox).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
		{
			ID: "20260619000000", // add environment (production/sandbox) to connected sources (#331)
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(&models.SourceCredential{}); err != nil {
					return err
				}
				// Backfill: existing sources default to production, but any source connected through a
				// sandbox catalog entry (matched by endpoint_id) is a sandbox source — tag it so so it
				// shows on /sandbox, not /sources.
				return tx.Exec(
					"UPDATE source_credentials SET environment = ? WHERE endpoint_id IN (SELECT id FROM provider_catalog_entries WHERE environment = ?)",
					models.ProviderEnvironmentSandbox, models.ProviderEnvironmentSandbox,
				).Error
			},
		},
		{
			ID: "20260619000001", // add authorize_url_override; fix Cerner patient authorize endpoint (#338)
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(&models.ProviderCatalogEntry{}); err != nil {
					return err
				}
				// The Cerner patient authorize endpoint is not discoverable, and the entry's base URL may
				// have been hand-edited to the provider host on existing instances. The provision-only
				// upsert won't correct a row that already has a client_id, so re-pin base URL + authorize
				// override here from the canonical seed for any sandbox that defines an override (#338).
				for _, s := range models.SandboxProviderSeeds() {
					if s.AuthorizeUrlOverride == "" {
						continue
					}
					if err := tx.Model(&models.ProviderCatalogEntry{}).
						Where("display = ?", s.Display).
						Updates(map[string]interface{}{
							"api_endpoint_base_url":  s.ApiEndpointBaseUrl,
							"authorize_url_override": s.AuthorizeUrlOverride,
						}).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
		{
			ID: "20260619000002", // re-pin Cerner sandbox scopes to SMART v2 .rs syntax (#338)
			Migrate: func(tx *gorm.DB) error {
				// A SMART v2 app drops v1 `.read` scopes -> no read access -> empty import. The seed now
				// uses `.rs`; the provision-only upsert won't update an already-provisioned row, so push
				// the corrected scopes here for any sandbox that pins an authorize override (Cerner).
				for _, s := range models.SandboxProviderSeeds() {
					if s.AuthorizeUrlOverride == "" {
						continue
					}
					if err := tx.Model(&models.ProviderCatalogEntry{}).
						Where("display = ?", s.Display).
						Update("scopes", s.Scopes).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
		{
			ID: "20260619000003", // Cerner: enumerate .rs scopes; the `*.rs` wildcard is dropped whole (#338)
			Migrate: func(tx *gorm.DB) error {
				// migration ...002 pushed `patient/*.rs`, but Cerner drops the wildcard whole (same as
				// `*.read`) -> still no read scopes. The seed now enumerates the resources; re-push.
				for _, s := range models.SandboxProviderSeeds() {
					if s.AuthorizeUrlOverride == "" {
						continue
					}
					if err := tx.Model(&models.ProviderCatalogEntry{}).
						Where("display = ?", s.Display).
						Update("scopes", s.Scopes).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
		{
			ID: "20260731000000", // modular connect policy: consent_policy + pre_connect_profile (all medical sources)
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(&models.ProviderCatalogEntry{}); err != nil {
					return err
				}
				// Existing rows: empty strings mean "required" / "auto" at resolve time.
				return tx.Model(&models.ProviderCatalogEntry{}).
					Where("consent_policy = '' OR consent_policy IS NULL").
					Update("consent_policy", models.ConsentPolicyRequired).Error
			},
		},
		{
			ID: "20260731000001", // production Medicare catalog template (no secrets) for #432
			Migrate: func(tx *gorm.DB) error {
				tmpl := models.ProductionMedicareCatalogTemplate()
				var count int64
				if err := tx.Model(&models.ProviderCatalogEntry{}).
					Where("display = ?", tmpl.Display).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					return nil // already present (admin or env seed)
				}
				return tx.Create(&tmpl).Error
			},
		},
		{
			// Backfill the two counter columns to 0 (#528). AutoMigrate adds an int column with no
			// DEFAULT, so `ALTER TABLE users ADD login_count integer` left every PRE-EXISTING row NULL
			// while rows created afterwards got an explicit 0 from the insert. `NULL + 1` is NULL in
			// SQL, so both increments below wrote nothing, forever, on exactly the accounts that
			// predate their migration — and reported success while doing it.
			//
			// For token_generation (#508) that meant session revocation was INERT: NULL reads back as
			// 0, an already-issued token carries 0, and `claims < current` is false. Password change,
			// admin reset, CLI reset and "sign out everywhere" all told the user their other sessions
			// were ended and ended none of them.
			//
			// Backfilling to 0 is the state both original migrations intended, so it logs nobody out.
			// The earlier IDs are already recorded on live instances and will never re-run, which is
			// why this needs its own entry rather than a correction to theirs.
			ID: "20260813090000", // backfill NULL users.token_generation / users.login_count (#528)
			Migrate: func(tx *gorm.DB) error {
				if err := tx.Exec("UPDATE users SET token_generation = 0 WHERE token_generation IS NULL").Error; err != nil {
					return err
				}
				return tx.Exec("UPDATE users SET login_count = 0 WHERE login_count IS NULL").Error
			},
		},
	})

	// run when database is empty
	//m.InitSchema(func(tx *gorm.DB) error {
	//	err := tx.AutoMigrate(
	//		&models.BackgroundJob{},
	//		&models.Glossary{},
	//		&models.SourceCredential{},
	//		&models.UserSettingEntry{},
	//		&models.User{},
	//	)
	//	if err != nil {
	//		return err
	//	}
	//	return nil
	//})

	if err := m.Migrate(); err != nil {
		gr.Logger.Errorf("Database migration failed with error. \n Please open a github issue at https://github.com/fastenhealth/fasten-onprem. \n %v", err)
		return err
	}

	//TODO: final migration step. This should not be necessary once we do true migrations for the databaseModels.
	if err := databaseModel.Migrate(gr.GormClient); err != nil {
		gr.Logger.Errorf("Final Database migration failed with error.\n Please open a github issue at https://github.com/fastenhealth/fasten-onprem. \n %v", err)
	}

	if gr.AppConfig.GetBool("search.enabled") {
		indexer := &search.IndexerService{Client: search.Client}

		// Index existing data if needed
		ctx := context.Background()

		systemSettings, err := gr.LoadSystemSettings(ctx)
		if err != nil {
			gr.Logger.Error("failed to load system settings: %w", err)
		}

		if systemSettings.TypesenseDataIndexed {
			gr.Logger.Info("Data already indexed, skipping...")
		} else {
			gr.Logger.Info("Data not indexed. Indexing existing resources...")

			// search.enabled can be true here (persisted config, e.g. via Admin -> Configuration)
			// while search.Init() still failed earlier — most commonly validateConfig rejecting a
			// missing chat.model field — which leaves search.Client nil without making
			// search.enabled false. Indexing into a nil client panics deep in the typesense-go SDK
			// (a raw nil pointer dereference, not a handled error), so this must not proceed past
			// the nil check: skip indexing and leave TypesenseDataIndexed false, so a later restart
			// with a working config retries it instead of silently accepting the crash.
			if indexer.Client == nil {
				gr.Logger.Error("Indexer client is nil — Typesense did not initialize; skipping indexing this run")
			} else {
				listResourceQueryOptions := models.ListResourceQueryOptions{}
				resources, err := gr.ListAllResources(ctx, listResourceQueryOptions)
				if err != nil {
					gr.Logger.Error("failed to retrieve resources: %w", err)
				}

				for i := range resources {
					if err := indexer.IndexResource(&resources[i]); err != nil {
						gr.Logger.Error("Failed to index resource:", resources[i].ID, "-", err, "skipping...")
						continue
					}
				}

				systemSettings.TypesenseDataIndexed = true
				if err := gr.SaveSystemSettings(ctx, systemSettings); err != nil {
					gr.Logger.Error("failed to update system settings: %w", err)
				}

				gr.Logger.Infof("Indexed %d resources", len(resources))
				gr.Logger.Info("Indexing completed and flag updated.")
			}
		}
	}

	gr.Logger.Infoln("Database migration completed successfully")

	return nil
}
