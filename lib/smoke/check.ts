// What the smoke check asks of the production page, as a pure function over one response so
// it can be tested against the page production actually served when it was broken.
//
// Responding is not enough. On 2026-09-22 production returned HTTP 500 on every request with
// the layout's <head> intact and a Next.js error digest where the page should have been, while
// every check in CI was green. So this asks for all of: a 200, no error digest anywhere, the
// Tournament's name in its heading, and at least one Player row in the ranking. A page that
// renders its shell and an error fails on at least three of them.

import { PRODUCTION_URL } from "../production";
import { decodeHtmlEntities } from "../schedule/html-entities";

export type SmokeResponse = {
  /** The URL that finally answered, after any redirect. */
  url: string;
  status: number;
  body: string;
};

export type SmokeResult = {
  failures: string[];
  /** The Tournament named in the page's heading, or null if there is none. */
  tournament: string | null;
  /** How many Player rows the ranking rendered. */
  players: number;
};

// How Next.js marks a server error in the HTML it sends. The digest appears in the React
// Server Components payload, JSON-escaped inside a <script>, as `E{\"digest\":\"...\"}`; a
// Suspense boundary that errored is a <template data-dgst>; and the error document's <html>
// carries id="__next_error__". Any one of them means a reader saw an error.
const ERROR_MARKERS: readonly { name: string; pattern: RegExp }[] = [
  { name: "a Next.js error digest", pattern: /\\?"digest\\?"\s*:\s*\\?"([^"\\]*)/ },
  { name: "a Next.js error boundary (data-dgst)", pattern: /\bdata-dgst="([^"]*)"/ },
  { name: "the Next.js error document", pattern: /<html[^>]*\bid="__next_error__"/ },
];

// app/page-view.tsx renders the Tournament as <h1 id="tournament">, and app/ranking.tsx one
// <tr data-player> per scored Player. lib/smoke/check.test.ts renders the real page and runs
// this check over it, so a change to either that would blind this check fails there first.
const TOURNAMENT_HEADING = /<h1\b[^>]*\bid="tournament"[^>]*>([\s\S]*?)<\/h1>/;
const PLAYER_ROW = /<tr\b[^>]*\bdata-player="([^"]+)"/g;

export function checkProductionPage(response: SmokeResponse): SmokeResult {
  const failures: string[] = [];

  const expected = new URL(PRODUCTION_URL);
  const answered = new URL(response.url);
  if (answered.origin !== expected.origin) {
    failures.push(
      `The answer came from ${answered.origin}, not production (${expected.origin}). This check does not vouch for any other deployment.`,
    );
  }

  if (response.status !== 200) {
    failures.push(`HTTP ${response.status}, not 200.`);
  }

  for (const { name, pattern } of ERROR_MARKERS) {
    const match = pattern.exec(response.body);
    if (match) {
      const detail = match[1] ? ` ${match[1]}` : "";
      failures.push(`The page contains ${name}${detail}.`);
    }
  }

  const heading = TOURNAMENT_HEADING.exec(response.body)?.[1];
  const tournament = heading ? decodeHtmlEntities(heading.replace(/<[^>]*>/g, "")).trim() : "";
  if (tournament === "") {
    failures.push(
      'No Tournament is named: the page has no non-empty <h1 id="tournament">. Either nothing upcoming is stored or the page did not render.',
    );
  }

  const players = [...response.body.matchAll(PLAYER_ROW)].length;
  if (players === 0) {
    failures.push("No Player row: the ranking rendered no <tr data-player>.");
  }

  return { failures, tournament: tournament || null, players };
}
