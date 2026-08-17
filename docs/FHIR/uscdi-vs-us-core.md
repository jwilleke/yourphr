# USCDI vs US Core — the *what* and the *how*

Two layers of the same US interoperability stack, often used interchangeably but distinct:

- __USCDI__ = the government's __list of health data__ that must be exchangeable (the *what*).
- __US Core__ = the HL7 __FHIR R4 specification__ that defines how to represent that data (the *how*).

US Core __implements__ USCDI in FHIR.

## Side by side

| | __USCDI__ | __US Core__ |
|---|---|---|
| Full name | __U.S. Core Data for Interoperability__ | __US Core Implementation Guide__ |
| Maintained by | __ONC__ (policy — Office of the National Coordinator for Health IT) | __HL7__ (the FHIR standards body) |
| What it is | A versioned __list of data classes & elements__ that must be exchangeable (demographics, allergies, medications, problems, lab results, clinical notes, …) | A __FHIR R4 Implementation Guide__ — concrete __profiles__ for that data |
| Layer | __Content / requirement__ — "you must exchange medication data" | __Technical / FHIR__ — "here is `US Core MedicationRequest`: these fields are Must-Support, use these code systems, support these searches" |
| Form | A data-element standard, __FHIR-agnostic__ | FHIR profiles, value sets, `mustSupport` flags, required search parameters |

## The relationship

USCDI says "exchange allergies." US Core defines `US Core AllergyIntolerance` — exactly which fields are required, which terminologies to use, which searches a server must support. So:

- __USCDI__ = the requirements doc.
- __US Core__ = the API blueprint that satisfies it.

Both are versioned and __paired__ — e.g. __US Core 3.1.1 → USCDI v1__; later US Core releases target later USCDI versions (v2/v3/v4…).

ONC's __Certified API criterion §170.315(g)(10)__ — the "Certified APIs" you pick in vendor portals (e.g. athenahealth) — __requires US Core__ (plus SMART App Launch and Bulk Data). That's how a certified endpoint delivers USCDI: as US-Core-profiled FHIR R4.

## Why it matters for YourPHR

- US Core profiles define what a __conformant US provider's FHIR API__ should return — the __Must-Support__ fields. YourPHR's display work to surface exactly those is tracked in the US Core 9.0.0 Must-Support gap issues ([#249](https://github.com/jwilleke/yourphr/issues/249), [#281](https://github.com/jwilleke/yourphr/issues/281)–[#285](https://github.com/jwilleke/yourphr/issues/285)).
- __But__ the near-term real-world target (FollowMyHealth / Veradigm) is __non-US-Core__ — it omits Must-Support fields and deviates from the profiles. So YourPHR adds __fallbacks for missing US Core fields__ rather than assuming strict conformance (see `AGENTS.md`). Prefer a fallback (e.g. `class.code` when `type[]` is absent) over assuming the profile holds.
- The Cures-Act / __Certified__ path (Blue Button, athenahealth "Certified APIs") gives __US-Core-shaped R4__ data; the messier portal exports do not.

## One-liner

USCDI = the government's list of *what* health data must flow; US Core = HL7's FHIR R4 *how*. Choosing "Certified APIs" means getting US-Core-shaped data.

## See also

- [`dstu2-vs-r4.md`](dstu2-vs-r4.md) — the FHIR-version axis (a different distinction)
- [`../vendors/athenahealth.md`](../vendors/athenahealth.md) — where "Certified APIs (USCDI / US Core)" is selected
- `AGENTS.md` — the non-US-Core fallback principle
