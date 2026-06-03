// Stub for github.com/fastenhealth/fasten-sources/catalog
package catalog

import (
	"fmt"

	"github.com/fastenhealth/fasten-sources/pkg"
)

type Brand struct {
	Id   string
	Name string
}

type Portal struct {
	Id   string
	Name string
}

type Endpoint struct {
	Id           string
	Name         string
	PlatformType pkg.PlatformType
}

func (e Endpoint) GetPlatformType() pkg.PlatformType {
	return e.PlatformType
}

// GetPatientAccessInfoForLegacySourceType is a stub — catalog lookup not available.
func GetPatientAccessInfoForLegacySourceType(sourceType string, apiEndpointBaseUrl string) (Brand, Portal, Endpoint, pkg.FastenLighthouseEnvType, error) {
	return Brand{}, Portal{}, Endpoint{}, "", fmt.Errorf("source catalog not available: fasten-sources is a commercial dependency (see fastenhealth/fasten-onprem#629)")
}
