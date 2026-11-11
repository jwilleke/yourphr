# Consumer device samples

This note used to propose tables in the app database and a full-account device token. Both were rejected.

The decision is on [#314](https://github.com/jwilleke/yourphr/issues/314) and in the [review](../2026-09-30-yourphr-314-device-review.md): raw samples in `phd-samples.db`, a daily or spot Observation in the record store, and a connected-device grant for the upload. The developer contract, including `POST /api/secure/health/samples` and `GET /api/secure/health/sync-state`, is [connected-devices.md](../../devices/connected-devices.md).
