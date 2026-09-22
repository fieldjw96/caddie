// The page as a reader without JavaScript receives it: the server's HTML, nothing hydrated.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PageData } from "../lib/page/data";
import {
  PLAYERS,
  TRUSTED_COURSE,
  TRUSTED_TRAITS,
  UNTRUSTED_COURSE,
  UNTRUSTED_TRAITS,
} from "../lib/page/fixtures";
import { LICENCES, PageView } from "./page-view";

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
  coverage: {
    seasons: [2026],
    leaderboardEvents: ["Masters Tournament"],
    standingsEvents: ["Genesis Invitational"],
  },
};

const UNTRUSTED: PageData = { ...DATA, course: UNTRUSTED_COURSE, traits: UNTRUSTED_TRAITS };

const html = (data: PageData | null) => renderToString(<PageView data={data} />);

/** The HTML's text, roughly as a reader sees it. */
const text = (data: PageData | null) =>
  html(data)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&rsquo;|’/g, "'")
    .replace(/<!-- -->/g, "")
    .replace(/\s+/g, " ");

describe("PageView, rendered on the server", () => {
  it("states the Tournament, its dates and its Course", () => {
    const t = text(DATA);
    expect(t).toContain("Arnold Palmer Invitational");
    expect(t).toContain("4–7 March 2027");
    expect(t).toContain("Bay Hill Club and Lodge");
  });

  it("renders the Course Profile, the ranking and the gaps without any JavaScript", () => {
    const t = text(DATA);
    expect(t).toContain("7,466 yards");
    expect(t).toContain("Casey Clark");
    expect(t).toContain("no record");
    expect(t).toContain("Players with no usable record");
    expect(t).toContain("Drew Dunn");
    // Only the sliders need JavaScript, and until it runs they are disabled and say so.
    expect(html(DATA)).toMatch(/<input[^>]*type="range"[^>]*disabled/);
    expect(t).toContain("The sliders need JavaScript");
  });

  it("says the field is assumed, in the page's text rather than a tooltip", () => {
    const t = text(DATA);
    expect(t).toContain("The field is assumed, not confirmed.");
    expect(t).toContain("No open source publishes entry lists");
  });

  it("states which results are covered and that regular tour events are not", () => {
    const t = text(DATA);
    expect(t).toContain("Masters Tournament");
    expect(t).toContain("Genesis Invitational");
    expect(t).toContain("Regular tour events are not covered");
  });

  it("shows altitude and green surface, and the altitude-adjusted length beside the raw one", () => {
    const t = text(DATA);
    expect(t).toContain("105 feet above sea level");
    expect(t).toContain("Bermuda");
    expect(t).toContain("plays like 7,450 yards adjusted for altitude");
    expect(html(DATA)).toContain(
      `href="${TRUSTED_COURSE.courseFactsSourceUrl!.replace(/&/g, "&amp;")}"`,
    );
  });

  it("shows untrusted hole data as unavailable, with the reason", () => {
    const t = text(UNTRUSTED);
    expect(t).toContain("Unavailable.");
    expect(t).toContain("1,080 yards short of the published 7,555 yards");
    expect(t).toContain("Trait unavailable");
  });

  it("attributes all three Sources, linking to their licences", () => {
    for (const data of [DATA, null]) {
      const h = html(data);
      for (const source of Object.values(LICENCES)) {
        expect(h).toContain(`href="${source.licenceUrl}"`);
        expect(h).toContain(source.licence);
      }
    }
  });

  it("states no prediction, probability or betting position anywhere", () => {
    for (const data of [DATA, UNTRUSTED, null]) {
      expect(text(data)).not.toMatch(
        /\bodds\b|\bbet(s|ting)?\b|will win|expected finish|predict|probabilit|favourite|\btips?\b/i,
      );
    }
  });

  it("says so plainly when no Tournament is upcoming", () => {
    expect(text(null)).toContain("No upcoming PGA Tour Tournament is stored");
  });
});
