// Stub replacement for github.com/fastenhealth/fasten-sources/pkg
// fasten-sources was made private when EHR integrations were moved to Fasten Connect.
// This stub satisfies all compile-time imports; no runtime provider sync is implemented.
// See: https://github.com/fastenhealth/fasten-onprem/issues/629
package pkg

import (
	"fmt"
	"strings"
)

type FastenLighthouseEnvType string
type PlatformType string
type FhirVersionType string

const (
	PlatformTypeFasten  PlatformType = "fasten"
	PlatformTypeManual  PlatformType = "manual"
	PlatformTypeEhr     PlatformType = "ehr"

	FASTENHEALTH_URN_PREFIX = "urn:fastenhealth:"

	FhirVersion401 FhirVersionType = "4.0.1"

	FastenLighthouseEnvTypeSandbox    FastenLighthouseEnvType = "sandbox"
	FastenLighthouseEnvTypeProduction FastenLighthouseEnvType = "production"
)

// ParseReferenceUri parses a fastenhealth URN into (sourceId, resourceType, resourceId).
func ParseReferenceUri(ref *string) (string, string, string, error) {
	if ref == nil {
		return "", "", "", fmt.Errorf("nil reference")
	}
	// urn:fastenhealth:<sourceId>/<resourceType>/<resourceId>
	trimmed := strings.TrimPrefix(*ref, FASTENHEALTH_URN_PREFIX)
	parts := strings.SplitN(trimmed, "/", 3)
	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("invalid fastenhealth URN: %s", *ref)
	}
	return parts[0], parts[1], parts[2], nil
}

// GetFastenLighthouseEnv returns the current lighthouse environment.
func GetFastenLighthouseEnv() FastenLighthouseEnvType {
	return FastenLighthouseEnvTypeProduction
}
