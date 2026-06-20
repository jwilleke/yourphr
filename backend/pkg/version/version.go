package version

// VERSION is the app-global semver string (MAJOR.MINOR.PATCH), bumped by the release-please
// workflow (see release-please-config.json). The bump is derived from Conventional Commits per
// semver: fix: -> PATCH, feat: -> MINOR, feat!: / BREAKING CHANGE: -> MAJOR (a higher bump resets
// the lower digits to 0). Between releases the running build reports git-describe (vX.Y.Z-N-g<sha>),
// not this constant. The annotation below is how release-please locates the line to update. Do not
// hand-edit (except a deliberate manual release that mirrors what release-please would write).
const VERSION = "1.5.0" // x-release-please-version
