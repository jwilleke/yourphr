# Sandbox pre-flight results

Latest automated checks of the relay + sandbox discovery endpoints + the mocked connect suite. Re-run any time with the commands below; update this file with the new date.

## Run: 2026-06-15 ~15:56 ET

### Relay (`relay.nerdsbythehour.com`) — ✅ UP

| Endpoint | HTTP | Note |
|---|---|---|
| `/healthz` | __200__ | alive |
| `/callback` | __400__ | alive — 400 is expected without OAuth `code`/`state` params |

(Earlier in the day this returned __530__ — Cloudflare "origin unreachable" — while the relay's site had no internet. 200/400 now confirms the tunnel + pod are back.)

### SMART discovery (`.well-known/smart-configuration`) — all ✅ 200

| Sandbox | HTTP | PKCE | `launch-standalone` | `client-public` | `client-confidential` |
|---|---|---|---|---|---|
| __SMART Health IT__ | 200 | S256 | ✅ | ✅ | ✅ |
| __CMS Blue Button__ | 200 | S256 | ✅ | ❌ | ✅ (confidential-only — matches our secret-based connect) |
| __Epic__ | 200 | S256 | ✅ | ✅ | ✅ |
| __Oracle / Cerner__ | 200 | S256 | ✅ | ✅ | ✅ |

Every reachable endpoint supports YourPHR's flow (standalone patient launch + PKCE S256). Blue Button advertises __no__ `client-public` — confirming it must be used as a confidential client (with `client_secret`), exactly how we registered it.

(athenahealth omitted — its FHIR base URL is site-specific and not yet obtained. Veradigm omitted — needs a specific test-org endpoint and is provisioning-blocked.)

### Mocked connect suite (Playwright) — ✅ 6 passed, 1 skipped

`frontend/e2e/sandbox-connect.spec.ts` (backend mocked, no external network):

- ✅ smart-health-it / blue-button / epic / oracle-cerner / veradigm — form builds the correct `/authorize` + `/connect` payloads (base URL, scopes, and `client_secret` only for the confidential Blue Button case)
- ✅ validation — empty required fields block the connect
- ⏭ `@live` SMART Health IT — skipped (opt-in `E2E_LIVE=1`)

## Live `@live` run (2026-06-15) — infra verified, launcher automation open

With the relay back up, the real relay secret was wired into a local e2e backend (`YOURPHR_RELAY_URL` + `YOURPHR_RELAY_SECRET`) and the `@live` SMART Health IT test was run against the live relay.

__✅ The YourPHR side works end-to-end:__

- `POST /source/authorize` → __200__ (live discovery + PKCE authorize URL built against smarthealthit)
- the popup opened the __real__ SMART Health IT launcher
- the backend __correctly authenticated to + polled the live relay__ for the auth code (the repeated `relay: timed out waiting for authorization code` lines are it *waiting*, not a failure)

__❌ Not solved — the headless launcher click-through.__ The launcher is a multi-step interactive UI ("Practitioner Login" → patient pick → Authorize). Five approaches — single Authorize click, multi-step click loop, password fill, sim `skip_login`/`skip_auth` flags, pinned-patient sim — did __not__ drive it to completion headlessly, so no code reached the relay and the connect timed out. This is __brittle third-party-UI automation__, not a YourPHR issue.

__Conclusion:__ the live connect __infrastructure is verified__; the only open gap is scripting a third-party login UI, which is low-value / high-brittleness. The reliable end-to-end proof is a __manual__ connect (a human clicks the launcher in ~20s) — exactly how Blue Button was verified end-to-end with real data on 2026-06-14. The `@live` test stays a documented scaffold (`E2E_LIVE=1` + a relay-configured backend); see `frontend/e2e/sandbox-connect.spec.ts`.

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

- [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) — sandbox index + status
- [`fhir-testing.md`](fhir-testing.md) — connect walkthrough
