# yourphr-relay

The YourPHR SMART on FHIR OAuth **store-and-poll relay** — EPIC #20, issue #50.

A small, stateless public bouncer for the SMART authorization `code`. The provider redirects the user's browser to `/callback?code&state`; the relay stores `{state -> code}` in memory with a short TTL; the (possibly non-public) YourPHR instance polls `/pending?state=` (gated by a shared secret) to retrieve the `code` and completes the token exchange itself. The relay **never sees access/refresh tokens** and holds **no provider app registration** — it is provider-agnostic and client-agnostic (per-user / BYO model).

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

For dev/demo it deploys to the existing k8s cluster via `mj-infra-flux` behind Cloudflare ingress at `relay.nerdsbythehour.com`. It must be **publicly reachable and excluded from Authentik forward-auth** (`/callback` is unauthenticated; `/pending` is shared-secret gated). An example manifest is in [`deploy/yourphr-relay.example.yaml`](./deploy/yourphr-relay.example.yaml) — copy it into `mj-infra-flux` and set the secret.

## Security

- The relay only ever holds the short-lived `code` (~60s TTL), never tokens.
- `/pending` is gated by a constant-time shared-secret comparison.
- Codes are single-use (deleted on read) and auto-expire; a background janitor evicts stragglers.
