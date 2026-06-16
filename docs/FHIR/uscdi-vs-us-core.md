# USCDI vs US Core — the *what* and the *how*

Two layers of the same US interoperability stack, often used interchangeably but distinct:

- **USCDI** = the government's **list of health data** that must be exchangeable (the *what*).
- **US Core** = the HL7 **FHIR R4 specification** that defines how to represent that data (the *how*).

US Core **implements** USCDI in FHIR.

## Side by side

| | **USCDI** | **US Core** |
|---|---|---|
| Full name | **U.S. Core Data for Interoperability** | **US Core Implementation Guide** |
| Maintained by | **ONC** (policy — Office of the National Coordinator for Health IT) | **HL7** (the FHIR standards body) |
| What it is | A versioned **list of data classes & elements** that must be exchangeable (demographics, allergies, medications, problems, lab results, clinical notes, …) | A **FHIR R4 Implementation Guide** — concrete **profiles** for that data |
| Layer | **Content / requirement** — "you must exchange medication data" | **Technical / FHIR** — "here is `US Core MedicationRequest`: these fields are Must-Support, use these code systems, support these searches" |
| Form | A data-element standard, **FHIR-agnostic** | FHIR profiles, value sets, `mustSupport` flags, required search parameters |

## The relationship

USCDI says "exchange allergies." US Core defines `US Core AllergyIntolerance` — exactly which fields are required, which terminologies to use, which searches a server must support. So:

- **USCDI** = the requirements doc.
- **US Core** = the API blueprint that satisfies it.

Both are versioned and **paired** — e.g. **US Core 3.1.1 → USCDI v1**; later US Core releases target later USCDI versions (v2/v3/v4…).

ONC's **Certified API criterion §170.315(g)(10)** — the "Certified APIs" you pick in vendor portals (e.g. athenahealth) — **requires US Core** (plus SMART App Launch and Bulk Data). That's how a certified endpoint delivers USCDI: as US-Core-profiled FHIR R4.

## Why it matters for YourPHR

- US Core profiles define what a **conformant US provider's FHIR API** should return — the **Must-Support** fields. YourPHR's display work to surface exactly those is tracked in the US Core 9.0.0 Must-Support gap issues ([#249](https://github.com/jwilleke/yourphr/issues/249), [#281](https://github.com/jwilleke/yourphr/issues/281)–[#285](https://github.com/jwilleke/yourphr/issues/285)).
- **But** the near-term real-world target (FollowMyHealth / Veradigm) is **non-US-Core** — it omits Must-Support fields and deviates from the profiles. So YourPHR adds **fallbacks for missing US Core fields** rather than assuming strict conformance (see `CLAUDE.md`). Prefer a fallback (e.g. `class.code` when `type[]` is absent) over assuming the profile holds.
- The Cures-Act / **Certified** path (Blue Button, athenahealth "Certified APIs") gives **US-Core-shaped R4** data; the messier portal exports do not.

## One-liner

USCDI = the government's list of *what* health data must flow; US Core = HL7's FHIR R4 *how*. Choosing "Certified APIs" means getting US-Core-shaped data.

## See also

- [`dstu2-vs-r4.md`](dstu2-vs-r4.md) — the FHIR-version axis (a different distinction)
- [`../vendors/athenahealth.md`](../vendors/athenahealth.md) — where "Certified APIs (USCDI / US Core)" is selected
- `CLAUDE.md` — the non-US-Core fallback principle
