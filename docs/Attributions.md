# Third-party attributions

__In-app:__ `/attributions` (authenticated)  
__Registry (source of truth for UI copy):__ `frontend/src/app/models/fasten/attributions.ts`  
__Related issues:__ [#428](https://github.com/jwilleke/yourphr/issues/428) (CMS Blue Button notice), future partner notices.

## Approach

YourPHR will integrate multiple third-party APIs and data sources (CMS Blue Button first; others over time). Each may require a __non-endorsement__ or attribution statement that must not be buried only in product Terms.

We use __one attributions catalog__ for all partners, not a one-off hardcode per vendor forever.

__Related:__ connection-level PP/ToS + pre-connect messaging for *all* medical sources is modular — see [`connection-policy.md`](connection-policy.md).

| Layer | Purpose |
|---|---|
| __Canonical registry__ | Structured list of notices (`id`, title, full text, optional URL, `contexts` when to show) |
| __Attributions page__ | Full list — every notice readable in one place (`/attributions`) |
| __Contextual display__ | Same text (or a short pointer) on the journey CMS/demo requires — e.g. Medicare connect |
| __Footer / Account Profile__ | Discoverable link to the full page |

### What this is not

- __Not__ product Privacy Policy / Terms of Service (those live at yourphr.org and Account Profile consent — [#427](https://github.com/jwilleke/yourphr/issues/427)).
- __Not__ FHIR `Consent` resources (clinical/privacy directives — see [build.fhir.org Consent](https://build.fhir.org/consent.html#6.2)).
- __Not__ operator contact (Admin Instance card).

### Contexts (`contexts` field)

| Context | Meaning |
|---|---|
| `attributions-page` | Always listed on `/attributions` |
| `medicare-connect` | Show near patient-facing Medicare / Blue Button connect |
| `footer` | Optional short link or line in app footer (full text stays on the page) |

Add new partners by appending an entry to the registry and choosing contexts. Prefer __not__ dumping every full notice into the global footer.

## Current entries

### CMS Blue Button APIs (#428)

Required by [Blue Button API Terms of Service — Attribution](https://bluebutton.cms.gov/terms/):

> This product uses the Blue Button APIs but is not endorsed or certified by the Centers for Medicare & Medicaid Services or the U.S. Department of Health and Human Services.

- __Contexts:__ `attributions-page`, `medicare-connect`
- __Patient-facing source label__ (separate from this notice): multi-source picker shows __Medicare__ for Blue Button-class production sources ([#429](https://github.com/jwilleke/yourphr/issues/429)). Sandbox/admin may still say “Blue Button”. Architecture remains Blue Button / CARIN / FHIR.

## Adding a new attribution

1. Add an object to `ATTRIBUTIONS` in `frontend/src/app/models/fasten/attributions.ts`.
2. Set `contexts` appropriately (always include `attributions-page`).
3. If a connect/demo path must show it, wire that context in the relevant page (same pattern as Medicare on Sources).
4. Mention the partner in this doc’s “Current entries” section.

## Demo checklist (CMS)

- [ ] Open `/attributions` — CMS sentence visible  
- [ ] Open `/sources` with a Medicare-class provider — CMS notice visible near connect  
- [ ] Footer (or Account Profile) links to Attributions  
