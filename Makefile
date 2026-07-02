.ONESHELL: # Applies to every targets in the file! .ONESHELL instructs make to invoke a single instance of the shell and provide it with the entire recipe, regardless of how many lines it contains.
.SHELLFLAGS = -ec

########################################################################################################################
# General
########################################################################################################################
.PHONY: test
test: test-backend test-frontend

.PHONY: build-storybook
build-storybook: dep-frontend
	cd frontend && npx ng run fastenhealth:build-storybook

.PHONY: serve-storybook
serve-storybook: dep-frontend
	cd frontend && npx ng run fastenhealth:storybook

.PHONY: serve-frontend
serve-frontend: dep-frontend
	cd frontend && ng serve --hmr --live-reload -c dev

# Same as serve-frontend but bound to all interfaces so other devices on the LAN (a phone, another
# machine) can reach the dev app at http://<this-host-ip>:4200. --disable-host-check accepts the LAN
# IP as the Host header (dev-only; turns off the dev server's DNS-rebinding protection). The backend
# already listens on all interfaces (:9090). Only use on a trusted network.
.PHONY: serve-frontend-lan
serve-frontend-lan: dep-frontend
	cd frontend && ng serve --hmr --live-reload -c dev --host 0.0.0.0 --disable-host-check

.PHONY: serve-frontend-prod
serve-frontend-prod: dep-frontend
	cd frontend && yarn dist -- -c prod

.PHONY: serve-backend
serve-backend: dep-backend
	go run backend/cmd/fasten/fasten.go start --config ./config.dev.yaml --debug

.PHONY: migrate
migrate: dep-backend
	go run backend/cmd/fasten/fasten.go migrate --config ./config.dev.yaml --debug

.PHONY: serve-docker-prod
serve-docker-prod:
	docker compose -f docker-compose-prod.yml up -d

.PHONY: serve-docker
serve-docker:
	docker compose up -d


########################################################################################################################
# Backend
########################################################################################################################

.PHONY: clean-backend
clean-backend:
	go clean

.PHONY: dep-backend
dep-backend:
	go mod tidy && go mod vendor
	cd scripts && go generate ./...


.PHONY: test-backend
test-backend: dep-backend
	go vet ./...
	go test -timeout 25m -v ./...

.PHONY: test-backend-coverage
# -timeout 25m: the encrypted-sqlite + FHIR-ingestion suites run near Go's 10m default per-package
# limit on slow CI runners, causing flaky timeouts (#150). Coverage instrumentation makes it slower.
test-backend-coverage: dep-backend
	go test -timeout 25m -coverprofile=backend-coverage.txt -covermode=atomic -v ./...

.PHONY: generate-backend
generate-backend:
	go generate ./...
	tygo generate

# Regenerate the embedded offline RxTerms crosswalk (#387) from the latest NLM release. Downloads the
# release, unzips, and rewrites backend/pkg/rxterms/data/rxterms_crosswalk.tsv.gz — commit the result.
# Override the release with: make gen-rxterms-crosswalk RXTERMS_RELEASE=RxTerms<YYYYMM>
RXTERMS_RELEASE ?= RxTerms202606
.PHONY: gen-rxterms-crosswalk
gen-rxterms-crosswalk:
	tmp=$$(mktemp -d) && \
	curl -sSL -o $$tmp/rxterms.zip "https://data.lhncbc.nlm.nih.gov/public/rxterms/release/$(RXTERMS_RELEASE).zip" && \
	unzip -o $$tmp/rxterms.zip -d $$tmp >/dev/null && \
	go run backend/pkg/rxterms/gen_crosswalk.go $$tmp/$(RXTERMS_RELEASE).txt && \
	rm -rf $$tmp

########################################################################################################################
# Frontend
########################################################################################################################
.PHONY: dep-frontend
dep-frontend:
	cd frontend && yarn install --frozen-lockfile --network-timeout 1000000

.PHONY: build-frontend-sandbox
build-frontend-sandbox: dep-frontend
	cd frontend && yarn build -- -c sandbox

.PHONY: build-frontend-prod
build-frontend-prod: dep-frontend
	cd frontend && yarn build -- -c prod

.PHONY: build-frontend-desktop-sandbox
build-frontend-desktop-sandbox: dep-frontend
	cd frontend && yarn build -- -c desktop_sandbox

.PHONY: build-frontend-desktop-prod
build-frontend-desktop-prod: dep-frontend
	cd frontend && yarn build -- -c desktop_prod

.PHONY: build-frontend-offline-sandbox
build-frontend-offline-sandbox: dep-frontend
	cd frontend && yarn build -- -c offline_sandbox

.PHONY: test-frontend
# reduce logging, disable angular-cli analytics for ci environment
test-frontend: dep-frontend
	cd frontend && npx ng test --watch=false

# End-to-end browser tests (Playwright) against the production-served path: builds the
# frontend, then Playwright boots the Go backend (config.e2e.yaml, fresh ./db/fasten-e2e.db,
# :9191) serving ./dist and drives a real browser. See frontend/e2e/.
.PHONY: test-e2e
test-e2e: dep-frontend
	cd frontend && yarn run build -- --configuration sandbox && yarn run e2e

.PHONY: test-frontend-coverage
# reduce logging, disable angular-cli analytics for ci environment
test-frontend-coverage: dep-frontend
	cd frontend && npx ng test --watch=false --code-coverage

.PHONY: test-frontend-coverage-ci
# reduce logging, disable angular-cli analytics for ci environment
test-frontend-coverage-ci: dep-frontend
	cd frontend && npx ng test --watch=false --code-coverage --browsers=ChromeHeadlessCI

.PHONY: lint-frontend
lint-frontend: dep-frontend
	cd frontend && npx ng lint
