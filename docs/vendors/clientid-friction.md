# ClientID Friction

By far the biggest issue in the project has been the obtaining of ClientID to be able to make requests.

Most systems require you to register your app separately with each EHR vendor, and some make you register per health system. Here's how to get around a lot of that:

- Start with sandboxes to build and test without any approvals — use the free SMART Health IT sandbox at launch.smarthealthit.org or Epic's sandbox. These let you experiment immediately.
- For Epic specifically, patient-facing apps that stick to US Core data can use Automatic Client ID Distribution. Register once in their sandbox, meet a few criteria, and they push your client ID to hundreds of Epic organizations automatically — often live in 48 hours.

## Workarounds

Target systems that support standalone patient launch (where the patient logs into their portal and authorizes your app).

Focus on patient-facing SMART on FHIR apps — that's the cleanest way for your open source PHR to pull data from major EHRs like Epic, Cerner/Oracle Health, Athenahealth, and others without needing direct vendor partnerships everywhere.

## App registration values (paste these)

Canonical values to enter when registering the app with a provider (Epic at fhir.epic.com, Veradigm/FollowMyHealth [#53](https://github.com/jwilleke/yourphr/issues/53), CMS Blue Button [#250](https://github.com/jwilleke/yourphr/issues/250), etc.):

| Field | Value |
| --- | --- |
| Redirect / callback URI | `https://relay.nerdsbythehour.com/callback` |
| Terms of Service (secure) URL | `https://yourphr.org/terms.html` |
| Privacy Policy / Additional Disclosure URL | `https://yourphr.org/privacy.html` |

Notes:

- **Redirect URI is the relay, not the app.** `yourphr.nerdsbythehour.com` is internal/LAN behind Authentik and not publicly reachable; the relay (`backend/pkg/relay/relay.go`, `DefaultBaseURL`) is the one public piece. It must stay excluded from Authentik forward-auth (`/callback` is unauthenticated by design).
- **Terms + Privacy** are public HTTPS (GitHub Pages, `gh-pages` branch) and finalized for production review — no placeholder banner. The Privacy Policy discloses the actual data flow (self-hosted, project never receives data, relay holds only a short-lived auth code, tokens encrypted on the user's instance).
- **Client type:** public client (PKCE / S256), read-only patient scopes. No `client_secret` (BYO `client_id` model). An asymmetric `private_key_jwt` path exists in the code but is dormant.
- For the eventual product, the relay can move to `relay.yourphr.org` (stateless — trivial to relocate).
