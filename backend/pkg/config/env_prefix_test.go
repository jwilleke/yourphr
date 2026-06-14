package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// A YOURPHR_* env var overrides config (prefix + '.'/'-' -> '_' key mapping).
func TestEnvPrefix_Yourphr(t *testing.T) {
	t.Setenv("YOURPHR_LOG_LEVEL", "DEBUG")

	cfg := configuration{}
	require.NoError(t, cfg.Init())
	require.Equal(t, "DEBUG", cfg.GetString("log.level"))
}
