package version

// VERSION is the app-global version string. It is bumped automatically by the
// manually-triggered release-please workflow (see release-please-config.json),
// which bumps the patch on every release (minor/major via a Release-As: footer);
// the annotation below is how release-please locates the line to update. Do not hand-edit.
const VERSION = "1.2.0" // x-release-please-version
