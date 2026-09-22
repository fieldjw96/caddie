// The smoke check against the two pages that matter: what production actually served while it
// was broken, and what the real page component renders when it works. If app/page-view.tsx or
// app/ranking.tsx stop rendering the markers this check reads, the second half fails here,
// before the check goes blind in production.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageView } from "../../app/page-view";
import type { PageData } from "../page/data";
import { PLAYERS, TRUSTED_COURSE, TRUSTED_TRAITS } from "../page/fixtures";
import { PRODUCTION_URL } from "../production";
import { checkProductionPage } from "./check";

// Saved verbatim from https://caddie-rosy.vercel.app/ on 2026-09-22, which answered every
// request that day with this: HTTP 500, the layout's <head>, and digest 4035168820.
const BROKEN = readFileSync(
  join(process.cwd(), "lib/smoke/fixtures/production-500-2026-09-22.html"),
  "utf8",
);

const DATA: PageData = {
  tournament: {
    name: "Arnold Palmer Invitational",
    season: 2027,
    startDate: "2027-03-04",
    endDate: "2027-03-07",
    courseName: "Bay Hill Club and Lodge",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2027_PGA_Tour&oldid=1",
  },
  course: TRUSTED_COURSE,
  traits: TRUSTED_TRAITS,
  players: PLAYERS,
  coverage: { seasons: [2026], leaderboardEvents: ["Masters Tournament"], standingsEvents: [] },
};

const page = (data: PageData | null) =>
  `<!DOCTYPE html><html lang="en"><body>${renderToString(<PageView data={data} />)}</body></html>`;

const answer = (body: string, status = 200, url = PRODUCTION_URL) => ({ url, status, body });

describe("checkProductionPage", () => {
  it("fails the page production served on 2026-09-22, on every count", () => {
    const result = checkProductionPage(answer(BROKEN, 500));
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "HTTP 500, not 200.",
        "The page contains a Next.js error digest 4035168820.",
        "The page contains the Next.js error document.",
        expect.stringMatching(/^No Tournament is named/),
        expect.stringMatching(/^No Player row/),
      ]),
    );
    expect(result.tournament).toBeNull();
    expect(result.players).toBe(0);
  });

  it("still fails that page if it had somehow come back 200", () => {
    const result = checkProductionPage(answer(BROKEN, 200));
    expect(result.failures).not.toContain("HTTP 200, not 200.");
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the real page with a Tournament and a ranking", () => {
    const result = checkProductionPage(answer(page(DATA)));
    expect(result.failures).toEqual([]);
    expect(result.tournament).toBe("Arnold Palmer Invitational");
    expect(result.players).toBeGreaterThanOrEqual(1);
  });

  it("fails a 500 even when the body is a good page", () => {
    expect(checkProductionPage(answer(page(DATA), 500)).failures).toEqual([
      "HTTP 500, not 200.",
    ]);
  });

  it("fails the page that renders with no Tournament stored: a shell is not an answer", () => {
    const result = checkProductionPage(answer(page(null)));
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatch(/^No Tournament is named/);
    expect(result.failures[1]).toMatch(/^No Player row/);
  });

  it("fails a Tournament with nobody ranked", () => {
    const result = checkProductionPage(answer(page({ ...DATA, players: [] })));
    expect(result.tournament).toBe("Arnold Palmer Invitational");
    expect(result.failures).toEqual([expect.stringMatching(/^No Player row/)]);
  });

  it("fails a good page with an errored Suspense boundary in it", () => {
    const body = page(DATA).replace(
      "</body>",
      '<template data-dgst="1234567890"></template></body>',
    );
    expect(checkProductionPage(answer(body)).failures).toEqual([
      "The page contains a Next.js error boundary (data-dgst) 1234567890.",
    ]);
  });

  it("does not vouch for a preview deployment or a dev server, however good the page", () => {
    for (const url of [
      "https://caddie-git-ticket-36-fieldjw96.vercel.app/",
      "http://localhost:3000/",
    ]) {
      const result = checkProductionPage(answer(page(DATA), 200, url));
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatch(/not production/);
    }
  });
});
