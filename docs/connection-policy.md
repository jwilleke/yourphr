# Medical source connection policy

__Code:__ `backend/pkg/models/connection_policy.go`  
__Catalog fields:__ `consent_policy`, `pre_connect_profile` on `ProviderCatalogEntry`  
__Patient projection:__ `ConnectableProvider` (`requires_user_consent`, `pre_connect_profile`, `medicare_class`)

## Default (all medical-record connects)

| Step | Default |
|---|---|
| PP/ToS active opt-in | __Required__ before any catalog connect |
| Pre-connect informed modal | __Yes__ — generic medical-records copy |
| Disconnect / Remove data / combined | All sources (#437) |
| Attributions page | Always available |

Medicare / CMS Blue Button-class sources (URL/display auto-detect) additionally:

- Pre-connect profile __medicare__ (claims-oriented copy)
- Forced patient label __Medicare__ on production pickers
- CMS non-endorsement attribution (`docs/Attributions.md`)

## Modular overrides (when a provider cannot fit)

Set on the catalog entry (admin API create/update):

| Field | Values | Meaning |
|---|---|---|
| `consent_policy` | `required` (default), `skip` | Skip product PP/ToS gate only if truly necessary |
| `pre_connect_profile` | `auto` (default), `generic`, `medicare`, `none` | Which modal copy / skip modal |

Empty values resolve as __required__ + __auto__.

### Examples

```json
{ "consent_policy": "required", "pre_connect_profile": "auto" }
```

```json
{ "consent_policy": "skip", "pre_connect_profile": "none" }
```

Rare escape hatch — document why in operator notes.

## Frontend flow

1. If `requires_user_consent` and user has not granted PP/ToS → block (Account Profile).  
2. If resolved `pre_connect_profile` ≠ `none` → show modular modal (Cancel / Continue).  
3. Continue → OAuth (popup in same click).  
4. Connected Sources → __Disconnect__ (tokens only), __Remove data__ (records only), or __Disconnect & remove data__ (full teardown).

## Where UI lives

| Concern | Route |
|---|---|
| Connect + __Connected Sources__ (per-provider cards, disconnect) | __`/sources`__ (hosted SPA often under `/web/sources`) |
| PP/ToS consent, data-controls help, delete account | __`/account-profile`__ |

Account Profile does __not__ list one card per connected source — that stays on Sources.
