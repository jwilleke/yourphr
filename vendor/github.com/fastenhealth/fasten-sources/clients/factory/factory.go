// Stub for github.com/fastenhealth/fasten-sources/clients/factory
package factory

import (
	"context"
	"fmt"

	"github.com/fastenhealth/fasten-sources/clients/models"
	"github.com/fastenhealth/fasten-sources/pkg"
	"github.com/sirupsen/logrus"
)

// GetSourceClient is a stub — live provider sync is not available in the open-source build.
func GetSourceClient(
	env pkg.FastenLighthouseEnvType,
	ctx context.Context,
	logger *logrus.Entry,
	cred models.SourceCredential,
) (models.SourceClient, error) {
	return nil, fmt.Errorf("live provider sync not available: fasten-sources is a commercial dependency (see fastenhealth/fasten-onprem#629)")
}
