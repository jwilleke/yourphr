# AI-assisted search & chat setup

Ported from upstream [fasten-onprem#594](https://github.com/fastenhealth/fasten-onprem/pull/594): a Typesense-backed
full-text/vector search over your imported FHIR resources (`/resource/summary`, and the search box on the
dashboard), and an LLM chat page (`/chat`) that answers questions grounded in those same resources.

**Off by default** (`search.enabled: false`) — a stock `docker compose up -d` with no `.env` never touches
Typesense or an LLM, and the container starts fine either way. Everything below is only needed to turn the
feature **on**.

## Required `.env` values

Copy from `.env.docker.example`, uncomment the search block, and set:

```
YOURPHR_SEARCH_ENABLED=true
YOURPHR_SEARCH_API_KEY=<generate: openssl rand -hex 16>
YOURPHR_SEARCH_CHAT_MODEL_NAME=vllm/<model-name>       # e.g. vllm/llama3.1:8b, vllm/medgemma:4b
YOURPHR_SEARCH_CHAT_MODEL_VLLM_URL=http://<host>:<port> # your Ollama (or any OpenAI/vLLM-compatible) endpoint
```

Notes on each:

- **`YOURPHR_SEARCH_API_KEY`** — this same value also becomes Typesense's own `TYPESENSE_API_KEY`
  (`docker-compose.yml` derives it from the same env var), so the two are always in sync. Don't reuse a
  secret from anywhere else — see the security note below on why this key offers little protection here.
- **`YOURPHR_SEARCH_CHAT_MODEL_NAME`** — must be prefixed `vllm/`. That prefix is how Typesense's
  conversation-model API decides to call *your* `vllm_url` instead of OpenAI's hosted API; the part after
  the slash is passed through as the model name your endpoint understands (an Ollama tag, a vLLM served
  model name, etc).
- **`YOURPHR_SEARCH_CHAT_MODEL_VLLM_URL`** — any OpenAI/vLLM-compatible chat-completions endpoint. Verified
  working against a real remote **Ollama** instance: point this at `http://<ollama-host>:11434` (bare
  Ollama URL, **no** `/v1` suffix). If Ollama runs on the same machine as Docker Desktop, use
  `http://host.docker.internal:11434`; if it's a separate host on your network, use its actual
  address/hostname — just make sure that host and port are reachable from wherever the `typesense`
  container runs (test with `docker run --rm --network <project>_default curlimages/curl:latest
  http://<host>:<port>/api/tags`).
- **Ollama must have the model loaded into memory before chat will work.** `ollama pull <model>` only
  downloads it — Ollama loads a model into memory on its first inference request and otherwise unloads it
  after a few minutes of idle, so the *first* chat message after a restart can time out or fail while the
  model is still loading. Run `ollama run <model-name>` on the Ollama host once (matching the part after
  `vllm/` in `YOURPHR_SEARCH_CHAT_MODEL_NAME`) to load it into memory ahead of time — you can exit the
  interactive prompt with `/bye` right after, the model stays loaded.
- Restart the `fasten` container after changing any of these (`docker compose up -d` after editing `.env`,
  or `docker compose restart fasten` if only `.env` changed and the image didn't) — Typesense's
  conversation model is only created once, at process startup.

## Context window (`search.chat.model.max_bytes`)

`search.chat.model.max_bytes` (env: `YOURPHR_SEARCH_CHAT_MODEL_MAX_BYTES`, default `28672`) caps how much
context Typesense assembles per chat turn — system prompt + retrieved records + conversation history. This
is a byte budget on Typesense's side, separate from Ollama's own context-window setting for the model, but
the effect is the same: a small budget truncates the medical context the model actually sees, and it answers
from less information.

**Tested: raising this to `57344` (double the default) noticeably improved answer quality** — fewer
"I don't have enough information" responses, and answers that referenced more of the actual imported
records. If you have the memory/VRAM headroom on the Ollama side for a larger context, this is worth raising
before concluding the model itself is the limiting factor. There's no known upper bound documented here yet
— treat 57344 as a verified-better floor, not a ceiling, and raise further if your model's own context
window supports it.

Like the other `search.chat.model.*` keys, this only takes effect for a Typesense conversation model that
doesn't exist yet (see the model-id gotcha below) — bump `search.chat.model.id` and restart `fasten` if
you're changing it on an instance that already created one.

## Why the Typesense port is published (security tradeoff)

`docker-compose.yml` / `docker-compose-prod.yml` publish Typesense's port (`8108:8108`) rather than only
`expose`-ing it inside the compose network. This is required, not incidental: the frontend's
`TypesenseService` (`frontend/src/app/services/typesense.service.ts`) connects to Typesense **directly from
the browser** — search and chat requests never go through the `fasten` backend — so the port has to be
reachable from wherever the browser runs, not just from other containers.

**This reopens something worth knowing about before you enable it on anything but a trusted single-user
box.** Typesense indexes your FHIR/PHI-derived resources, and `GET /api/settings` is a public,
**unauthenticated** endpoint that already returns `search.api_key` in plaintext. That means anyone who can
reach port 8108 *and* load that one endpoint can query your indexed medical records directly, bypassing
every session/auth check in the `fasten` backend. Fine for local development or a box only reachable from
your own machine; before running this on anything network-shared, either firewall port 8108 to trusted
hosts only, or (the real fix, not yet implemented) route search/chat through an authenticated backend proxy
instead of exposing Typesense to the browser at all.

## Content-Security-Policy

The backend's CSP `connect-src` is computed per-request to include Typesense's origin automatically
(`backend/pkg/web/middleware/security_headers.go`, derived from `search.uri`'s port plus the request's own
host and scheme) — you don't need to configure anything here. If you see a browser console error like
`Refused to connect because it violates the document's Content-Security-Policy` pointing at your Typesense
port, that's a sign `search.enabled` wasn't actually true on that request (double-check `GET /api/settings`
in the browser reflects it) rather than something to work around by hand.

## A model-id gotcha if you edit config after first boot

`search.chat.model.id` (default `conv-model-1`) names the Typesense conversation-model record — it is only
**created once**, at `fasten` startup, and never updated afterward. If you change
`search.chat.model.name` / `vllm_url` later (e.g. via Admin → Configuration) without also bumping
`search.chat.model.id` to a new value, the *old* Typesense model (still pointing at the old
name/URL) keeps being used, because nothing tells Typesense to recreate it. Symptom: `/api/settings` shows
your new config, but chat still behaves like the old one (or errors). Fix: either delete the stale model via
Typesense's API (`DELETE /conversations/models/<old-id>` with the `X-TYPESENSE-API-KEY` header) or set
`search.chat.model.id` to a fresh value and restart — either way, restart `fasten` afterward so
`ensureConversationModel` runs again.

## Importing test data to try it out

Search and chat need resources in your record before either does anything useful. Two ways to get synthetic
(zero real PHI) FHIR data in:

1. **Manual upload** — Sources → Add records → drag a FHIR JSON bundle (or C-CDA XML, if the converter
   sidecar is enabled) onto the upload zone. Synthea-generated sample bundles work well for this; e.g. the
   in-repo test fixture at `backend/pkg/database/testdata/*.json`, or any bundle from
   [Synthea's sample data releases](https://github.com/synthetichealth/synthea).
2. **SMART Health IT sandbox** — Sources → Add records → the **"Use SMART Health IT"** button on the admin
   Sandbox page (`/sandbox`) prefills a public test FHIR server, no registration or credentials needed. See
   [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) for the full flow and
   other available sandboxes.

Both land the same way: resources are stored, and if `search.enabled` is true they're indexed into Typesense
as part of the same import request (you'll see `Indexing resource in Typesense` / `Resource indexed
successfully in Typesense` in the `fasten` container logs as it happens).

## Verifying it actually works

- **Search**: type into the "Search your record" box on the dashboard, or visit `/web/resource/summary`.
  Results should appear within a second or two.
- **Chat**: sign in, open **Chat** in the nav (only visible when `search.enabled` is true — gated by
  `ChatFeatureGuard`), ask something the imported records can answer (e.g. "What medications am I taking?").
  A relevant, grounded answer confirms the full chain — browser → Typesense → your LLM endpoint → back —
  is working.
- If chat/search UI doesn't appear at all: confirm `search.enabled` is `true` via `GET /api/settings`
  (unauthenticated, safe to check from a browser tab) — both the dashboard search box and the Chat nav link
  read this value directly.
- If it appears but errors ("Could not get a response" / silently empty): open the browser console.
  A CSP or `Failed to fetch` error against your Typesense port means the port-publish or CSP pieces above
  aren't in effect (rebuild/restart `fasten`, confirm `docker compose ps` shows `8108:8108` published, not
  just `8108/tcp` exposed). A Typesense error naming your LLM endpoint means the network path in
  `YOURPHR_SEARCH_CHAT_MODEL_VLLM_URL` isn't reachable from the `typesense` container — re-run the
  `curl`-from-the-compose-network check above.
