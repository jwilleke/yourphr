# Getting off Go — both instances

> __Complete (checked 2026-10-14).__ Both instances run the TypeScript stack (v3.21.0); [#494](https://github.com/jwilleke/yourphr/issues/494), [#584](https://github.com/jwilleke/yourphr/issues/584) and [#654](https://github.com/jwilleke/yourphr/issues/654) are closed, and the only Go left is the separate `relay/` service. Still open: [#641](https://github.com/jwilleke/yourphr/issues/641). Kept because its rules — prove the swap and not only the migration, household before demo, the stop rule — are being reused for the next move, YourPHR as an ngdpbase add-on ([#920](https://github.com/jwilleke/yourphr/issues/920)).
>
> __Status: written 2026-08-25, after the migration rehearsal.__ Two Go instances run today. This is the order they move in, what blocks each, and what has actually been proven rather than assumed.

The goal is [#543](https://github.com/jwilleke/yourphr/issues/543): the TypeScript stack replaces yourPHR, Go goes silent, and at a major version `main` carries no Go at all. Parity is done — [#591](https://github.com/jwilleke/yourphr/issues/591) has no open children.

## The two instances are not alike

| | `yourphr` | `demo-yourphr` |
|---|---|---|
| Who it serves | the household — __one family's real records__ | the public, and CMS Blue Button reviewers ([#433](https://github.com/jwilleke/yourphr/issues/433)) |
| Data | real PHI, 20,068 records | __synthetic only__, seeded, resettable |
| Reached via | Kubernetes Ingress, behind Authentik | __Cloudflare tunnel__, deliberately unauthenticated |
| The swap is | one line in `ingress.yaml` | the Service the tunnel already names — a Flux commit, no Cloudflare change |
| Downtime | __acceptable__ (operator, 2026-08-25) | visible to strangers; a reviewer may open it any time |
| Blocked by | nothing | __demo mode does not exist in TypeScript__ |

The instinct is to move the demo first because its data is worthless. That is wrong here, and the reason is the last row.

## What is proven, and what is not

__Proven (2026-08-24 rehearsal, recorded in [`../deployment/cutover-runbook.md`](../deployment/cutover-runbook.md)):__ the migration. Against the real 111 MB `fasten.db` from that morning's backup, into scratch — 20,068 records, 3 accounts, 8 sources, __exit 0__, `53/53 (user, resource type) id lists agree`. __87 seconds.__

__Not proven:__ the swap. Nobody has pointed a hostname at the TypeScript stack and watched it serve. That is the half that must not be met for the first time during a maintenance window — and on `yourphr`, where downtime is acceptable, it costs almost nothing to find out.

__Known before starting, neither a failure:__ six sources have no refresh token and will ask to be reconnected at first expiry ([#584](https://github.com/jwilleke/yourphr/issues/584)); three backup-schedule settings do not carry and are set again by hand.

## Order

### 1. `yourphr` first — because downtime is acceptable

Downtime being cheap is exactly what makes this the safe place to learn. Rollback is reverting one line, and Go stays warm on its own PVC, untouched by the migration.

1. Prepare __before__ freezing: the migration tool is not in the image, so the node needs the source checked out and installed. The rehearsal cost ten minutes discovering this.
2. Freeze Go, copy its database, migrate into the TypeScript PVC, verify. Runbook steps 1–4.
3. Swap the Ingress backend to `yourphr-ts`. Confirm `/api/version` answers the TypeScript version through the real host.
4. Sign in as the operator and one household member. __Check the access log shows today__ — on the new stack a read that cannot be logged fails rather than completing silently, so an empty log is a stop signal, not a cosmetic gap.
5. Keep Go warm one release cycle. Then the stop rule ([#543](https://github.com/jwilleke/yourphr/issues/543)): delete the Go Deployment or roll back for good. Not both, not later.

### 2. `demo-yourphr` second — because it needs work first

__It cannot be swapped today.__ The TypeScript stack has no demo mode: `instanceForUser()` returns `'demo.admin.session': false` with the comment *"this stack has no demo admin"*. The live demo publishes `demo.enabled: true` and `demo.admin.enabled: true`, so a straight swap turns two working one-click entrances into none — and the Angular app is shared, so the buttons break rather than disappear politely.

What has to exist first ([#494](https://github.com/jwilleke/yourphr/issues/494)):

- __the shared demo account__ and its one-click sign-in
- __the read-only demo admin__ — sees every admin screen, changes nothing, cannot see the user list. The policy half is already done: that is `[admin-read]` in `yourphr.config.env-keys`' sibling role config ([#620](https://github.com/jwilleke/yourphr/issues/620)), which is a configuration edit rather than code
- __reset to a baked-in baseline__, so a visitor cannot leave the demo in a state the next visitor inherits

Then the swap is a Flux commit changing what sits behind the Service the tunnel already names. No Cloudflare dashboard step; that mapping was done once, 2026-07-31.

### 3. Everyone else

Neither instance is the product. That gap is now closed: the migration ships in the image ([#654](https://github.com/jwilleke/yourphr/issues/654)) and [`../deployment/upgrading-v2-to-v3.md`](../deployment/upgrading-v2-to-v3.md) is followable end to end without a source checkout ([#655](https://github.com/jwilleke/yourphr/issues/655)). What is still outstanding is a ready-made compose file and example manifests ([#641](https://github.com/jwilleke/yourphr/issues/641)); the page carries the `docker run` equivalent meanwhile. Note the numbering this section predates: Go is v2 and the TypeScript stack is v3, because Go had already reached 2.10.3.

## The stop rule applies to both

From the strategy document: __two stacks serving production for more than one release cycle means pick one.__ Applied per instance, from that instance's swap. A demo left on Go after the household moves is a frozen stack facing the open internet, which is its own argument.
