# smart-spike

Throwaway proof-of-flow for SMART on FHIR — EPIC #20, issue #48.

Runs the full standalone patient-launch authorization-code + PKCE flow against a SMART **sandbox** using the same libraries the production backend will use (`golang.org/x/oauth2` + `net/http`), then fetches `Patient/$everything` and saves the Bundle. It de-risks the architecture before we build the real client and relay (#49–#53).

This is a **separate Go module** (its own `go.mod`) so it never affects the backend build or `make test-backend`.

## Safety

Point this **only** at a sandbox with synthetic test patients — never a real provider. No PHI. The default target is the SMART Health IT R4 sandbox, which accepts public clients and a loopback redirect, so **no app registration and no relay are needed** for the spike.

## Run

```sh
cd scripts/smart-spike
go run .
```

A browser opens to the sandbox login / patient picker. Pick a test patient and approve; the program catches the redirect on `http://localhost:8088/callback`, exchanges the code, fetches the Bundle, and writes `bundle.json`.

Flags:

```sh
go run . -fhir https://launch.smarthealthit.org/v/r4/fhir -client my_web_app -port 8088 -out bundle.json
```

| Flag | Default | Meaning |
|---|---|---|
| `-fhir` | SMART Health IT R4 sandbox | SMART FHIR base URL (sandbox only) |
| `-client` | `my_web_app` | `client_id` (the sandbox accepts public clients) |
| `-scope` | `launch/patient patient/*.read openid fhirUser offline_access` | requested scopes |
| `-port` | `8088` | local loopback callback port |
| `-out` | `bundle.json` | output file for the fetched Bundle |

## What it proves

1. `.well-known/smart-configuration` discovery.
2. Authorize URL with PKCE (S256) + `state` + `aud`.
3. Loopback callback capture and `state` validation.
4. Token exchange with the PKCE verifier; reading the `patient` field from the token response.
5. Authenticated `GET Patient/{id}/$everything` and Bundle persistence.

`bundle.json` is git-ignored (see `.gitignore` here) so no fetched data is committed.
