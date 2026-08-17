# Local fhir-converter container (C-CDA → FHIR)

How to build and run the __Metriport fhir-converter__ locally — the sidecar that converts C-CDA / CCD documents to FHIR R4 for manual import ([#254](https://github.com/jwilleke/yourphr/issues/254)). Validated end-to-end in #254 Phase 0.

## What it is

- The converter is __Metriport's `fhir-converter`__ — a Node/Express HTTP service (Handlebars templates descended from Microsoft's open-source FHIR Converter) that maps C-CDA R2.1 documents to a FHIR R4 `Bundle`.
- It is a __separate process / container__, not part of the Go binary. YourPHR's backend POSTs the raw CCD to it and feeds the returned FHIR through the existing import pipeline. See `backend/pkg/web/handler/cda_converter.go`.
- __License:__ the `fhir-converter` package is __AGPL-3.0-only__. Running it as an isolated process keeps it an independent work (no GPLv3 combined-work entanglement).
- __It is stateless__ — no database, no persistence, holds no PHI beyond the in-flight request.

## Run it locally

There is __no published image__ — build from source (Node 18; a few minutes the first time):

```bash
git clone --depth 1 https://github.com/metriport/metriport.git /tmp/metriport
cd /tmp/metriport/packages/fhir-converter
docker compose up --build -d        # serves on http://localhost:8777
```

If the build fails with `DeadlineExceeded` pulling the base image, pre-pull then rebuild:

```bash
docker pull node:18 && docker pull node:18-slim
docker compose up --build -d
```

Health check (the service answers `200` on `/`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8777/
```

Stop and remove it:

```bash
docker compose -f /tmp/metriport/packages/fhir-converter/docker-compose.yml down
```

## Convert a document

- __Endpoint:__ `POST /api/convert/cda/ccd.hbs?patientId=<id>`
- __Content-Type:__ `text/plain`; send the raw CDA XML as the body (use `curl --data-binary`, not `-d`, so XML whitespace is preserved).
- __`patientId`__ becomes the FHIR `Patient.id`. YourPHR passes a __stable__ id derived from the CDA `recordTarget` so re-imports stay idempotent — never a random value.
- __Response__ is the FHIR bundle wrapped in an envelope:

```json
{ "fhirResource": { "resourceType": "Bundle", "type": "batch", "entry": [ ... ] } }
```

The backend unwraps `.fhirResource` before importing.

```bash
# fetch a synthetic CCD and convert it
curl -sL "https://raw.githubusercontent.com/HL7/CDA-ccda-2.1/master/examples/C-CDA_R2-1_CCD.xml" -o sample.xml
curl -s -X POST "http://localhost:8777/api/convert/cda/ccd.hbs?patientId=test-1" \
  -H "Content-Type: text/plain" --data-binary @sample.xml -o bundle.json
```

Use __synthetic__ CCDs only (HL7 examples, Synthea). Never run real patient documents through a casual local setup, and never commit them.

## Gotchas

- __No prebuilt image__ — `ghcr.io/metriport/fhir-converter` does not exist; you must build from source.
- __Port mapping is indirect__ — the app binds `8080` inside the container; compose publishes it as `8777`. From the host, use `8777`. Bare `docker run` needs `-p 8777:8080`.
- __Node 18__ — older than YourPHR's Node 24, but isolated in its own container, so no conflict.
- __Deterministic ids__ — the converter mints resource ids with UUID v3 (content-derived), so the same CCD yields the same ids on every run (verified in Phase 0).
- Templates are baked into the image; no separate mount needed.

## How YourPHR uses it

Conversion needs a running converter. Since v1.15.0 the shipped compose files start one and the defaults point at it, so a stock `docker compose up` needs no configuration. Elsewhere, point the backend at your own:

```yaml
cda_converter:
  enabled: true
  url: 'http://localhost:8777'        # dev; 'http://yourphr-cda-converter:8777' in k8s
  timeout_seconds: 60
```

With it enabled, a `.xml` / `.ccd` upload (manual upload or the UI) is detected, converted by this sidecar, and imported — the raw CCD never leaves the instance. With it disabled, a CCD upload returns a clear "C-CDA import is not enabled" error.

## Packaged image + deploy (Phase 2)

The sidecar is packaged like the relay (`yourphr-relay`). The image is published at __`ghcr.io/jwilleke/yourphr-cda-converter`__ (tags `:main` and `:<metriport-ref>`).

- __Image build:__ `.github/workflows/docker-cda-converter.yaml` — a __manual__ (`workflow_dispatch`) job that clones Metriport at a __pinned ref__ and pushes `ghcr.io/jwilleke/yourphr-cda-converter`. It is manual because it repackages a third-party __AGPL-3.0__ image; the corresponding source/ref is recorded in the image's `org.opencontainers.image.source` / `.revision` / `.licenses` labels (AGPL source correspondence). Run it from the Actions tab, optionally overriding the `metriport_ref` input, to publish/refresh the image.
- __Package visibility:__ a workflow-pushed package under the user namespace is __private by default__. For k8s/Flux to pull it without credentials, make the package __public__ (GitHub → Packages → `yourphr-cda-converter` → Package settings → Change visibility — there is no REST API for this, it is a UI action), __or__ add an `imagePullSecret` with ghcr credentials to the deployment.
- __Dev (docker-compose):__ a `cda-converter` service is defined in `docker-compose.yml` and, since v1.15.0 ([#404](https://github.com/jwilleke/yourphr/issues/404)), starts by DEFAULT — `docker compose up` brings it with the app, and the shipped default already points `cda_converter.url` at `http://cda-converter:8080`. It is `expose`-only, never published to a host port (raw C-CDA is PHI). To run without it: `docker compose up --scale cda-converter=0` or `YOURPHR_CDA_CONVERTER_ENABLED=false`.
- __Prod (k8s/Flux):__ copy `deploy/yourphr-cda-converter.example.yaml` into `jwilleke/mj-infra-flux` (`apps/.../yourphr-cda-converter/`). It is a Deployment + Service in the `fasten` namespace with __no Ingress__ — the converter is __internal-only__ (raw CCD is full PHI and must never leave the cluster). The app reaches it at `http://yourphr-cda-converter:8080`.

Tracked in [#254](https://github.com/jwilleke/yourphr/issues/254).
