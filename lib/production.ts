// Where the site is served to readers, and the only place in this repo that says so.
// scripts/smoke.ts checks this address and no other, and lib/smoke/workflows.test.ts fails if
// the address appears in any other file, so a move means changing exactly one line.

export const PRODUCTION_URL = "https://caddie-rosy.vercel.app/";
