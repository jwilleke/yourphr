# Phase 1 spec — Condition classifier & Patient Profile

Implementation-ready spec for Phase 1 of the [classification & display architecture](./classification-and-display-architecture.md). Delivers the highest-value fix: stop polluting "Current Medical Concerns" with non-clinical data, and give the social/administrative items an honest home ("Patient Profile").

## Goal

The dashboard's "Current Medical Concerns" must list __only active clinical problems__. FollowMyHealth's "Personal Health Conditions" (employment, education, marital status, lifestyle status, household, etc.) — which it exports as `Condition` — must be routed to a separate __Patient Profile__ section, not shown as health problems and not discarded.

## Scope

__In:__

- A backend, pure, stateless __Condition classifier__ (Layer 1) that synthesizes a standard `Condition.category` and a display tier from explicit record signals, non-destructively.
- A `GET /api/secure/conditions/classified` endpoint, mirroring `GET /api/secure/medications/reconciled`.
- Frontend: dashboard consumes the endpoint, fixes "Current Medical Concerns", adds a "Patient Profile" section.

__Out (later phases):__

- Resolving the *named* practitioner for "who said this" — Phase 2 (Phase 1 sets only the `selfReported` flag).
- Encounter/reference resolution (the `Encounter/<patient>_<id>` quirk) — Phase 2.
- Detail-card legibility rebuild — Phase 3.
- Remodeling Profile items into US Core Observations (smoking status, etc.) — Phase 4.
- A dedicated Patient Profile route/page — Phase 1 ships it as a dashboard section only.

## Why classify, not reconcile

Unlike medications, conditions are __not deduped or merged__ (locked decision: report facts as the source provided them). So this is a *classifier*, not a reconciler — one output row per input `Condition`, never collapsed. Hence the package name `condition` / function `Classify` (not `Reconcile`) and the route `/conditions/classified` (not `/reconciled`).

## Backend

### New package: `backend/pkg/condition`

Mirrors `backend/pkg/medication` exactly (pure, stateless, no DB/HTTP — unit-testable in isolation; the "no guessing" principle is load-bearing).

```
backend/pkg/condition/
  classify.go        # types + Classify()
  fhir.go            # raw-JSON parsing helpers (mirror medication/fhir.go)
  classify_test.go   # table tests over a synthetic FMH-shaped fixture
  testdata/
    fmh_conditions.json   # synthetic (fake values), one example per tier + edge cases
```

### Types (`classify.go`)

```go
const (
    CategoryProblem      = "problem-list-item" // health problem
    CategorySDOH         = "sdoh"              // social / personal profile
    CategoryHealthConcern = "health-concern"

    TierClinician    = "clinician"     // coded diagnosis, clinician-attributed
    TierSelfReported = "self-reported" // real condition, patient-asserted
    TierProfile      = "profile"       // personal/social/administrative

    // State drives where a health problem displays. Derived from clinicalStatus (primary) with
    // abatement as a date source + non-conformance safety net. Mirrors medication's State constants.
    StateActive    = "Active"    // active / recurrence / relapse
    StateRemission = "Remission" // shown under Current, badged "in remission since <abatement>"
    StateResolved  = "Resolved"  // resolved / inactive (or abated, no status) -> Past Health Problems
    StateUnknown   = "Unknown"   // status absent/unrecognized -> shown, never assumed
    StateRuledOut  = "RuledOut"  // verificationStatus=refuted -> not a current problem
)

// InputResource is one stored Condition row: authoritative type/id/source from the DB row
// plus the full FHIR JSON body.
type InputResource struct {
    SourceResourceType string          // always "Condition"
    SourceResourceID   string
    SourceID           string          // Fasten source/connection id (for deep-link + Phase 2 provenance floor)
    Raw                json.RawMessage
}

// Coding is a fidelity passthrough of an original FHIR coding.
type Coding struct {
    System  string `json:"system,omitempty"`
    Code    string `json:"code,omitempty"`
    Display string `json:"display,omitempty"`
}

// ClassifiedCondition is one Condition with its synthesized category + tier and the display fields
// Phase 1 needs. The raw record is never mutated; this is a read-time view-model.
type ClassifiedCondition struct {
    SourceResourceType string   `json:"sourceResourceType"`
    SourceResourceID   string   `json:"sourceResourceId"`
    SourceID           string   `json:"sourceId"`
    Title              string   `json:"title"`            // plain-language name
    Category           string   `json:"category"`         // synthesized FHIR category
    Tier               string   `json:"tier"`
    State              string   `json:"state"`            // Active / Remission / Resolved / Unknown / RuledOut
    SelfReported       bool     `json:"selfReported"`
    ClinicalStatus     string   `json:"clinicalStatus,omitempty"`     // raw, for fidelity
    VerificationStatus string   `json:"verificationStatus,omitempty"` // raw, for fidelity / certainty badge
    Onset              string   `json:"onset,omitempty"`          // FHIR date string, unparsed
    Recorded           string   `json:"recorded,omitempty"`
    Abated             string   `json:"abated,omitempty"`
    Note               string   `json:"note,omitempty"`           // joined note[].text
    StandardCodings    []Coding `json:"standardCodings,omitempty"`// ICD/SNOMED/LOINC only
}

// Classify returns one ClassifiedCondition per input, in input order (no dedup, no merge).
// `now` is reserved for future date-based rules; Phase 1 does not need it but keep the signature
// symmetric with medication.Reconcile.
func Classify(resources []InputResource, now time.Time) []ClassifiedCondition
```

The endpoint returns a __flat list__; the frontend (Layer 2) groups it into sections. This keeps Layer 1 emitting standard-FHIR-categorized resources and Layer 2 owning the section mapping, per the architecture.

### Signal extraction (per Condition)

All read from `Raw`; absent → zero value (never assumed):

| Signal | Source | Notes |
|---|---|---|
| `clinicalStatusCode` | `clinicalStatus.coding[].code` | e.g. active / resolved / inactive / remission / recurrence / relapse |
| `verificationStatusCode` | `verificationStatus.coding[].code` | confirmed / provisional / differential / unconfirmed / refuted / entered-in-error |
| `hasStandardCode` | any `code.coding[].system` matching `icd`, `snomed`, `loinc` | the clinician-grade tell |
| `hasAnyCoding` | `len(code.coding) > 0` | |
| `vendorTell` | parse `identifier[].value` of form `…:<Type>,<n>` → `<Type>` | `HealthCondition` / `PersonalHealthConsideration` / "" |
| `assertedByPatient` | `asserter.reference` (else `recorder.reference`) starts with `Patient/` | self-reported tell |
| `hasClinicianRecorder` | `asserter`/`recorder` reference starts with `Practitioner/` | |
| `onset` / `recorded` / `abated` | `onsetDateTime` (or `onsetPeriod.start`), `recordedDate`, `abatement[x]` | kept as raw date strings |
| `note` | join `note[].text` | |
| `title` | first non-empty of `code.text`, `code.coding[].display` | else `"Unknown condition"` |
| `standardCodings` | `code.coding[]` filtered to standard systems | for the detail card / clinicians |

### Classification rules (with safety bias)

Evaluate in order; first match wins:

1. `hasStandardCode || vendorTell == "HealthCondition"` → __Tier=clinician, Category=problem-list-item__
2. `hasAnyCoding && assertedByPatient` → __Tier=self-reported, Category=problem-list-item, SelfReported=true__
3. `!hasAnyCoding && vendorTell == "PersonalHealthConsideration" && !hasClinicianRecorder` → __Tier=profile, Category=sdoh__
4. __Default (safety bias): Tier=clinician, Category=problem-list-item__ — when signals are ambiguous, treat as a health item rather than bury a possible diagnosis under Profile.

Rationale: rules 1–3 require *agreeing* explicit signals to demote something to Profile; anything that doesn't clearly meet the Profile bar (rule 3) falls through to rule 4 and stays a health item.

### State & verification-status determination

`clinicalStatus` is the __primary__ driver of `State`; `abatement[x]` is a date source (the date of resolution *or* remission, per FHIR con-4) and a safety-net override only for non-conformant data. `verificationStatus` gates first.

```
# 1. verificationStatus gate (before clinical status)
if verificationStatusCode == "entered-in-error":   # FHIR con-5: the record says this was a mistake
    DROP — do not emit this Condition at all
if verificationStatusCode == "refuted":            # diagnosis considered and ruled out
    State = StateRuledOut                           # not a current problem

# 2. otherwise, State from clinicalStatus (abatement breaks the non-conformant active+abated conflict)
switch clinicalStatusCode:
    "active", "recurrence", "relapse":  State = StateActive
    "remission":                        State = StateRemission
    "resolved", "inactive":             State = StateResolved
    default (absent/unrecognized):      State = (abated != "" ? StateResolved : StateUnknown)
```

Notes:

- `entered-in-error` is the one case we __omit__ — honoring the record's own statement that it was a mistake (consistent with "report facts as given": the recorded fact *is* "this was an error").
- `remission` stays a tracked current problem (improved/absent __but not fully resolved__; relapse/recurrence is the return from it) — display under Current with an "in remission since `<abatement>`" badge.
- `abatement` present + `active` status is a FHIR con-4 violation (non-conformant export). The switch keeps `clinicalStatus` authoritative; only when status is absent does `abatement` imply `Resolved`. (If FMH is observed to emit active+abated in practice, revisit toward treating abatement as the end-signal.)
- `provisional` / `unconfirmed` / `differential` do not change `State`; they are carried in `VerificationStatus` for a diagnostic-uncertainty badge on the card (display concern, Phase 3).

### Handler (`backend/pkg/web/handler/conditions.go`)

Direct analogue of `GetMedicationsReconciled`:

```go
func GetConditionsClassified(c *gin.Context) {
    logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
    databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

    resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SourceResourceType: "Condition"})
    if err != nil { /* 500, same shape as medications handler */ }

    inputs := make([]condition.InputResource, 0, len(resources))
    for i := range resources {
        inputs = append(inputs, condition.InputResource{
            SourceResourceType: resources[i].SourceResourceType,
            SourceResourceID:   resources[i].SourceResourceID,
            SourceID:           resources[i].SourceID.String(), // SourceID is a uuid.UUID on OriginBase
            Raw:                json.RawMessage(resources[i].ResourceRaw),
        })
    }

    classified := condition.Classify(inputs, time.Now().UTC())
    c.JSON(http.StatusOK, gin.H{"success": true, "data": classified})
}
```

### Route (`backend/pkg/web/server.go`)

Add beside the medications route (line ~181):

```go
secure.GET("/conditions/classified", handler.GetConditionsClassified)
```

## Frontend

### Model (`frontend/src/app/models/fasten/classified-condition.ts`)

TS mirror of `ClassifiedCondition` (same field names; `category`/`tier` as string unions).

### API client (`fasten-api.service.ts`)

Mirror `getMedicationsReconciled`:

```ts
getConditionsClassified(): Observable<ClassifiedCondition[]> {
  return this._httpClient.get<any>(`${this.getBasePath()}/api/secure/conditions/classified`)
    .pipe(map(r => r.data as ClassifiedCondition[]));
}
```

### Dashboard component (`pages/dashboard/dashboard.component.ts` + `.html`)

Replace the current `getResources('Condition')` + `isActiveCondition`/`toActiveConcern` block with `getConditionsClassified()`, then group (Layer 2):

```ts
this.fastenApi.getConditionsClassified().subscribe({
  next: (rows) => {
    this.concernsLoading = false
    const problems = rows.filter(r => r.category === 'problem-list-item')
    // Current = Active + Remission (remission is tracked, not past); Unknown also shown here, badged.
    this.currentConcerns = problems.filter(r => r.state === 'Active' || r.state === 'Remission' || r.state === 'Unknown')
    this.pastProblems    = problems.filter(r => r.state === 'Resolved')
    // RuledOut is intentionally excluded from both; entered-in-error never reaches the client.
    this.profileItems    = rows.filter(r => r.category === 'sdoh' || r.category === 'health-concern')
  },
  error: () => { this.concernsLoading = false }
})
```

- __Current Medical Concerns__ section: render `currentConcerns`. Badges: __"Self-reported"__ when `row.selfReported`; __"in remission since `<abated>`"__ when `state === 'Remission'`; __"status not specified"__ when `state === 'Unknown'`. Each row deep-links to the resource detail (`/explore/<sourceId>/resource/<sourceResourceId>`).
- __Past Health Problems (N)__ section (new): a collapsed expander directly under Current, rendering `pastProblems` with each item's date range (onset → abated), e.g. "Fractured wrist — 2015, resolved 2015". Honors "resolved ≠ deleted" without cluttering the at-a-glance view. Hide if `pastProblems.length === 0`.
- __Patient Profile__ section (new, additive — same markup pattern as Concerns): render `profileItems`, collapsed by default or below the tiles. Hide if `profileItems.length === 0`.
- The existing tile grid is unchanged in Phase 1 (the "Health Issues" tile keeps routing to medical-history).

`isActiveCondition` / `toActiveConcern` / the `ActiveConcern` interface and the raw `getResources('Condition')` call are removed from the component (logic now lives in the backend classifier).

### Label decision (small, optional)

"Current Medical Concerns" over-promises (it implies prioritization). Recommend renaming to __"Current Health Problems"__ or __"Active Health Problems"__. Default: keep the current label to minimize churn unless you want the rename now.

## Testing without PHI

`backend/pkg/condition/testdata/fmh_conditions.json` — a __synthetic__ Bundle/array with fake values, one entry per case. `classify_test.go` is a table test asserting `{tier, category, state, selfReported}` per entry (and that `entered-in-error` is omitted):

| Fixture case | Signals | Expect `{tier, category, state}` |
|---|---|---|
| clinician active | ICD‑10 code, `HealthCondition` tell, `clinicalStatus=active`, Practitioner recorder | clinician / problem-list-item / __Active__ |
| clinician resolved | ICD code, `clinicalStatus=resolved`, `abatementDateTime` set | clinician / problem-list-item / __Resolved__ |
| remission | ICD code, `clinicalStatus=remission`, `abatementDateTime` set | clinician / problem-list-item / __Remission__ |
| abated, no status | ICD code, no `clinicalStatus`, `abatementDateTime` set | clinician / problem-list-item / __Resolved__ (abatement implies ended) |
| active + abated (con-4 violation) | ICD code, `clinicalStatus=active`, `abatementDateTime` set | clinician / problem-list-item / __Active__ (clinicalStatus authoritative) |
| self-reported | vendor-internal coding + display, `asserter=Patient`, no standard code, `clinicalStatus=active` | self-reported / problem-list-item / Active / selfReported=true |
| profile | text-only, `PersonalHealthConsideration` tell, no recorder | profile / sdoh / (state per status) |
| ambiguous (safety bias) | text-only, __no__ vendor tell, no recorder | clinician / problem-list-item (defaulted, not buried) |
| unknown status | active-family absent, no abatement, ICD code | clinician / problem-list-item / __Unknown__ |
| refuted | ICD code, `verificationStatus=refuted` | (any tier) / __RuledOut__ |
| entered-in-error | ICD code, `verificationStatus=entered-in-error` | __omitted from output entirely__ |

Backend tests use real FHIR JSON fixtures per the project convention; keep all fixture values synthetic. The real export stays in `private/phi/` for manual validation.

## Acceptance criteria

- `GET /api/secure/conditions/classified` returns one row per stored `Condition` __except `entered-in-error`__ (omitted), each with `category`, `tier`, `state`, `selfReported`, `title`, dates, `note`, `standardCodings`, raw `clinicalStatus`/`verificationStatus`.
- "Current Medical Concerns" shows only `category == problem-list-item` with `state ∈ {Active, Remission, Unknown}`; no social/administrative items appear; remission/unknown carry their badges.
- "Past Health Problems" lists `state == Resolved` problems with their date range; nothing is silently dropped (only `entered-in-error` is intentionally omitted, and `refuted` is held out of Current).
- Profile items appear under "Patient Profile".
- Self-reported problems carry a visible badge.
- `make test-backend` (classifier table tests) and `make test-frontend` green; Storybook builds.

## Files touched

- __New:__ `backend/pkg/condition/{classify.go,fhir.go,classify_test.go}`, `backend/pkg/condition/testdata/fmh_conditions.json`, `backend/pkg/web/handler/conditions.go`, `frontend/src/app/models/fasten/classified-condition.ts`
- __Edit:__ `backend/pkg/web/server.go` (route), `frontend/src/app/services/fasten-api.service.ts` (client), `frontend/src/app/pages/dashboard/dashboard.component.{ts,html}` (consume + group + Patient Profile section), dashboard component spec.
