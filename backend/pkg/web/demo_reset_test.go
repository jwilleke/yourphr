package web

import (
	"os"
	"path/filepath"
	"testing"

	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// resetEngineOptions is everything demoResetArmed reads. Spelled out per test rather than defaulted,
// because every one of these values is a rail and a test that silently inherits one proves less.
type resetEngineOptions struct {
	resetOnRestart bool
	demoEnabled    bool
	encryption     bool
	demoUsername   string
	demoAdminUser  string
	bootstrapAdmin string
	seedPath       string
	dbPath         string
	cachePath      string
	dataDir        string
}

func resetEngine(t *testing.T, opts resetEngineOptions) *AppEngine {
	t.Helper()
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)

	cfg := mock_config.NewMockInterface(ctrl)
	cfg.EXPECT().GetBool("bootstrap.seed.restore").Return(true).AnyTimes()
	cfg.EXPECT().GetBool("bootstrap.admin.enabled").Return(true).AnyTimes()
	cfg.EXPECT().GetBool("demo.reset_on_restart").Return(opts.resetOnRestart).AnyTimes()
	cfg.EXPECT().GetBool("demo.enabled").Return(opts.demoEnabled).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(opts.encryption).AnyTimes()
	cfg.EXPECT().GetBool("search.enabled").Return(false).AnyTimes()
	cfg.EXPECT().GetString("demo.username").Return(opts.demoUsername).AnyTimes()
	cfg.EXPECT().GetString("demo.admin.username").Return(opts.demoAdminUser).AnyTimes()
	cfg.EXPECT().GetString("bootstrap.admin.username").Return(opts.bootstrapAdmin).AnyTimes()
	cfg.EXPECT().GetString("bootstrap.seed.path").Return(opts.seedPath).AnyTimes()
	cfg.EXPECT().GetString("database.location").Return(opts.dbPath).AnyTimes()
	cfg.EXPECT().GetString("cache.location").Return(opts.cachePath).AnyTimes()
	cfg.EXPECT().GetString("storage.data_dir").Return(opts.dataDir).AnyTimes()

	return &AppEngine{Config: cfg, Logger: logrus.WithField("test", t.Name())}
}

// writeUserDatabase builds a real SQLite file holding a users table, because the subset rail is only
// meaningful if it reads a database the way the running instance would.
func writeUserDatabase(t *testing.T, path string, usernames ...string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormlogger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.Exec("CREATE TABLE users (id TEXT, username TEXT)").Error)
	for i, username := range usernames {
		require.NoError(t, db.Exec("INSERT INTO users (id, username) VALUES (?, ?)", i, username).Error)
	}
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())
}

func demoOptions(t *testing.T) resetEngineOptions {
	t.Helper()
	dir := t.TempDir()
	seed := filepath.Join(dir, "fasten.seed.db")
	require.NoError(t, os.WriteFile(seed, []byte("seed-bytes"), 0o644))
	return resetEngineOptions{
		resetOnRestart: true,
		demoEnabled:    true,
		demoUsername:   "demo",
		demoAdminUser:  "demoadmin",
		bootstrapAdmin: "admindemo",
		seedPath:       seed,
		dbPath:         filepath.Join(dir, "fasten.db"),
		cachePath:      filepath.Join(dir, "fasten.cache.db"),
		dataDir:        dir,
	}
}

func TestDemoResetOnRestart(t *testing.T) {
	t.Run("replaces a demo database and drops derived state", func(t *testing.T) {
		opts := demoOptions(t)
		writeUserDatabase(t, opts.dbPath, "demo", "admindemo")
		require.NoError(t, os.WriteFile(opts.cachePath, []byte("cache"), 0o600))
		jwtKey := filepath.Join(opts.dataDir, ".jwt_issuer_key")
		require.NoError(t, os.WriteFile(jwtKey, []byte("old-signing-key"), 0o600))

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.Equal(t, "seed-bytes", string(got))

		// The cache is keyed to source IDs that no longer exist, and a surviving signing key leaves
		// pre-reset tokens verifying against users that are gone.
		_, err = os.Stat(opts.cachePath)
		require.True(t, os.IsNotExist(err), "the cache must not survive a reset")
		_, err = os.Stat(jwtKey)
		require.True(t, os.IsNotExist(err), "the signing key must not survive a reset")
	})

	// THE rail. Three flags set on the wrong deployment still must not delete anybody's records.
	t.Run("refuses when the database holds an account that is not the demo", func(t *testing.T) {
		opts := demoOptions(t)
		writeUserDatabase(t, opts.dbPath, "demo", "jim")

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing(), "a refusal must not stop the instance starting")

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.NotEqual(t, "seed-bytes", string(got), "a database with real accounts must survive untouched")
	})

	t.Run("refuses when demo mode is off", func(t *testing.T) {
		opts := demoOptions(t)
		opts.demoEnabled = false
		writeUserDatabase(t, opts.dbPath, "demo")

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.NotEqual(t, "seed-bytes", string(got))
	})

	// The subset check cannot open an encrypted database, so there is no evidence to refuse on.
	t.Run("refuses when the database is encrypted", func(t *testing.T) {
		opts := demoOptions(t)
		opts.encryption = true
		writeUserDatabase(t, opts.dbPath, "demo")

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.NotEqual(t, "seed-bytes", string(got))
	})

	// An unreadable or non-database file is not proof of anything, so it is not a licence to delete.
	t.Run("refuses when the existing database cannot be read", func(t *testing.T) {
		opts := demoOptions(t)
		require.NoError(t, os.WriteFile(opts.dbPath, []byte("not a database"), 0o600))

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.Equal(t, "not a database", string(got))
	})

	// Without the flag this is the pre-#518 behaviour, which every non-demo instance depends on.
	t.Run("leaves the database alone when the flag is off", func(t *testing.T) {
		opts := demoOptions(t)
		opts.resetOnRestart = false
		writeUserDatabase(t, opts.dbPath, "demo")

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		got, err := os.ReadFile(opts.dbPath)
		require.NoError(t, err)
		require.NotEqual(t, "seed-bytes", string(got))
	})

	// A directory is what cache.location ships as, and recursively deleting a configured directory
	// is how a reset takes something with it that nobody meant to lose.
	t.Run("does not delete a cache directory", func(t *testing.T) {
		opts := demoOptions(t)
		opts.cachePath = filepath.Join(opts.dataDir, "cache")
		require.NoError(t, os.MkdirAll(opts.cachePath, 0o700))
		writeUserDatabase(t, opts.dbPath, "demo")

		ae := resetEngine(t, opts)
		require.NoError(t, ae.RestoreSeedDatabaseIfMissing())

		info, err := os.Stat(opts.cachePath)
		require.NoError(t, err)
		require.True(t, info.IsDir())
	})
}
