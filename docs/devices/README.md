# Devices

Everything YourPHR knows about devices: the implants a patient records, and the connected devices (wearables, phone health apps, scales, cuffs, meters) that send readings in. The two are different things. An implant is a record of something inside the body. A connected device is something that writes to the record. Each has its own document.

| Kind | Document | For | State |
|---|---|---|---|
| __Implants__ (stent, pacemaker, artificial joint) | [using-patient-entered-implants.md](using-patient-entered-implants.md) | Patients and operators | Live, including partial dates and the placement and removal rows under Procedures ([#882](https://github.com/jwilleke/yourphr/pull/882)) |
| __Connected devices__ (Apple Health or Health Connect apps, scales, cuffs, meters) | [connected-devices.md](connected-devices.md): __the developer contract__ (setup code, claim, keys, refresh rotation, refusals, what pauses or ends a grant) | Developers of device apps | Setup, keys, refresh and pausing are live. The upload arrives with [#314](https://github.com/jwilleke/yourphr/issues/314) PR 1 |

External equipment a patient reads by hand, such as a hearing aid, a CGM or a CPAP machine, is neither of these. Its readings go in through __Add record → A measurement__, with the equipment named under __Measured with__.

## Where the work stands

- [#314](https://github.com/jwilleke/yourphr/issues/314): wearable and device data as patient-generated health data. Its prerequisites, epic [#810](https://github.com/jwilleke/yourphr/issues/810), are done. It is waiting on the contributor's first PR.
- Decided but not yet built: [#860](https://github.com/jwilleke/yourphr/issues/860) and [#862](https://github.com/jwilleke/yourphr/issues/862). A grant will last until the patient revokes it, and scopes will take SMART on FHIR v2 names (`patient/Observation.c`). The pause after 90 days without an upload ([#861](https://github.com/jwilleke/yourphr/issues/861)) is the default now, and takes full effect once grants outlast their 30-day term ([#860](https://github.com/jwilleke/yourphr/issues/860)). The developer contract describes what is live today and is updated when these land.

## Design and decisions

- [Device write scope inside a patient consent grant](../planning/2026-09-30-device-write-scope-and-consent-grant.md) ([#807](https://github.com/jwilleke/yourphr/issues/807)): the design behind connected devices. Part of it was superseded on 2026-10-02.
- [Auth framework: RFC 8628 device authorization](../planning/authorization-framework.md#rfc-8628-device-authorization): how a device will be approved, and where its scope names come from.
- [Review of the #314 contribution](../planning/2026-09-30-yourphr-314-device-review.md): the outside Apple Health branch, and the decisions made on it (`HealthManager`, `phd-samples.db`, intake adapters).
- [Agent access policy](../agent-access-policy.md): what any delegated credential, a device's included, may do.

## Related

- [Surfacing gate for low-value series](../your-phr-dashboard/classification-and-display-architecture.md#surfacing-gate-for-low-value-series-activity--tracker-data): how stale or sparse tracker data from a provider export is kept from misleading.
- [US Core support](../us-core/README.md): the Implantable Device profile in the support table.
