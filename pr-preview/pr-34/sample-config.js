// Build flag set by .github/workflows/pages.yml (never edit by hand).
// false (default): practice data is read next to the page (demo/sampleN/): main site, local dev.
// true: only in PR previews that were deployed WITHOUT docs/demo (keeps the published site under
// the 1 GB Pages limit); there the data is read from the main site's /demo/ instead.
export const DEMO_FROM_SITE_ROOT=true;
// Build value set by .github/workflows/pages.yml (never edit by hand).
// '' (default): the slices (.dcm) are read like the other practice data files (next to the page, or the site root in a preview).
// Otherwise the published site carries no .dcm and the slices are read from this repository's main branch instead:
// https://raw.githubusercontent.com/<account>/<repo>/main/docs/ (docs/sample-sets.js accepts only that shape and ignores anything else).
export const SLICE_ROOT='https://raw.githubusercontent.com/naomitsu-ozawa/virtual-rodent-la-trial/main/docs/';
