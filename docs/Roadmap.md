# YourPHR — Roadmap

Standalone, community-maintained continuation of [Fasten OnPrem](https://github.com/fastenhealth/fasten-onprem) (GPL v3, attribution retained). Project home: [yourphr.org](https://yourphr.org).

Canonical agent/product brief: [`AGENTS.md`](../AGENTS.md). As-built SMART connect map: [`SMART-flow-map.md`](SMART-flow-map.md). Live priorities: GitHub labels / [`TODO.md`](../TODO.md).

## Mission and branding

- Branding tagline: "Your medical records, immediately and in your hands — for free."
- Branding text: "YourPHR"

__Goal:__ a complete self-hosted PHR with working display for non-US-Core FHIR data, reliable import of what portals actually export (FHIR JSON and C-CDA/XML), and live provider sync via a self-hosted OAuth relay.

> ## Staying focused
>
> Prioritize work that gets patients __more complete records, faster, in their own hands__ — robust patient-portal/FHIR import (incl. non-US-Core), provider sync, and reliable display of real-world data. When weighing a feature, ask: *does this advance immediate patient access (the Cures Act mission)?* If not, defer it. Avoid scope creep and rabbit-holes.

---

## Shipped (foundation)

These are __done in main / released__ — not open planning items. Details in `CHANGELOG.md` and the linked issues.

| Capability | Status | Notes |
|---|---|---|
| Non-US-Core display fallbacks (e.g. Encounter) | ✅ Done | Prefer `class.code` / location when `type[]` absent (Veradigm-oriented) |
| `sort_title` / `sort_date` generation | ✅ Done | Across major clinical resource types |
| `fasten-sources` local stub | ✅ Done | Replaces private upstream package; vendor committed |
| Generic SMART R4 client + store-and-poll __Go__ OAuth relay | ✅ Done | EPIC [#20](https://github.com/jwilleke/yourphr/issues/20) plumbing: client, `backend/cmd/relay`, `backend/pkg/relay`. __Not__ Fasten Lighthouse; __not__ a Cloudflare Worker as the primary design. Map: [`SMART-flow-map.md`](SMART-flow-map.md) |
| Provider catalog connect UI | ✅ Done | Patient picker + admin sandbox; credentials stay server-side |
| C-CDA / CCD XML import out of the box | ✅ Done | v1.15.0+; converter sidecar default-on in compose; multi-arch converter image v1.15.1 |
| SQLCipher fail-closed at startup | ✅ Done | v1.13.4 — encryption cannot silently drop on a dep bump |
| Admin relay config + provenance card | ✅ Done | v1.14.0 — effective callback URL and whether config is actually applied |
| Multi-arch app + relay images (`linux/amd64` + `linux/arm64`) | ✅ Done | v1.16.0 — [#405](https://github.com/jwilleke/yourphr/issues/405) left open only for operator pull-verify |
| Angular 20 / Node 24 foundation | ✅ Done | Foundation epic path complete |
| CI on standard GitHub Actions | ✅ Done | `docker/build-push-action`; release-gated image publish |

__Rejected / superseded design (historical only):__ a __Cloudflare Worker + KV__ as the project OAuth relay. Decided against for an all-Go, self-hosted relay on existing infra. A Worker remains a possible *future* hosting option for a public product relay, not the current architecture. Design notes: [`planning/smart-on-fhir/oauth-gateway.md`](planning/smart-on-fhir/oauth-gateway.md).

---

## Near-term focus (mission P1)

Aligned with open __P1__ labels (GitHub is source of truth; this table is a narrative snapshot).

| Item | Issue | Notes |
|---|---|---|
| __Prove one production SMART provider__ via catalog | [#408](https://github.com/jwilleke/yourphr/issues/408) | Plumbing works; mission needs a real (non-sandbox-only) end-to-end patient path. Related: Veradigm blocked [#53](https://github.com/jwilleke/yourphr/issues/53); Blue Button docs in-repo |
| __Patients add their own records__ | [#313](https://github.com/jwilleke/yourphr/issues/313) | Manual entry when portals cannot sync; related manual-records chain under P2 |
| __Dynamic Client Registration (DCR)__ | [#355](https://github.com/jwilleke/yourphr/issues/355) | Lower friction registering SMART apps |
| __yarn.lock build-chain Dependabot__ | [#416](https://github.com/jwilleke/yourphr/issues/416) | 12 open alerts tracked; no path to patient data in the served image — still needs a decision |

Close-the-loop ops (not always P1-labeled but blocks “it works for users”):

- Confirm arm64 image pull → close [#405](https://github.com/jwilleke/yourphr/issues/405)
- Production instance C-CDA sidecar (or disable converter) where compose defaults assume it
- [#397](https://github.com/jwilleke/yourphr/issues/397) in-review until reporter confirms C-CDA

---

## Open product themes (P2 and related)

Grouped by theme — each row is its own GitHub issue (no multi-step phases inside one issue). Prefer the issue tracker for status.

### Import & display

| Item | Issue |
|---|---|
| SMART dual-timeout / login-wait UX | [#406](https://github.com/jwilleke/yourphr/issues/406) |
| Manual SMART Path B keep-or-drop | [#407](https://github.com/jwilleke/yourphr/issues/407) (holds [#413](https://github.com/jwilleke/yourphr/issues/413)) |
| C-CDA converter choice (Microsoft 5.x vs Metriport fork) | [#403](https://github.com/jwilleke/yourphr/issues/403) |
| Harden re-import dedup | [#252](https://github.com/jwilleke/yourphr/issues/252) |
| Manual records backend / frontend | [#305](https://github.com/jwilleke/yourphr/issues/305), [#307](https://github.com/jwilleke/yourphr/issues/307), epic [#253](https://github.com/jwilleke/yourphr/issues/253) |
| Patient-legible C4BB / CARIN | [#392](https://github.com/jwilleke/yourphr/issues/392), [#393](https://github.com/jwilleke/yourphr/issues/393) |
| Per-profile dashboard widgets | [#244](https://github.com/jwilleke/yourphr/issues/244) |
| Explore export (Save Report / PDF / Email) | [#333](https://github.com/jwilleke/yourphr/issues/333) and children |

### Providers & catalog

| Item | Issue |
|---|---|
| Veradigm / FollowMyHealth E2E | [#53](https://github.com/jwilleke/yourphr/issues/53) (blocked on vendor) |
| VA Clinical Health | [#370](https://github.com/jwilleke/yourphr/issues/370) |
| athenahealth sandbox onboarding | [#339](https://github.com/jwilleke/yourphr/issues/339) |
| Provider logos / brand ids | [#340](https://github.com/jwilleke/yourphr/issues/340) |
| Apple Health institution list as catalog source | [#251](https://github.com/jwilleke/yourphr/issues/251) |

### Platform hygiene

| Item | Issue |
|---|---|
| Retire legacy Lighthouse `connect-gateway.service.ts` | [#409](https://github.com/jwilleke/yourphr/issues/409) |
| Resume-here preserved across `/pstatus` | [#410](https://github.com/jwilleke/yourphr/issues/410) (kit: [mjs-project-template#38](https://github.com/jwilleke/mjs-project-template/issues/38)) |
| Manual SMART golden-path checklist | [#415](https://github.com/jwilleke/yourphr/issues/415) |
| `fasten-sources-stub` fold vs keep | [#288](https://github.com/jwilleke/yourphr/issues/288) |
| Realistic test corpus / golden harness | [#385](https://github.com/jwilleke/yourphr/issues/385) |

Full open list: labels on GitHub or [`TODO.md`](../TODO.md) after `/pstatus`.

---

## Watching — upstream Fasten OnPrem PRs (optional merge)

Large upstream PRs are __candidates__, not committed YourPHR roadmap phases. Mirror insurance and merge approach below.

| Theme | Upstream | Notes |
|---|---|---|
| Typesense search + RAG (Ollama) + `/api/env` | [PR #594](https://github.com/fastenhealth/fasten-onprem/pull/594) | Local “talk to your records”; high value, large surface |
| OIDC / SSO | [PR #613](https://github.com/fastenhealth/fasten-onprem/pull/613) | Native OIDC alongside password; may complement Authentik forward-auth |
| Delegated access | [PR #614](https://github.com/fastenhealth/fasten-onprem/pull/614) | Share edit rights across YourPHR users |
| OCR → Encounter | [PR #609](https://github.com/fastenhealth/fasten-onprem/pull/609) | Webcam/PDF capture; external OCR service |

Related older upstream ideas still potentially useful: edit/delete records, dashboard units, PostgreSQL — track via YourPHR issues when prioritized rather than assuming upstream issue numbers.

---

## Deferred / watching

| Item | Notes |
|---|---|
| Full Fasten* → YourPHR identifier rename | Deferred epic [#278](https://github.com/jwilleke/yourphr/issues/278) — only on hard-fork commitment |
| TEFCA / QHIN | Network-level access; long-term |
| FHIRcast | Real-time EHR event push; long-term |
| Extract FHIR domain as library | [#388](https://github.com/jwilleke/yourphr/issues/388) |
| DB encryption UX (enable/migrate/decrypt) | [#363](https://github.com/jwilleke/yourphr/issues/363) |

---

## Upstream PR merge strategy

> __Insurance:__ an archival mirror of `fastenhealth/fasten-onprem` lives at [`jwilleke/fasten-onprem-mirror`](https://github.com/jwilleke/fasten-onprem-mirror) (private), with the four target PRs pinned as branches __`pr-594` / `pr-613` / `pr-614` / `pr-609`__. So these merges stay possible even if upstream disappears. (A full Fasten→YourPHR rename is parked as deferred epic [#278](https://github.com/jwilleke/yourphr/issues/278) — only on committing to a hard fork, which would close this merge path.)

Large feature PRs (#594, #613, #614, #609) are not merged directly because they would conflict with our `go.mod` replace directive, `vendor/` directory, and generated model changes. Approach:

- When ready for a theme, create a feature branch from `main`
- `git fetch` the mirror branch / upstream PR — resolve conflicts
- Re-run `go mod vendor` and regenerate models if needed
- Merge to `main` once CI passes

---

## Delivery model (unchanged)

- __Images__ publish only on semver release tags `vX.Y.Z` (not on every `main` push).
- Contract: [`deployment/deployment-contract.md`](deployment/deployment-contract.md).
- Cutting a release: [`releasing.md`](releasing.md).
