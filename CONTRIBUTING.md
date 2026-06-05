> This doc is a WIP and will be expanded shortly.
>
> In the meantime, please consider looking at the extensive docs in the [Fasten Docs Repository](https://github.com/fastenhealth/docs/tree/main/technical)

# Tech Stack

YourPHR is made up of a handful of different components. Here's a summary of the technologies & languages used in YourPHR:

## Frontend

- Node.js `v24` — pinned in `frontend/.nvmrc` (run `nvm use` in `frontend/`)
- Yarn `1.22.22` — classic, pinned via `package.json` `packageManager` (`corepack enable`)
- Angular `v20` — `package.json` `engines.node` allows `^20.19 || ^22.12 || >=24` for contributors, but `v24` is the standard

## Backend

- Go `v1.24` — built with `golang:1.24`; `go.mod` requires `go 1.23+`

## Misc

- Docker `v24+`

> Stack modernization (Node 24, Angular 20, Go 1.24, Docker distroless debian12) is tracked in [#12](https://github.com/jwilleke/yourphr/issues/12); the Angular 14 → 20 climb and the Node → 24 flip are complete. The authoritative pinned versions live in `frontend/.nvmrc`, `frontend/package.json`, `go.mod`, and `Dockerfile` — keep this section in sync with those.

# Development Environment Setup

## Nix

If you use nix, you can use the included flake:

1. Make sure you have [Nix](https://nixos.org/download/) installed with flakes enabled, and optionally [direnv](https://direnv.net/) installed.

2. Allow direnv to use the flake in this directory: `direnv allow`

The flake will automatically set up all required dependencies.

When you enter the directory, the environment will automatically activate and you'll see version information for all the tools.

## Mac

Alternatively if you're on a Mac, you can run the following commands to install the necessary software to get setup:

```bash
brew install node
npm install -g @angular/cli@14.1.3
npm install -g yarn

brew install go

brew install docker

# Frontend tests run with ChromeHeadless browser.
brew install --cask google-chrome

# Go specific tools
go install github.com/gzuidhof/tygo@latest
```

# Running Tests

Before making changes to YourPHR, you'll want to run the test suites to ensure that your environment is setup correctly:

```bash
make test

# if you only want to run the frontend tests (Angular), you can run:
make test-frontend

# alternatively, if you only care about backend (Go) tests, you can run:
make test-backend
```

**Note**: Running backend tests may take awhile to complete the first time you run

# Start Development Environment

To run YourPHR from source, you'll need to create 2 separate processes:

- Angular Frontend
- Go Backend

First we'll create a development config file (`config.dev.yaml`)

```yaml
version: 1
web:
  listen:
    port: 9090
    host: 0.0.0.0
    basepath: ''
  src:
    frontend:
      path: ./dist
database:
  location: 'fasten.db'
cache:
  location: ''
log:
  file: '' #absolute or relative paths allowed, eg. web.log
  level: INFO
```

Next we'll start the processes described above:

```bash

# In terminal #1, run the following
make serve-frontend

# In terminal #2, run the following
make serve-backend

```

_Note_: YourPHR can run in 2 modes: sandbox or production (prod). In sandbox mode, it can only communicate with test servers (full of synthetic health data).
By default, the dev environment will run in sandbox mode.

Now you can open a browser to `http://localhost:4200` to see the YourPHR UI.

_Note_: By default in `dev` mode, you view the frontend server and that will proxy API requests to the backend. It is also possible to build the frontend and serve it from the backend server, but this is much slower to make changes to the frontend.

## Credentials

YourPHR stores all user data locally, including your account information. That means on first start you'll need to register a new account.
Once you've done that, you'll want to go to the Sources tab and connect a healthcare provider.

See [Connecting a new Source](https://docs.fastenhealth.com/getting-started/sandbox.html#connecting-a-new-source) for credentials to use.

# Source Code Folder Structure

The YourPHR source code is organized into a handful of important folders, which we'll describe below:

## Frontend

```
├── frontend
│   ├── src
│   │   ├── app
│   │   │   ├── app-routing.module.ts
│   │   │   ├── app.component.html
│   │   │   ├── app.component.scss
│   │   │   ├── app.component.spec.ts
│   │   │   ├── app.component.ts
│   │   │   ├── app.module.ts
│   │   │   ├── components                        # contains shared/partial components reused on multiple pages.
│   │   │   │   ├── components-sidebar
│   │   │   │   ├── footer
│   │   │   │   ├── header
│   │   │   │   ├── list-fallback-resource
│   │   │   │   ├── list-generic-resource         # A component containing a table view for every FHIR resource
│   │   │   │   ├── list-patient
│   │   │   │   ├── resource-list                 # Thin shim which populates template depending on FHIR resource type
│   │   │   │   ├── toast                         # Toast/notification component
│   │   │   │   └── utilities-sidebar
│   │   │   ├── models                            # contains classes for communicating with API's and transfering data between pages.
│   │   │   ├── pages
│   │   │   │   ├── auth-signin                   # Login/Signin page
│   │   │   │   ├── auth-signup                   # Signup page
│   │   │   │   ├── dashboard                     # Dashboard, visible after logging in
│   │   │   │   ├── medical-sources               # Medical Provider connection page
│   │   │   │   ├── patient
│   │   │   │   ├── resource-detail               # Page displaying detailed information about FHIR resource
│   │   │   │   └── source-detail                 # 2 column page displaying FHIR counts, and table listing FHIR resources for selected type
│   │   │   ├── services
│   │   │   │   ├── auth-interceptor.service.ts   # service that looks for 401/403 API responses and triggers Logout
│   │   │   │   ├── is-authenticated-auth-guard.ts    # service that checks if user is logged in
│   │   │   │   ├── fasten-api.service.ts         # api service, used to commnunicate with Go backend (WILL BE REMOVED)
│   │   │   │   ├── fasten-db.service.ts          # db service, used to communicate with CouchDB database
│   │   │   │   ├── lighthouse.service.ts         # api service, used to communicate with auth-gateway (Lighthouse)
│   │   │   │   └── toast.service.ts              # notifications service, used to send notifications
│   │   ├── lib                                   # root directory for libraries
│   │   ├── styles.scss                           # Main sylesheet
```

## Backend

```tree

backend
├── cmd
│   └── fasten
│       └── fasten.go
├── pkg
│   ├── auth
│   ├── config
│   ├── constants.go
│   ├── database                                                        # contains SQLite Database Client
│   │   ├── migrations                                            # contains database migrations
│   ├── event_bus                                                       # contains event bus for pub/sub in UI
│   ├── models                                                          # contains models for application
│   │   ├── database                                                # contains database models, generated using Jennifer and supports search parameter extraction using FHIRPath.js to SQLite columns
│   │   │   ├── README.md
│   │   │   ├── choiceTypePaths.json
│   │   │   ├── fhirpath.min.js
│   │   │   ├── generate.go
│   │   │   ├── interface.go
│   │   │   ├── search-parameters.json
│   │   │   ├── searchParameterExtractor.js
│   │   │   ├── searchParameterExtractor_test.go
│   │   │   └── utils.go
│   ├── version
│   └── web
│       ├── handler                                                    # contains code for API endpoints
│       ├── middleware                                                # contains middleware for API endpoints
│       └── server.go
└── resources
    ├── related_versions.go                                           # contains tools that help extract verion infromation for binaries
    └── related_versions.json
```

## Distribution/Docker

```tree
├── docker-compose.yml                  # docker-compose file which can be used to compile and run "all-in-one" image
├── Dockerfile                          # dockerfile for "all-in-one" image, containing frontend, backend & database
├── docker
│   ├── README.md
│   └── rootfs                          # filesystem configs, used in Dockerfiles to setup s6-overlay service manager
│       └── etc
│           ├── cont-init.d
│           │   ├── 01-timezone
│           └── services.d
│               └── fasten

```

# FAQ

## How do I run individual frontend tests?

From the `frontend` directory, you can run `ng test` with the `--include` argument.

```bash
ng test --include='**/badge.component.spec.ts'
ng test --include='lib/**/*.spec.ts'
```

### How do I change the default encryption key and admin credentials

- FASTEN_ISSUER_JWT_KEY

### Generate JWT for local use

```bash
curl -X POST http://localhost:9090/api/auth/signup -H 'Content-Type: application/json' -d '{"username":"user1","password":"user1"}'

curl -X POST http://localhost:9090/api/auth/signin -H 'Content-Type: application/json' -d '{"username":"user1","password":"user1"}'


curl -H "Authorization: Bearer ${JWT_TOKEN_HERE}" http://localhost:5984/_session

```

# How do I work with Storybook?

[Storybook](https://storybook.js.org) allows development and testing of frontend components in isolation.
When running the Storybook server, each defined story can be viewed and interacted with on it's own allowing for defining and testing of various states and conditions.

In order to run the Storybook server, run the following command and open the url provided:

```bash
make serve-storybook
```

If you only want to verify that all stories build properly (a check that is run on commits and PRs), you can run the following command:

```bash
make build-storybook
```

# Access Encrypted SQLite Database with IntelliJ

- Download the latest `sqlite-jdbc-crypt` jar from <https://github.com/Willena/sqlite-jdbc-crypt/releases>
- Open IntelliJ -> Data Source Properties -> Driver Tab
- Find & Select `Sqlite` -> Right Click -> Duplicate
- Rename to `Sqlite (Encrypted)`
- Find `Driver Files` -> Select `sqlite-jdbc-crypt` jar that you downloaded previously
- Remove `Xerial Sqlite JDBC` jar
- Click `Apply` -> Click `OK`
- Create New Data Source -> Select `Sqlite (Encrypted)` -> Change Connection Type to `Url only`
- Specify the following connection url: `jdbc:sqlite:fasten.db?cipher=sqlcipher&legacy=3&hmac_use=0&kdf_iter=4000&legacy_page_size=1024&key=123456789012345678901234567890`
- Replace `key` with the encryption key specified in your config file (`database.encryption_key`)
- Click `Test Connection` -> Should be successful
- Click `Apply` -> Click `OK`

# Flush SQLite Write-Ahead-Log (WAL) to Database

```sqlite
PRAGMA wal_checkpoint(TRUNCATE);
```

See: <https://sqlite.org/forum/info/fefd56014e2135589ea57825b0e2aa3e2df5daf53b5e41aa6a9d8f0c29d0b8e5>
TODO: check if <https://www.sqlite.org/pragma.html#pragma_wal_checkpoint> can be used to do this automatically.
