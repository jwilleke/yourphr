package version

// VERSION is the app-global semver string (MAJOR.MINOR.PATCH). Bumped by hand at release time —
// a release is a direct annotated tag, no PR or bot (see docs/releasing.md). Choose the bump per
// semver: fix -> PATCH, feature -> MINOR, breaking change -> MAJOR (a higher bump resets the lower
// digits to 0). Between releases the running build reports git-describe (vX.Y.Z-N-g<sha>), not this
// constant.
const VERSION = "1.8.0"
