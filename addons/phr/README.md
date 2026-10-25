# @yourphr/phr-addon

yourPHR as an [ngdpbase](https://github.com/jwilleke/ngdpbase) add-on: "Your medical records, immediately and in your hands — for free."

__Early development.__ This version proves the add-on's shape and holds no health records yet: a "My Health Records" page that shows who is signed in, a "Health records" switch in each person's profile (off until they turn it on), and one encrypted PHR vault per person.

## Install on an ngdpbase site

Name it in the site's configuration. ngdpbase installs it pinned to the exact version and checks that its npm provenance comes from this repository:

```json
{
  "ngdpbase.addons.install.phr": {
    "package": "@yourphr/phr-addon",
    "version": "0.0.1",
    "repository": "github.com/jwilleke/yourphr"
  },
  "ngdpbase.addons.phr.enabled": true
}
```

Needs ngdpbase 5.30.1 or later (its import engine takes phr's FHIR and C-CDA readers, and keeps each original in the person's encrypted PHR vault), with its database turned on (`ngdpbase.database.provider: "sqlite"`) and `NGDPBASE_DATABASE_KEY` set and Node 24.15 or later.

## Source

[github.com/jwilleke/yourphr](https://github.com/jwilleke/yourphr), folder `addons/phr/`. Licensed GPL-3.0-only.
