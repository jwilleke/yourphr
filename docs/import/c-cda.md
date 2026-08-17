# Importing C-CDA / CCD (XML) documents

Many patient portals — Epic MyChart in particular — export a __C-CDA__ (Consolidated Clinical Document Architecture) XML document rather than a FHIR JSON bundle. YourPHR imports FHIR natively; C-CDA has to be converted first.

Conversion runs __entirely on your own server__, in a separate container. The raw document is PHI and is never sent to a third party.

## It works out of the box

Since __v1.15.0__ ([#404](https://github.com/jwilleke/yourphr/issues/404)) the shipped compose files start the converter automatically and `config.yaml` points the app at it. A stock install imports an Epic C-CDA export with no extra steps:

```bash
docker compose up -d
```

Then upload the XML. Nothing to enable, no second command.

Earlier releases required starting a separate profile and setting two variables — see [Upgrading from before v1.15.0](#upgrading-from-before-v1150).

## Turning it OFF

The converter is an extra container. If you only ever import FHIR JSON and would rather not run it:

```bash
YOURPHR_CDA_CONVERTER_ENABLED=false
```

…or `docker compose up -d --scale cda-converter=0`. It is stateless and stores nothing, so removing it loses no data.

## Running without the shipped compose files

If you deploy the app by hand (a bare k8s Deployment, your own manifests), the sidecar will __not__ exist just because the app expects it. Either:

- deploy it — see [`deploy/yourphr-cda-converter.example.yaml`](../../deploy/yourphr-cda-converter.example.yaml) — and set `YOURPHR_CDA_CONVERTER_URL` to its in-cluster address, or
- set `YOURPHR_CDA_CONVERTER_ENABLED=false`.

Uploading XML with no reachable converter fails with an error naming the address it tried and all three ways out. Nothing else is affected.

## Upgrading from before v1.15.0

If you already set `YOURPHR_CDA_CONVERTER_ENABLED` / `_URL`, they still work and continue to override the defaults — nothing to undo. If you were using `--profile cda`, the profile is gone: the service now starts with a plain `up`.

> __Using a `docker-compose.yml` from before v1.13.4?__ Update it, or these variables will be ignored ([#397](https://github.com/jwilleke/yourphr/issues/397)). Compose reads `.env` only to substitute `${...}` __inside the compose file__ — it does not forward those values into the container. Earlier compose files passed through only `HOST_IP`/`HOST_PORT`, so `YOURPHR_*` settings in `.env` silently never reached the app. The current file fixes this with:
>
> ```yaml
>     env_file:
>       - path: .env
>         required: false
>       - path: .env_custom
>         required: false
> ```
>
> Confirm what Compose will actually pass with `docker compose config | grep YOURPHR_`. If your variables do not appear there, the app will not see them.

## Configuration reference

The Convert dialog only offers a __Convert__ button when the server reports the converter is ready, so if it shows setup steps instead, something below is wrong.

### Watch the variable names

This is the single most common failure ([#397](https://github.com/jwilleke/yourphr/issues/397)). The __config keys__ are `cda_converter.enabled` and `cda_converter.url`. The __environment variables__ are those keys upper-cased with a `YOURPHR_` prefix and `.` replaced by `_`:

| Config key | Environment variable |
|---|---|
| `cda_converter.enabled` | `YOURPHR_CDA_CONVERTER_ENABLED` |
| `cda_converter.url` | `YOURPHR_CDA_CONVERTER_URL` |
| `cda_converter.timeout_seconds` | `YOURPHR_CDA_CONVERTER_TIMEOUT_SECONDS` |

`FASTEN_CDA_CONVERTER_ENABLED` and a bare `CDA_CONVERTER_ENABLED` are __silently ignored__ — the prefix is `YOURPHR_`, and an unrecognized variable produces no warning.

You can also set these in `config.yaml` instead of the environment:

```yaml
cda_converter:
  enabled: true
  url: http://cda-converter:8080
  timeout_seconds: 60
```

## Checking what the server actually sees

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://your-instance/api/secure/source/cda-converter/status
# {"success":true,"data":{"enabled":true,"ready":true,"setup_hint":"..."}}
```

- `enabled` — the opt-in flag alone.
- `ready` — the flag __and__ a converter address are both set. Only `ready: true` will convert.

If `enabled` is `true` but `ready` is `false`, the URL is missing — that half-configured state is easy to miss.

## Kubernetes

An example manifest is in [`deploy/yourphr-cda-converter.example.yaml`](../../deploy/yourphr-cda-converter.example.yaml). Set `cda_converter.url` to the in-cluster service address (e.g. `http://yourphr-cda-converter:8080`) and keep the service internal — do not expose it publicly.

## What the converter does

The sidecar is the open-source [Metriport fhir-converter](https://github.com/metriport/metriport/tree/master/packages/fhir-converter). YourPHR posts the raw document, receives a FHIR R4 bundle, and feeds it through the normal import pipeline. The patient id is derived deterministically from the document's `recordTarget/patientRole/id`, so re-importing the same person's documents does not create duplicate patients.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `C-CDA import is not enabled on this server` | it was explicitly disabled — `YOURPHR_CDA_CONVERTER_ENABLED=false`, or an older config. On v1.15.0+ it is on by default |
| `no converter address is configured` | `YOURPHR_CDA_CONVERTER_URL` unset — the flag alone is not enough |
| `C-CDA conversion service unreachable at ...` | the sidecar is not running or not reachable at that address. With the shipped compose files it starts automatically (`docker compose up -d`); deploying by hand, see [`deploy/yourphr-cda-converter.example.yaml`](../../deploy/yourphr-cda-converter.example.yaml), or set `YOURPHR_CDA_CONVERTER_ENABLED=false` |
| Conversion times out on a large export | raise `YOURPHR_CDA_CONVERTER_TIMEOUT_SECONDS` |
