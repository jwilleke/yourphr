# eClinicalWorks (healow)

Public facts on getting a patient-facing SMART on FHIR app to production with eClinicalWorks. Patient apps go through __healow__, not fhir.eclinicalworks.com. Researched 2026-10-14 from eCW/healow documentation, plus read-only discovery checks. Not yet registered: [#933](https://github.com/jwilleke/yourphr/issues/933). Comparison: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Model | __Self-service.__ Developer Terms: "The Developer will be automatically approved for use of the healow API… so long as the Developer follows… this Agreement and… the ONC Criteria" |
| Reach | One client ID is live at every practice with Patient APIs enabled. The published bundle lists about 17,000 practice bases on `https://fhir4.healow.com/fhir/r4/{practice_code}`, with one shared auth server |
| On paper | Authenticity verification "within ten business days", then production enablement "within five business days"; a "security review" checklist item. A secondary source says it works at once |
| Client types | Public (PKCE S256) or confidential (secret, or `private_key_jwt`, which is preferred) |
| Refresh tokens | __Not issued to public apps.__ Confidential: refresh token valid 90 days, single-use (store the new one each time) |
| Access token | 3600 s (example) |
| Rate limit | 250 calls/min per practice base, counting authorize and token |
| CORS | Not supported (fine server-side) |
| Terms to note | § 5.3(x) restricts sharing "access or access codes" without permission; relevant to a self-hosted model |

## Registration

healow Developer Portal (connect4.healow.com): sign up, accept the Developer Terms, verify email, then a 5-step Patient App registration (app info, scopes, auth config, consent screen).

## Live discovery (2026-10-14)

Practice bases advertise authorize/token at `https://oauthserver.eclinicalworks.com/oauth/oauth2/`, `client-public`, `client-confidential-asymmetric`, `permission-offline`, v1 and v2, PKCE S256, and `private_key_jwt` among token auth methods.

## Unknowns

Whether patient-access use is free; whether the 10+5 business-day steps happen in practice; what the security review involves; whether the 90-day refresh window resets on rotation; when "app is not activated for the selected practice" applies to patient apps.

## Sources

- <https://connect4.healow.com/apps/jsp/dev/r4/gettingStarted.jsp>
- <https://connect4.healow.com/apps/jsp/dev/r4/apiDocumentation.jsp>
- Endpoint bundle: <https://connect4.healow.com/apps/api/v1/fhir/activated_clinical_endpoints>
- <https://fhir.eclinicalworks.com/ecwopendev/>
