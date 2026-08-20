#########################################################################################################
# Frontend Build
#########################################################################################################
# MULTI-ARCH BUILD NOTE (#405).
# Upstream Fasten built arm64 on https://depot.dev/ (paid) because GitHub had no ARM runners and
# QEMU emulation of this image is punishing — a full Angular build plus a CGO/SQLCipher static Go
# link. GitHub now offers native arm64 runners, free for public repos, so .github/workflows/
# docker-jwilleke.yaml builds each arch on its OWN native runner and merges the two digests into
# one manifest list. No depot.dev, no emulation.
#
# Consequence for anyone editing this file: every stage here is assumed to run NATIVELY for the
# target arch — that is why the final stage can `RUN` the built binary as a smoke test. Do not add
# a `--platform=$BUILDPLATFORM` cross-compile shortcut without re-checking the CGO/SQLCipher link
# (see the go.mod jgiannuzzi/go-sqlite3 replace, #401); Dockerfile.relay cross-compiles only
# because it is CGO_ENABLED=0 pure Go.
# Background on the emulation cost: https://github.com/fastenhealth/fasten-onprem/issues/43

FROM node:24 as frontend-build
ARG YOURPHR_ENV=sandbox
WORKDIR /usr/src/fastenhealth/frontend
COPY frontend/package.json frontend/yarn.lock ./

RUN yarn install --frozen-lockfile
COPY frontend/ ./
RUN --mount=type=cache,target=/tmp/lock,sharing=locked \
    yarn run build -- --configuration ${YOURPHR_ENV} --output-path=../dist

#########################################################################################################
# Backend Build
#########################################################################################################
FROM golang:1.26.6 as backend-build

WORKDIR /go/src/github.com/fastenhealth/fasten-onprem
COPY . .

# Build only — do NOT run the test suite here. Tests (go vet + go test) run in CI
# (development.yaml / ci.yaml); running them again during the image build added up to
# 20 min to every deploy for no extra safety. BuildKit cache mounts keep the module
# cache + compiled objects warm across builds so only changed packages recompile.
RUN --mount=type=cache,target=/tmp/lock,sharing=locked \
    --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod vendor \
    && go build -mod=vendor -ldflags "-extldflags=-static" -tags "static" -o /go/bin/fasten ./backend/cmd/fasten/

# create folder structure
RUN mkdir -p /opt/fasten/db \
  && mkdir -p /opt/fasten/web \
  && mkdir -p /opt/fasten/config

#########################################################################################################
# Distribution Build
#########################################################################################################
FROM gcr.io/distroless/static-debian12

EXPOSE 8080
WORKDIR /opt/fasten/
COPY --from=backend-build  /opt/fasten/ /opt/fasten/
COPY --from=frontend-build /usr/src/fastenhealth/dist /opt/fasten/web
COPY --from=backend-build /go/bin/fasten /opt/fasten/fasten
COPY LICENSE.md /opt/fasten/LICENSE.md
# Demo seed database (#505). Built by scripts/build-demo-seed.sh into seed/ before the image build;
# the directory is committed with only a README so this COPY also succeeds in a local build that has
# not produced one. Inert unless a deployment sets YOURPHR_BOOTSTRAP_SEED_RESTORE — a normal install
# never touches it. Contains synthetic records and NO admin account: the image is public, so a baked
# admin credential would be a published one, identical on every deployment.
COPY seed/ /opt/fasten/seed/
RUN ["/opt/fasten/fasten", "--help"]
# No --config: defaults are embedded in the binary, an instance overrides them in
# <data>/config/app-custom-config.json, and the environment overrides that (yourphr#470).
CMD ["/opt/fasten/fasten", "start"]
