# YourPHR — Roadmap

Standalone, community-maintained continuation of [Fasten OnPrem](https://github.com/fastenhealth/fasten-onprem) (GPL v3, attribution retained). Project home: [yourphr.org](https://yourphr.org).

**Mission: Your medical records, immediately and in your hands — for free.** Fulfilling the [21st Century Cures Act](https://www.healthit.gov/topic/oncs-cures-act-final-rule) (2016).

**Goal:** a complete self-hosted PHR with working display for non-US-Core FHIR data and live provider sync via a personal OAuth relay.

> ## 🎯 Staying focused
>
> Prioritize work that gets patients **more complete records, faster, in their own hands** — robust patient-portal/FHIR import (incl. non-US-Core), provider sync, and reliable display of real-world data. When weighing a feature, ask: *does this advance immediate patient access (the Cures Act mission)?* If not, defer it. Avoid scope creep and rabbit-holes.

---

## In progress / recently completed

| Item | Status | Notes |
|---|---|---|
| `sort_title`/`sort_date` generation for all resource types | ✅ Done | Generator fix — Encounter, Condition, Observation, Procedure, DiagnosticReport, DocumentReference, MedicationRequest, Immunization, AllergyIntolerance |
| Encounter display fallbacks for non-US-Core data (Veradigm/FollowMyHealth) | ✅ Done | `class.code` fallback, `encounter_type` from location when `type[]` absent |
| `fasten-sources` stub (build fix) | ✅ Done | Private repo replaced with local stub; vendor committed; upstream #629 |
| GitHub Actions CI (Node.js 24, amd64-only build) | ✅ Done | depot.dev replaced with standard `docker/build-push-action@v6` |
| Reserved username validation | ✅ Done | Cherry-picked from upstream PR #636 |
| Security dep bumps | ✅ Done | `x/crypto` → 0.17.0, `x/sys` → 0.15.0 from Dependabot PRs |

---

## Planned — Phase 1: Data import quality

| Item | Upstream ref | Notes |
|---|---|---|
| FHIR-Converter normalization pre-import | — | Use [fastenhealth/FHIR-Converter](https://github.com/fastenhealth/FHIR-Converter) to clean non-US-Core codings before they hit the DB |
| Edit and delete individual records | [#631](https://github.com/fastenhealth/fasten-onprem/issues/631) | Basic PHR data management |
| Configurable dashboard units (mmHg, kg vs lbs) | [#399](https://github.com/fastenhealth/fasten-onprem/issues/399) | |
| PostgreSQL support | [#361](https://github.com/fastenhealth/fasten-onprem/issues/361) | Long-term; SQLite won't scale for lifetime PHR |

---

## Planned — Phase 2: AI & search

Upstream PR [#594](https://github.com/fastenhealth/fasten-onprem/pull/594) (open, ~100 files) introduces Typesense-powered full-text search + RAG chat via Ollama. Review and merge when ready — covers everything in issues #337 and #623.

| Item | Upstream ref | Notes |
|---|---|---|
| **Typesense search** | [PR #594](https://github.com/fastenhealth/fasten-onprem/pull/594) | Fast full-text search across all FHIR resources |
| **RAG chat (Ollama/LLM)** | [PR #594](https://github.com/fastenhealth/fasten-onprem/pull/594) | "Talk to your health records" via local LLM; recommend MedGemma or Llama 3.1 8B |
| Dynamic frontend config via `/api/env` | [PR #594](https://github.com/fastenhealth/fasten-onprem/pull/594) | Enables optional features without rebuild |
| Personal journal | [#373](https://github.com/fastenhealth/fasten-onprem/issues/373) | Private notes on health timeline |

---

## Planned — Phase 3: Auth & access

| Item | Upstream ref | Notes |
|---|---|---|
| **OIDC / SSO login** | [PR #613](https://github.com/fastenhealth/fasten-onprem/pull/613) | Native OIDC (Google, Auth0, Authentik, Okta) alongside username/password. Could replace reverse-proxy SSO (forward-auth) middleware. ~23 files, 16 commits. |
| **Delegated access** | [PR #614](https://github.com/fastenhealth/fasten-onprem/pull/614) | Grant editing permissions on specific FHIR resources to other YourPHR users. Settings → Delegated Access. ~29 files, 24 commits. |
| Multi-user permissions management | [PR #514](https://github.com/fastenhealth/fasten-onprem/pull/514) | |

---

## Planned — Phase 4: OCR & document capture

Upstream PR [#609](https://github.com/fastenhealth/fasten-onprem/pull/609) (open, ~41 files) adds webcam capture, PDF/image upload, OCR-to-FHIR pipeline.

| Item | Upstream ref | Notes |
|---|---|---|
| **OCR scan → Encounter form** | [PR #609](https://github.com/fastenhealth/fasten-onprem/pull/609) | Capture images from webcam or upload PDF; OCR backend normalises to FHIR R4 Encounter; attaches files. Requires external OCR service. |

---

## Planned — Phase 5: Live provider sync (OAuth gateway)

Replace the commercial Fasten Lighthouse with a self-hosted Cloudflare Worker relay. The Worker acts as the public OAuth callback endpoint; it stores the short-lived authorization code in KV (60s TTL) and the local YourPHR instance polls and exchanges directly with the provider.

| Item | Notes |
|---|---|
| **Cloudflare Worker OAuth relay** | Public callback endpoint; stores code in KV (60s TTL); YourPHR polls and exchanges locally. |
| SMART on FHIR client (Veradigm) | Replace `fasten-sources` stub with real `GetSourceClient` for Veradigm/FollowMyHealth |
| SMART on FHIR client (Epic MyChart) | Second provider |
| Background refresh worker | Re-auth via refresh token; periodic `$everything` sync |

---

## Deferred / watching

| Item | Notes |
|---|---|
| TEFCA / QHIN integrations | [#392](https://github.com/fastenhealth/fasten-onprem/issues/392) — network-level record access; complex, long-term |
| FHIRcast sync mechanism | [#511](https://github.com/fastenhealth/fasten-onprem/issues/511) — real-time EHR event push |

---

## Upstream PR merge strategy

Large feature PRs (#594, #613, #614, #609) are not merged directly because they would conflict with our `go.mod` replace directive, `vendor/` directory, and generated model changes. Approach:

1. When ready for a phase, create a feature branch from `main`
2. `git fetch upstream && git merge upstream/pr/<N>` — resolve conflicts
3. Re-run `go mod vendor` and regenerate models if needed
4. Merge feature branch to `main` once CI passes
