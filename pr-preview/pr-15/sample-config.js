// Build flag set by .github/workflows/pages.yml (never edit by hand).
// false (default): practice data is read next to the page (demo/sampleN/): main site, local dev.
// true: only in PR previews that were deployed WITHOUT docs/demo (keeps the published site under
// the 1 GB Pages limit); there the data is read from the main site's /demo/ instead.
export const DEMO_FROM_SITE_ROOT=true;
