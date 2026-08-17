# yourphr-relay

The YourPHR SMART on FHIR OAuth __store-and-poll relay__ — EPIC #20, issue #50.

A small, stateless public bouncer for the SMART authorization `code`. The provider redirects the user's browser to `/callback?code&state`; the relay stores `{state -> code}` in memory with a short TTL; the (possibly non-public) YourPHR instance polls `/pending?state=` (gated by a shared secret) to retrieve the `code` and completes the token exchange itself. The relay __never sees access/refresh tokens__ and holds __no provider app registration__ — it is provider-agnostic and client-agnostic (per-user / BYO model).

See [`docs/planning/smart-on-fhir/oauth-gateway.md`](../../../docs/planning/smart-on-fhir/oauth-gateway.md).

## Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /callback?code=C&state=S` | open (the provider must reach it) | stores `{state: code}` with a ~60s TTL; returns an HTML "you may close this window" page |
| `GET /pending?state=S` | `X-Yourphr-Token: <secret>` | returns `{"code": "..."}` and deletes the entry, or `404` if absent/expired |
| `GET /healthz` | open | liveness probe |

## Configuration

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `YOURPHR_RELAY_SECRET` | yes | — | shared secret required on `/pending` |
| `PORT` | no | `8080` | listen port |

## Run locally

```sh
YOURPHR_RELAY_SECRET=dev-secret PORT=8088 go run ./backend/cmd/relay
```

## Build the image

```sh
docker build -f Dockerfile.relay -t yourphr-relay .
```

## Deploy

For dev/demo it deploys to the existing k8s cluster via `mj-infra-flux` behind Cloudflare ingress at `relay.nerdsbythehour.com`. It must be __publicly reachable and excluded from Authentik forward-auth__ (`/callback` is unauthenticated; `/pending` is shared-secret gated). An example manifest is in [`deploy/yourphr-relay.example.yaml`](./deploy/yourphr-relay.example.yaml) — copy it into `mj-infra-flux` and set the secret.

## Pointing YourPHR at your own relay

Configure the __app__ (not the relay) with two URLs — they are reached by different parties, so a self-hosted deployment usually needs both ([#399](https://github.com/jwilleke/yourphr/issues/399)):

| Config key | Env var | Reached by | Notes |
|---|---|---|---|
| `relay.url` | `YOURPHR_RELAY_URL` | the YourPHR __backend__, polling `/pending` | may be private/cluster-internal, e.g. `http://yourphr-relay.yourphr.svc.cluster.local:8080` |
| `relay.public_url` | `YOURPHR_RELAY_PUBLIC_URL` | the __provider__, redirecting the user's browser | public origin; `<this>/callback` is the OAuth `redirect_uri` you register with each FHIR vendor |
| `relay.secret` | `YOURPHR_RELAY_SECRET` | both | shared secret gating `/pending` |

If your relay is a single publicly-reachable `https` origin, set only `YOURPHR_RELAY_URL` — `relay.public_url` defaults to it. Set `YOURPHR_RELAY_PUBLIC_URL` when the poll URL is internal or non-https. With neither set, the project dev/demo relay is used.

These are ordinary config keys, so they can come from `.env` / `.env_custom`, real environment variables, or Admin → Configuration (see [`docs/configuration-system.md`](../../../docs/configuration-system.md)). __No frontend rebuild is needed__ — `redirect_uri` is derived by the backend at request time, not compiled into the Angular bundle.

Check what your instance actually resolved to:

```sh
curl -s -H "Authorization: Bearer $TOKEN" https://your-instance/api/secure/source/relay-config
# {"success":true,"data":{"callback_url":"https://relay.example.org/callback","configured":true}}
```

## Security

- The relay only ever holds the short-lived `code` (~60s TTL), never tokens.
- `/pending` is gated by a constant-time shared-secret comparison.
- Codes are single-use (deleted on read) and auto-expire; a background janitor evicts stragglers.
