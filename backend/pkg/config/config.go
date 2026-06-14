package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"github.com/analogj/go-util/utils"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/errors"
	"github.com/spf13/viper"
	"github.com/subosito/gotenv"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// dotEnvFiles are loaded into the process environment at startup, in precedence order: a value in an
// earlier file wins over a later one, and a value already in the real OS environment wins over both.
// So: .env (base/committed example) < .env_custom (per-deployment, gitignored) < OS env. Missing files
// are ignored. Values use the YOURPHR_ prefix (see Init).
var dotEnvFiles = []string{".env_custom", ".env"}

// loadDotEnvFiles merges the layered dotenv files into the environment without overriding values that
// are already set (gotenv.Load is non-override), giving the precedence documented on dotEnvFiles.
func loadDotEnvFiles() {
	for _, f := range dotEnvFiles {
		if _, err := os.Stat(f); err == nil {
			if err := gotenv.Load(f); err != nil {
				log.Printf("warning: could not load env file %s: %s", f, err)
			}
		}
	}
}

// DefaultJWTIssuerKey is the placeholder HS256 signing key shipped in the
// committed config.yaml. It is a KNOWN PUBLIC value (present in this repo and
// upstream Fasten), so a deployment running with it can have tokens forged for
// any user/role. The server refuses to start while this is the effective key —
// see ValidateJWTIssuerKey. Real deployments must override it via
// jwt.issuer.key (config.dev.yaml) or the YOURPHR_JWT_ISSUER_KEY env var.
const DefaultJWTIssuerKey = "thisismysupersecuressessionsecretlength"

// jwtKeyFileName is the basename of the auto-generated JWT signing key, persisted
// in the runtime data directory (alongside the SQLite DB) with 0600 permissions.
const jwtKeyFileName = ".jwt_issuer_key"

// ResolveJWTIssuerKey returns the effective JWT signing key, secure-by-default with
// zero configuration (issue #102). JWTs are signed/verified with HS256 (a symmetric
// key), so this is the root of trust for all auth and per-user data isolation —
// the committed public default must never be used to sign tokens. Resolution order:
//
//  1. an explicit, non-default configuredKey (jwt.issuer.key / YOURPHR_JWT_ISSUER_KEY)
//     is honored as-is, so operators/secret-managers keep full control — optionally;
//  2. otherwise a key previously persisted at <dataDir>/.jwt_issuer_key is reused
//     (stable across restarts, so sessions survive reboots);
//  3. otherwise a new 256-bit random key is generated, persisted there (0600), and
//     returned — so a fresh `docker run` is secure with no operator action.
//
// The committed public default (DefaultJWTIssuerKey) and "" are both treated as
// "unset", triggering reuse-or-generate rather than ever signing with the default.
func ResolveJWTIssuerKey(configuredKey string, dataDir string) (string, error) {
	if configuredKey != "" && configuredKey != DefaultJWTIssuerKey {
		return configuredKey, nil
	}
	if dataDir == "" {
		return "", fmt.Errorf("cannot resolve JWT signing key: data directory is empty (set jwt.issuer.key / YOURPHR_JWT_ISSUER_KEY, or database.location)")
	}

	keyPath := filepath.Join(dataDir, jwtKeyFileName)
	if existing, err := os.ReadFile(keyPath); err == nil {
		if key := strings.TrimSpace(string(existing)); key != "" {
			return key, nil
		}
	}

	// Generate a new 256-bit key, hex-encoded (equivalent to `openssl rand -hex 32`).
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate JWT signing key: %w", err)
	}
	key := hex.EncodeToString(buf)

	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create data dir %q for the JWT signing key: %w", dataDir, err)
	}
	if err := os.WriteFile(keyPath, []byte(key), 0600); err != nil {
		return "", fmt.Errorf("failed to persist the generated JWT signing key to %q: %w", keyPath, err)
	}
	return key, nil
}

// When initializing this class the following methods must be called:
// Config.New
// Config.Init
// This is done automatically when created via the Factory.
type configuration struct {
	*viper.Viper
}

func (c *configuration) Init() error {
	c.Viper = viper.New()

	// Layer dotenv files into the environment before viper reads env via AutomaticEnv below.
	loadDotEnvFiles()

	//set defaults
	c.SetDefault("web.listen.port", "8080")
	c.SetDefault("web.listen.host", "0.0.0.0")
	c.SetDefault("web.listen.basepath", "")
	c.SetDefault("web.listen.https.enabled", false)
	c.SetDefault("web.listen.https.certDir", "certs")
	c.SetDefault("web.listen.https.sharedDir", "certs/shared")

	// allow unsafe endpoints should never be enabled in Production.
	// It enables direct API access to healthcare providers without authentication.
	c.SetDefault("web.allow_unsafe_endpoints", false)

	// How long the SMART-on-FHIR connect flow waits for the user to finish logging in at the
	// provider (the relay-poll phase) before giving up. A first provider login (read consent, pick
	// account, authorize) can be slow — e.g. CMS Blue Button. Served to the frontend so it can be
	// tuned via env/config without a frontend rebuild (YOURPHR_WEB_SMART_CONNECT_LOGIN_WAIT_SECONDS).
	c.SetDefault("web.smart_connect.login_wait_seconds", 240)

	c.SetDefault("web.src.frontend.path", "/opt/fasten/web")
	c.SetDefault("database.type", "sqlite")
	c.SetDefault("database.location", "/opt/fasten/db/fasten.db")
	c.SetDefault("database.encryption.enabled", false)
	//c.SetDefault("database.encryption.key", "") //encryption key must be set by the user.
	c.SetDefault("cache.location", "/opt/fasten/cache/")

	c.SetDefault("jwt.issuer.key", DefaultJWTIssuerKey)

	c.SetDefault("log.level", "INFO")
	c.SetDefault("log.file", "")

	// C-CDA / CCD import is opt-in: it requires the external fhir-converter sidecar (#254).
	// Disabled by default so a stock single-binary install is unaffected.
	c.SetDefault("cda_converter.enabled", false)
	c.SetDefault("cda_converter.url", "")
	c.SetDefault("cda_converter.timeout_seconds", 60)

	//set the default system config file search path.
	//if you want to load a non-standard location system config file (~/capsule.yml), use ReadConfig
	//if you want to load a repo specific config file, use ReadConfig
	c.SetConfigType("yaml")
	c.SetConfigName("template")
	c.AddConfigPath("$HOME/")

	//configure env variable parsing: YOURPHR_<KEY> with '.'/'-' -> '_' (e.g. cda_converter.enabled
	//-> YOURPHR_CDA_CONVERTER_ENABLED).
	c.SetEnvPrefix("YOURPHR")
	c.SetEnvKeyReplacer(strings.NewReplacer("-", "_", ".", "_"))
	c.AutomaticEnv()
	//CLI options will be added via the `Set()` function

	return nil
}

func (c *configuration) ReadConfig(configFilePath string) error {

	if !utils.FileExists(configFilePath) {
		message := fmt.Sprintf("The configuration file (%s) could not be found. Skipping", configFilePath)
		log.Print(message)
		return errors.ConfigFileMissingError("The configuration file could not be found.")
	}

	log.Printf("Loading configuration file: %s", configFilePath)

	config_data, err := os.Open(configFilePath)
	if err != nil {
		log.Printf("Error reading configuration file: %s", err)
		return err
	}
	err = c.MergeConfig(config_data)
	if err != nil {
		log.Printf("Error merging config file: %s", err)
		return err
	}
	return c.ValidateConfig()
}

// This function ensures that required configuration keys (that must be manually set) are present
func (c *configuration) ValidateConfig() error {
	if c.IsSet("database.encryption.key") {
		key := c.GetString("database.encryption.key")
		if key == "" {
			return errors.ConfigValidationError("database.encryption.key cannot be empty")
		}
		if len(key) < 10 {
			return errors.ConfigValidationError("database.encryption.key must be at least 10 characters")
		}
	}
	return nil
}
