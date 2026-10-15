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

- __Redirect URI is the relay, not the app.__ `yourphr.nerdsbythehour.com` is internal/LAN behind Authentik and not publicly reachable; the relay (`backend/pkg/relay/relay.go`, `DefaultBaseURL`) is the one public piece. It must stay excluded from Authentik forward-auth (`/callback` is unauthenticated by design).
- __Terms + Privacy__ are public HTTPS (GitHub Pages, `gh-pages` branch) and finalized for production review — no placeholder banner. The Privacy Policy discloses the actual data flow (self-hosted, project never receives data, relay holds only a short-lived auth code, tokens encrypted on the user's instance).
- __Client type:__ public client (PKCE / S256), read-only patient scopes. No `client_secret` (BYO `client_id` model). An asymmetric `private_key_jwt` path exists in the code but is dormant.
- For the eventual product, the relay can move to `relay.yourphr.org` (stateless — trivial to relocate).

## The layers: what is FHIR, and what isn't

Most of the friction above isn't in FHIR itself. It's in the layers around it:

| Layer | What it is | Standard |
|---|---|---|
| __FHIR__ | The __format and API__ for health records: what a Condition or a lab result looks like, and how to ask for one | HL7 FHIR (R4) |
| __SMART App Launch__ | How an app gets __permission__ to read those records: the patient signs in at their provider, approves, and the app receives tokens | HL7 SMART App Launch, built on OAuth 2.0 |
| __Client authentication__ | How the app __proves who it is__ when it collects those tokens | OAuth 2.0 / OpenID Connect, adopted by SMART |
| __Registration and enablement__ | Getting a client ID, and getting it accepted at each organization | Each vendor's own process, constrained by federal rules (below) |
| __FollowMyHealth__ | A company's __product__: Veradigm's patient portal and sign-in server | Not a standard |

### How an app proves who it is

When yourPHR trades the patient's approval for tokens, the vendor's server asks which app is really asking. There are three answers:

1. __Public client__ (PKCE only, nothing to prove). It works, but several vendors then __issue no refresh token__, so the patient has to sign in again about every hour. That's eClinicalWorks' rule, and Epic's for standalone patient apps.
2. __Client secret__ (a shared password). It works, but it's a password, and Epic wants a separate one per organization for an auto-distributed app: 522 × 2 for app 62263.
3. __`private_key_jwt`__ (a signature; SMART calls it *asymmetric client authentication*). yourPHR keeps a __private key__ and publishes the matching __public key__ at one URL (a JWK Set URL). Each token request carries a short-lived assertion signed with the private key, and the vendor checks it against the public key. Nothing secret is ever sent, and one key-set URL can serve every organization.

### Why the key would be held by the relay

The vendor registration is the project's (one client ID), but yourPHR runs on many self-hosted installs, and the project's private key can't be handed to every install. So the key stays in __one place the project controls__, the relay. An install asks the relay to *sign* its token request, then sends the request to the vendor itself. That keeps the relay's privacy property: __it never sees tokens or records__, only an assertion to sign. The trade-off is that every token refresh needs the relay to be available. A dormant `private_key_jwt` path already exists in the code.

- __eClinicalWorks__ requires it, because public apps get no refresh token ([#933](https://github.com/jwilleke/yourphr/issues/933)).
- __Epic__ probably needs it at scale: one JWK Set URL instead of a secret per organization ([#924](https://github.com/jwilleke/yourphr/issues/924)).

### FollowMyHealth: one sign-in server behind three vendors

FollowMyHealth began as Allscripts' patient portal. Its sign-in server (`muauthentication.followmyhealth.com`) is still shared by the companies that came out of Allscripts:

- __Veradigm:__ yourPHR has been stuck at `unauthorized_client` there for months ([#53](https://github.com/jwilleke/yourphr/issues/53)).
- __Altera__ (Sunrise, Paragon, TouchWorks): its hospitals' patient login goes through it.
- __Practice Fusion__ (owned by Veradigm): about 56% of its practices sign in through it.

Whatever blocks yourPHR there, most likely a registration that was never enabled, blocks all three until it's fixed.

## How this fits the 21st Century Cures Act

The Cures Act (2016) told HHS to make patient access to electronic health information real. ASTP/ONC's rules that implement it apply to each layer above. This is a plain-language summary, not legal advice; check the current eCFR text before citing a paragraph, because the rules have been amended several times (HTI-1 and later).

### The three rules that matter

1. __The certified patient-access API, 45 CFR 170.315(g)(10).__ A certified EHR must offer a standardized API for patients:
   - FHIR R4 with US Core / USCDI data;
   - SMART App Launch authorization for both public and confidential apps;
   - refresh tokens, so an app that can keep a credential stays connected without the patient signing in again (for months, not hours).

   This is why every vendor in [`registration-comparison.md`](./registration-comparison.md) speaks the same FHIR and SMART: the law requires it.
2. __API Conditions of Certification, 45 CFR 170.404.__ What the EHR developer must do around that API:
   - __publish__ its documentation, terms and every customer's endpoint (service base URL);
   - __charge no fee__ for patient access;
   - verify an app developer's authenticity only by an objective process that's the same for all developers;
   - __register and enable the app for production use within five business days__ of that verification.

   It may not judge whether a patient's chosen app is worthwhile.
3. __Information blocking, 45 CFR part 171.__ EHR developers, health care providers and health information networks may not engage in practices likely to interfere with access to, exchange of, or use of electronic health information, unless an exception applies (privacy, security, infeasibility, and others). HHS-OIG can fine developers; ASTP/ONC can take away certification.

### Where each friction sits

| Friction | What the rules say | Our reading |
|---|---|---|
| __Public apps get no refresh token__ (eClinicalWorks, Epic) | (g)(10) requires refresh tokens for apps that can keep a credential, not necessarily for public apps | Likely allowed. That's why `private_key_jwt` matters: it makes yourPHR an app that can keep a credential. |
| __Per-organization activation__ with a credential each (Epic, 522 × 2) | § 170.404: the developer must register and enable apps within five business days of verification. Hospitals are separately covered by information blocking | Worth raising: a process that leaves an "automatically distributed" patient app at 0 organizations after weeks. Facts in [#863](https://github.com/jwilleke/yourphr/issues/863) and [#924](https://github.com/jwilleke/yourphr/issues/924). |
| __Silent pause; locked API list; unanswered support__ (Epic) | Practices likely to interfere with access | Evidence of delay and non-response, dated. |
| __`unauthorized_client` for months__ (FollowMyHealth: Veradigm, Altera, Practice Fusion) | § 170.404: enable within five business days of verification | The clearest case *if* the registration was verified and then never enabled. Re-test on the current stack and document the timeline first. |
| __Per-hospital vetting and MEDITECH-run registration__ | Hospitals may refuse only under an exception (for example, a specific security risk); developers may not substitute their own review of the app's value | Worth asking MEDITECH which exception applies to a patient-chosen, read-only app. |
| __Approval gate with no timeline__ (athenahealth) | Objective authenticity verification, then five business days | Ask athenahealth for the status and record the date before anything else. |
| __Self-service, auto-provisioned__ (Oracle, NextGen, Greenway) | — | What the rules intend: a patient's app works wherever the patient has records. |

### Where to raise it

ASTP/ONC recommends contacting the developer first and keeping the record. Then:

- the __Health IT Feedback and Inquiry Portal__ (it has a section for API complaints): <https://inquiry.healthit.gov/>
- the __Information Blocking Portal__, via <https://www.healthit.gov/topic/information-blocking>
- the __HHS-OIG Hotline__: <https://oig.hhs.gov/fraud/report-fraud/>

The project's dated evidence for each vendor is kept privately until a filing decision is made.
