# Sandbox pre-flight results

Latest automated checks of the relay + sandbox discovery endpoints + the mocked connect suite. Re-run any time with the commands below; update this file with the new date.

## Run: 2026-06-15 ~15:56 ET

### Relay (`relay.nerdsbythehour.com`) — ✅ UP

| Endpoint | HTTP | Note |
|---|---|---|
| `/healthz` | **200** | alive |
| `/callback` | **400** | alive — 400 is expected without OAuth `code`/`state` params |

(Earlier in the day this returned **530** — Cloudflare "origin unreachable" — while the relay's site had no internet. 200/400 now confirms the tunnel + pod are back.)

### SMART discovery (`.well-known/smart-configuration`) — all ✅ 200

| Sandbox | HTTP | PKCE | `launch-standalone` | `client-public` | `client-confidential` |
|---|---|---|---|---|---|
| **SMART Health IT** | 200 | S256 | ✅ | ✅ | ✅ |
| **CMS Blue Button** | 200 | S256 | ✅ | ❌ | ✅ (confidential-only — matches our secret-based connect) |
| **Epic** | 200 | S256 | ✅ | ✅ | ✅ |
| **Oracle / Cerner** | 200 | S256 | ✅ | ✅ | ✅ |

Every reachable endpoint supports YourPHR's flow (standalone patient launch + PKCE S256). Blue Button advertises **no** `client-public` — confirming it must be used as a confidential client (with `client_secret`), exactly how we registered it.

(athenahealth omitted — its FHIR base URL is site-specific and not yet obtained. Veradigm omitted — needs a specific test-org endpoint and is provisioning-blocked.)

### Mocked connect suite (Playwright) — ✅ 6 passed, 1 skipped

`frontend/e2e/sandbox-connect.spec.ts` (backend mocked, no external network):

- ✅ smart-health-it / blue-button / epic / oracle-cerner / veradigm — form builds the correct `/authorize` + `/connect` payloads (base URL, scopes, and `client_secret` only for the confidential Blue Button case)
- ✅ validation — empty required fields block the connect
- ⏭ `@live` SMART Health IT — skipped (opt-in `E2E_LIVE=1`)

## What is NOT covered here (and why)

The **full live OAuth handshake** (browser login at the provider → relay → token exchange → record import) is **not** run by these checks. It needs both:

1. a backend with the **relay configured** (`YOURPHR_RELAY_URL` / `YOURPHR_RELAY_SECRET`) — the default e2e backend has neither, and the secret lives in the cluster, and
2. **provider-login UI automation** (the SMART Health IT launcher is scriptable; Epic/Cerner/athenahealth logins are not reliably automatable).

The `@live` Playwright test (`E2E_LIVE=1`) is the scaffold for #2 against SMART Health IT; running it requires #1. Until then, the live connect is validated manually (Blue Button was, end-to-end, 2026-06-14).

## Reproduce

```bash
# Relay health
curl -sS -o /dev/null -w "%{http_code}\n" https://relay.nerdsbythehour.com/healthz

# Discovery for one sandbox (swap the base URL)
curl -s "https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration" | python3 -m json.tool

# Mocked connect suite
cd frontend && yarn run build -- --configuration sandbox && npx playwright test sandbox-connect.spec.ts --project=chromium

# Opt-in live handshake (needs a relay-configured backend)
E2E_LIVE=1 npx playwright test sandbox-connect --grep @live
```

## See also

- [`../test-sandboxes.md`](../test-sandboxes.md) — sandbox index + status
- [`fhir-testing.md`](fhir-testing.md) — connect walkthrough
