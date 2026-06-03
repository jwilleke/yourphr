// Stub for github.com/fastenhealth/fasten-sources/definitions
package definitions

import "fmt"

type GetSourceConfigOptions struct {
	EndpointId string
	BrandId    string
	PortalId   string
}

// LighthouseSourceDefinition mirrors the fields accessed by fasten-onprem.
type LighthouseSourceDefinition struct {
	Id                                string
	Name                              string
	TokenEndpoint                     string
	TokenEndpointAuthMethodsSupported []string
	DynamicClientRegistrationEndpoint string
	DynamicClientRegistrationMode     string
	RegistrationEndpoint              string
	Issuer                            string
	CORSRelayRequired                 bool
}

// GetSourceDefinition is a stub — provider lookup is not available in the open-source build.
func GetSourceDefinition(opts GetSourceConfigOptions) (*LighthouseSourceDefinition, error) {
	return nil, fmt.Errorf("provider source definitions not available: fasten-sources is a commercial dependency (see fastenhealth/fasten-onprem#629)")
}
