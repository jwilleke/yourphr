# Fastenhealth ecosystem — research notes

Findings from reviewing the [fastenhealth org repositories](https://github.com/orgs/fastenhealth/repositories) and the [fasten-onprem issues](https://github.com/fastenhealth/fasten-onprem/issues) as of 2026-06-03. Organized by relevance to the `jwilleke/yourphr` fork goal: a complete self-hosted PHR with working display for non-US-Core FHIR data (Veradigm/FollowMyHealth).

## Repos worth using in the fork

| Repo | License | Why it matters |
|---|---|---|
| [ngx-fhir](https://github.com/fastenhealth/ngx-fhir) | — | Angular FHIR display component library — Angular-native fix for Encounter/Condition rendering gaps |
| [FHIR-Converter](https://github.com/fastenhealth/FHIR-Converter) | — | Converts legacy/non-standard formats into FHIR — directly relevant to normalizing Veradigm's non-US-Core output before import |
| [fasten-toolbox](https://github.com/fastenhealth/fasten-toolbox) | — | Standalone FHIR tools based on fasten-onprem — useful for data inspection and manipulation outside the main app |
| [fasten-answers-ai](https://github.com/fastenhealth/fasten-answers-ai) | — | POC for AI querying of your health record (offline LLM) — the #337/#623 issues ask for exactly this; POC already exists |
| [fasten-sources-etl](https://github.com/fastenhealth/fasten-sources-etl) | — | Data processing pipeline for sources — could power a normalization step for non-US-Core imports |
| [gofhir-models](https://github.com/fastenhealth/gofhir-models) | — | Go FHIR R4 models — already used by fasten-onprem backend; understanding it is needed to fix backend extraction bugs |

## Repos to ignore

Everything with `connect` in the name (`fasten-connect-stitch-*`, `fasten-connect-vault-*`, `fasten-connect-quickstart`) is the commercial Fasten Connect product (paid SDK for embedding provider sync into third-party apps). Not open-source, not relevant.

`folio`, `wails`, `gon`, `terraform-aws-github-runner`, `ec2-github-runner`, `pouchdb-authentication` — upstream infrastructure forks, not applicable.

## Issues that directly match our current bugs

These are already filed upstream; our fixes should reference them.

| Issue | What it is |
|---|---|
| [#428](https://github.com/fastenhealth/fasten-onprem/issues/428) | Extracted `code` field may be missing content — exactly our Condition display failure (Veradigm uses proprietary coding system URI) |
| [#430](https://github.com/fastenhealth/fasten-onprem/issues/430) | Date/Periods not correctly extracted into search parameters — affects encounter timeline sorting |
| [#431](https://github.com/fastenhealth/fasten-onprem/issues/431) | Internal references not translated before stored in columns — breaks resource graph linking (Conditions → Encounters) |
| [#347](https://github.com/fastenhealth/fasten-onprem/issues/347) | Encounters created manually have empty fhir-datagrid rows — same symptom as our Encounter ID-only display |
| [#592](https://github.com/fastenhealth/fasten-onprem/issues/592) | `unknown AdministrativeGender code 'm'` on bulk import — Veradigm sends lowercase gender codes; Fasten rejects them |

## Feature issues worth implementing in the fork

Prioritized for a personal PHR use case.

| Issue | Feature | Priority |
|---|---|---|
| [#631](https://github.com/fastenhealth/fasten-onprem/issues/631) | Edit and delete individual records | High — basic data management |
| [#623](https://github.com/fastenhealth/fasten-onprem/issues/623) | Ollama/LLM integration (MedGemma and others) — offline AI query of your records | High — `fasten-answers-ai` POC exists |
| [#373](https://github.com/fastenhealth/fasten-onprem/issues/373) | Personal journal — private notes attached to health timeline | Medium |
| [#399](https://github.com/fastenhealth/fasten-onprem/issues/399) | Configurable units on dashboard (mmHg, kg vs lbs, etc.) | Medium |
| [#535](https://github.com/fastenhealth/fasten-onprem/issues/535) | Prebuilt dashboards (help wanted upstream) | Medium |
| [#361](https://github.com/fastenhealth/fasten-onprem/issues/361) | PostgreSQL support — SQLite won't scale for a full lifetime PHR | Low (future) |
| [#337](https://github.com/fastenhealth/fasten-onprem/issues/337) | ChatGPT-style offline interface for querying health record | Low (future, see #623) |

## Data source import guides (upstream issues, useful as docs)

| Issue | Guide topic |
|---|---|
| [#479](https://github.com/fastenhealth/fasten-onprem/issues/479) | Apple Health iPhone export → Fasten import |
| [#480](https://github.com/fastenhealth/fasten-onprem/issues/480) | LibreFreeStyle CGM (continuous glucose monitor) |
| [#481](https://github.com/fastenhealth/fasten-onprem/issues/481) | Dexcom G7 CGM |

## Recommended order of attack for the fork

1. **Fix display bugs** — Encounter/Condition rendering with non-US-Core data (#428, #431, #347). Code context already gathered; this is the immediate blocker.
2. **FHIR-Converter normalization** — use as a pre-import step to clean Veradigm's non-standard codings before they hit the DB (#428, #592).
3. **Edit/delete records** (#631) — basic PHR hygiene before adding more data.
4. **LLM integration** (#623) — wire `fasten-answers-ai` POC to Ollama with MedGemma; Ollama is already on the infra roadmap.
5. **PostgreSQL** (#361) — long-term; swap SQLite once record volume or multi-user needs grow.
