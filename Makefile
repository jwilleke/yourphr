.ONESHELL: # Applies to every targets in the file! .ONESHELL instructs make to invoke a single instance of the shell and provide it with the entire recipe, regardless of how many lines it contains.
.SHELLFLAGS = -ec

########################################################################################################################
# General
########################################################################################################################
.PHONY: test
test: test-server test-frontend

# The TypeScript server's suites. `npm test` is vitest; the harnesses under scripts/ are the
# integration layer CI runs job by job (see .github/workflows/server-ci.yaml).
.PHONY: test-server
test-server:
	npm test

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
# already listens on all interfaces (YOURPHR_WEB_LISTEN_PORT, 9090 in .env.dev.example). Only use on a trusted network.
.PHONY: serve-frontend-lan
serve-frontend-lan: dep-frontend
	cd frontend && ng serve --hmr --live-reload -c dev --host 0.0.0.0 --disable-host-check

.PHONY: serve-frontend-prod
serve-frontend-prod: dep-frontend
	cd frontend && yarn dist -- -c prod

# Reads <YOURPHR_FAST_STORAGE>/.env, then ./.env (cp .env.dev.example .env).
.PHONY: serve-server
serve-server:
	npx tsx src/main.ts

# Import a Go (v2) instance into this one. The same command the image ships (yourphr#654).
.PHONY: migrate
migrate:
	npm run migrate:go -- $(ARGS)


########################################################################################################################
# Relay
########################################################################################################################
# All that is left of the Go stack (yourphr#677): a pure-stdlib store-and-poll OAuth relay, still
# deployed and still published at every release. No dependencies, so no `go mod vendor` step and
# nothing to keep tidy.

.PHONY: test-relay
test-relay:
	go vet ./relay/
	go test ./relay/...

.PHONY: build-relay
build-relay:
	CGO_ENABLED=0 go build -o dist-relay/relay ./relay

########################################################################################################################
# Frontend
########################################################################################################################
# Angular's build cache stores ABSOLUTE module paths, so it goes stale whenever a dependency change
# moves a package between nested and hoisted node_modules (e.g. a `resolutions` pin hoisting
# @babel/runtime out of @angular-devkit/build-angular/node_modules). The build then fails with
# "Can't resolve .../node_modules/.../node_modules/..." LOCALLY while CI — which starts with no
# cache — passes on the same commit. It lives outside node_modules, so reinstalling never clears it.
# See docs/devserver.md.
FRONTEND_CACHE := frontend/.angular/cache
FRONTEND_LOCK_STAMP := frontend/.angular/.yarn-lock-hash

.PHONY: dep-frontend
dep-frontend:
	cd frontend && yarn install --frozen-lockfile --network-timeout 1000000
	@mkdir -p frontend/.angular
	@hash=$$( (shasum -a 256 frontend/yarn.lock 2>/dev/null || sha256sum frontend/yarn.lock) | cut -d' ' -f1 ); \
	prev=$$(cat $(FRONTEND_LOCK_STAMP) 2>/dev/null || true); \
	if [ "$$hash" != "$$prev" ]; then \
		if [ -d $(FRONTEND_CACHE) ]; then \
			echo "yarn.lock changed -> clearing stale $(FRONTEND_CACHE)"; \
			rm -rf $(FRONTEND_CACHE); \
		fi; \
		echo "$$hash" > $(FRONTEND_LOCK_STAMP); \
	fi

# Escape hatch: clear the Angular build cache by hand. Safe and regenerable — it is gitignored and
# rebuilt on the next build. Also worth running periodically; the cache does not self-prune and has
# reached tens of GB on long-lived checkouts.
.PHONY: clean-frontend-cache
clean-frontend-cache:
	rm -rf $(FRONTEND_CACHE) $(FRONTEND_LOCK_STAMP)
	@echo "cleared $(FRONTEND_CACHE)"

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

# End-to-end browser tests (Playwright) against the production-served path: builds the Angular
# app, then Playwright boots the TypeScript server over it and drives a real browser. See e2e/.
#
# This used to boot the GO backend from frontend/e2e/. That suite went with the Go stack
# (yourphr#677); the coverage it had and this one does not is recorded on yourphr#678.
.PHONY: test-e2e
test-e2e: dep-frontend
	cd frontend && yarn build -- -c prod
	# The build lands in dist/web; tell the E2E server so, as CI does (server-ci.yaml). Without it
	# the server looks in its default /tmp/spike-web and refuses to start (exit 78).
	SPIKE_E2E_WEB_DIR=$(CURDIR)/dist/web npm run e2e

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
	# ONE `cd`, chained with &&: .ONESHELL (line 1) runs this whole recipe in a single shell, so a
	# second `cd frontend` would land in frontend/frontend. macOS ships GNU Make 3.81, which
	# predates .ONESHELL and gives each line its own shell — so that mistake passes locally and
	# fails only in CI (#486).
	#
	# The badge check greps for Bootstrap 4 badge classes, which render invisible white-on-white in
	# light mode and look correct in dark mode, so review does not catch them.
	cd frontend && npx ng lint && node scripts/check-badge-classes.mjs
