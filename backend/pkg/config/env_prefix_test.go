package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// The deprecated FASTEN_* prefix is mirrored to YOURPHR_* so old deployments keep working, but never
// overrides a YOURPHR_* value that is already set.
func TestMirrorDeprecatedEnvPrefix(t *testing.T) {
	t.Setenv("FASTEN_TEST_ONLY_KEY", "from-fasten")
	t.Setenv("FASTEN_TEST_ONLY_OVERRIDDEN", "old")
	t.Setenv("YOURPHR_TEST_ONLY_OVERRIDDEN", "new")

	mirrorDeprecatedEnvPrefix()

	// mirrored when the new key is unset
	require.Equal(t, "from-fasten", os.Getenv("YOURPHR_TEST_ONLY_KEY"))
	// NOT overridden when the new key is already set
	require.Equal(t, "new", os.Getenv("YOURPHR_TEST_ONLY_OVERRIDDEN"))
}

// End-to-end: a YOURPHR_* env overrides config, and a FASTEN_* env still resolves via the shim.
func TestEnvPrefix_YourphrAndDeprecatedFasten(t *testing.T) {
	t.Setenv("FASTEN_LOG_LEVEL", "WARN") // deprecated prefix, no YOURPHR_LOG_LEVEL set

	cfg := configuration{}
	require.NoError(t, cfg.Init()) // Init mirrors FASTEN_* -> YOURPHR_* and sets prefix YOURPHR
	require.Equal(t, "WARN", cfg.GetString("log.level"), "deprecated FASTEN_ env should still resolve via the shim")

	// the canonical YOURPHR_ prefix wins outright
	t.Setenv("YOURPHR_LOG_LEVEL", "DEBUG")
	cfg2 := configuration{}
	require.NoError(t, cfg2.Init())
	require.Equal(t, "DEBUG", cfg2.GetString("log.level"))
}
