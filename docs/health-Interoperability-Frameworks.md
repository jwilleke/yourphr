# Health interoperability frameworks — how records move between organizations

A plain-language map of the networks and frameworks that move health records between hospitals, clinics, insurers and patient apps in the US, and how each one could help yourPHR. Written 2026-10-15. The terms are in the [glossary](./Glossary.md#health-information-networks). TEFCA has its own page: [`TEFCA.md`](./TEFCA.md).

## Two ways a patient app gets records

1. __Directly from each hospital's system__ (FHIR + SMART App Launch). The app registers with each EHR vendor and the patient signs in at each hospital's portal. This is how yourPHR connects today. Registration ranges from self-service (Oracle) to per-organization activation (Epic): see [`vendors/registration-comparison.md`](./vendors/registration-comparison.md).
2. __Through a network.__ Hospitals join a network once, and the network finds and fetches a person's records from everywhere they've been seen. The app joins the network, not each vendor.

The standards for the data itself (FHIR, US Core, USCDI) are settled and required by law. What varies is the __business process__ around them: who registers, who approves, and who pays. The frameworks below are attempts to standardize that part.

## The frameworks

| | What it is | Who's behind it | Started | Patient apps |
|---|---|---|---|---|
| __TEFCA__ | The government's national network of networks, required by the Cures Act. Hubs are __QHINs__ | ASTP/ONC sets policy; The Sequoia Project runs it | Live since late 2023 | __Yes:__ Individual Access Services (IAS), with identity proofing. See [`TEFCA.md`](./TEFCA.md) |
| __Carequality__ | A rulebook letting existing networks query each other (for example Epic's Care Everywhere, athenahealth, eClinicalWorks) | The Sequoia Project | 2014 | Allowed in principle; in practice built for clinician-to-clinician exchange |
| __CommonWell Health Alliance__ | A vendor-founded network with a record locator; now also a TEFCA QHIN | Founded by EHR vendors (Cerner/Oracle, athenahealth, Greenway and others) | 2013 | Through its TEFCA role |
| __eHealth Exchange__ | One of the oldest national networks, used heavily by federal agencies (VA, DoD, SSA); now a TEFCA QHIN | Non-profit | Began as a federal project (the NHIN) in the late 2000s | Through TEFCA |
| __CMS Aligned Networks__ | A voluntary CMS program: networks that meet CMS's criteria are listed, and patients use apps of their choice through them | CMS, with pledges from around 60 companies; Oracle Health and Redox are among those aligned | Announced July 2025; general availability July 2026 | __Yes:__ "commercial or non-commercial", "no special status"; IAL2 identity proofing and AAL2 sign-in; FHIR US Core required since 2026-07-04 |
| __Payer APIs__ (CMS Patient Access rule) | Insurers must offer patients a FHIR API with claims and clinical data | CMS (rule CMS-9115-F, 2020) | 2021 | __Yes__, one registration per insurer. Medicare's version is Blue Button, which yourPHR already uses |

## Why records often arrive as C-CDA

The networks were built between about 2006 and 2015, before FHIR existed, to exchange whole __documents__: a summary of a patient's care, called a C-CDA. Hospitals' systems generate one on request, and the networks carry it. FHIR, which exchanges individual records such as just the lab results, is being added. CMS has required FHIR from aligned networks since July 2026, and TEFCA has a FHIR roadmap. Until then, a network answer is often a C-CDA, which yourPHR can already import and convert.

## Fees

- __Patients:__ federal rules don't allow charging a patient for electronic access to their own records.
- __Apps and organizations joining a network:__ set by each network or QHIN, and generally not published. Third-party reviews describe negotiated contracts.
- __Identity proofing__ usually costs money per check.
- __CMS's framework__ doesn't mention fees.

For a free, open-source app, this is the biggest unknown.

## Where yourPHR could fit

| Route | Effort | Reach | Status |
|---|---|---|---|
| Manual upload of a portal download (zip, C-CDA) | Built | Any hospital with a portal | Works today |
| Direct SMART, self-service vendors (Oracle, NextGen, Greenway) | Registration and testing | Thousands of practices | Issues open ([#926](https://github.com/jwilleke/yourphr/issues/926), [#932](https://github.com/jwilleke/yourphr/issues/932), [#934](https://github.com/jwilleke/yourphr/issues/934)) |
| Direct SMART, Epic, using dynamic client registration | Code exists ([#894](https://github.com/jwilleke/yourphr/issues/894)); a new Epic app | All Epic organizations, with no per-organization activation (to be confirmed) | [#924](https://github.com/jwilleke/yourphr/issues/924) |
| __TEFCA IAS__ or a __CMS Aligned Network__ | A contract with a QHIN or network, identity proofing, possibly fees | Every participating organization, plus a record locator that answers "where are my records?" | To investigate: [`TEFCA.md`](./TEFCA.md) |
| Payer APIs | One registration per insurer | Claims from everyone who billed, which also shows where records are | Medicare done; others not started |

## The open question for all network routes

TEFCA and CMS's framework both picture an app as __one accountable organization__. yourPHR is __many self-hosted installs__, each holding one family's records. The likely shape is one yourPHR registration, run centrally, that delivers records to each patient's own install, the way the relay already passes sign-in codes without seeing records. Whether a network will accept that, and on what terms, is the first thing to ask.

## Sources

- CMS Interoperability Framework: <https://www.cms.gov/initiatives/health-technology-ecosystem/overview/interoperability-framework>
- CMS press release, 2025-07-30: <https://www.cms.gov/newsroom/press-releases/white-house-tech-leaders-commit-create-patient-centric-healthcare-ecosystem>
- CMS-Aligned Network Specification (editor's draft): <https://cms-ns.bwell.com/>
- Oracle Health, CMS Aligned Network status: <https://www.prnewswire.com/news-releases/oracle-health-demonstrates-interoperability-leadership-achieves-cms-aligned-network-status-302746757.html>
- Redox, CMS Aligned Network: <https://redoxengine.com/blog/redox-joins-cms-health-tech-ecosystem-as-an-aligned-network/>
- The Sequoia Project, TEFCA RCE: <https://rce.sequoiaproject.org>
- ASTP/ONC, the history and growth of TEFCA: <https://healthit.gov/resources/data-liquidity-affordability-and-access-the-history-growth-of-tefca/>
- CMS Patient Access API FAQ: <https://cms.gov/priorities/key-initiatives/burden-reduction/interoperability/frequently-asked-questions/patient-access-api>
