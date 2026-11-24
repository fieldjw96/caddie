// The page as a reader without JavaScript receives it: the server's HTML, nothing hydrated.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkRankable } from "../lib/ingest/rankable";
import type { PageData, SkippedTournamentView } from "../lib/page/data";
import {
  ARTICLE_COURSE,
  ARTICLE_TRAITS,
  PLAYERS,
  TRUSTED_COURSE,
  TRUSTED_TRAITS,
  UNTRUSTED_COURSE,
  UNTRUSTED_TRAITS,
} from "../lib/page/fixtures";
import { ROSTER_WINDOW_MONTHS } from "../lib/roster";
import { LICENCES, PageView } from "./page-view";

// Fixed so the freshness tests below do not depend on when they happen to run.
const NOW = new Date("2026-10-28T12:00:00Z");

// Four days after NOW: within the "this week" threshold, so today's copy applies.
const DATA: PageData = {
  tournament: {
    name: "Arnold Palmer Invitational",
    season: 2026,
    startDate: "2026-11-01",
    endDate: "2026-11-04",
    courseName: "Bay Hill Club and Lodge",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
  },
  skipped: [],
  course: TRUSTED_COURSE,
  traits: TRUSTED_TRAITS,
  players: PLAYERS,
  coverage: {
    seasons: [2026],
    leaderboardEvents: [{ name: "Masters Tournament", season: 2026 }],
    standingsEvents: [{ name: "Genesis Invitational", season: 2026 }],
  },
  strengthsDerivedAt: "2026-10-27T06:17:00Z",
  resultsReadAt: "2026-10-27T06:17:00Z",
};

const UNTRUSTED: PageData = { ...DATA, course: UNTRUSTED_COURSE, traits: UNTRUSTED_TRAITS };

/** The next Tournament, its Course read off its own article because OpenGolfAPI has none. */
const FROM_ARTICLE: PageData = {
  ...DATA,
  tournament: {
    name: "Baycurrent Classic",
    season: 2026,
    startDate: "2026-10-11",
    endDate: "2026-10-14",
    courseName: "Yokohama Country Club",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=1",
  },
  course: ARTICLE_COURSE,
  traits: ARTICLE_TRAITS,
};

const html = (data: PageData | null, now: Date = NOW) =>
  renderToString(<PageView data={data} now={now} />);

/**
 * One skipped Tournament as lib/page/choose-tournament.ts records it, carrying the reason
 * `checkRankable` itself gave rather than a reworded copy of it: this is what the page has to
 * print, so the test asks the real function for it.
 */
function skippedFixture(
  next: { name: string; courseName: string | null; courseId: number | null },
  sourceUrl: string | null,
): SkippedTournamentView {
  const result = checkRankable({ next, courseTraitCount: 0, anyPlayerHasStrength: true });
  if (result.ok) throw new Error(`${next.name} must be one \`checkRankable\` refuses`);
  return { name: next.name, reason: result.reason, sourceUrl };
}

/** The Austin Championship, whose Wikipedia article is a red link, so it has no venue. */
const SKIPPED_AUSTIN = skippedFixture(
  { name: "Austin Championship", courseName: null, courseId: null },
  "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=2#Austin",
);

/** The Butterfield Bermuda Championship, whose matched Course has no Course Trait. */
const SKIPPED_BERMUDA = skippedFixture(
  {
    name: "Butterfield Bermuda Championship",
    courseName: "Port Royal Golf Course",
    courseId: 7,
  },
  "https://en.wikipedia.org/w/index.php?title=2026_PGA_Tour&oldid=2#Bermuda",
);

/** The HTML's text, roughly as a reader sees it. */
const text = (data: PageData | null, now: Date = NOW) =>
  html(data, now)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&rsquo;|’/g, "'")
    .replace(/<!-- -->/g, "")
    .replace(/\s+/g, " ");

describe("PageView, rendered on the server", () => {
  it("states the Tournament, its dates and its Course", () => {
    const t = text(DATA);
    expect(t).toContain("Arnold Palmer Invitational");
    expect(t).toContain("1–4 November 2026");
    expect(t).toContain("Bay Hill Club and Lodge");
  });

  it("renders a multi-course schedule entry in words in the heading, with no Course matched", () => {
    const data: PageData = {
      ...DATA,
      course: null,
      traits: {},
      tournament: {
        ...DATA.tournament,
        courseName: "Sea Island Golf Club, (Seaside Course), (Plantation Course)",
      },
    };
    const t = text(data);
    expect(t).toContain("Sea Island Golf Club (Seaside Course and Plantation Course)");
    expect(t).not.toContain(", (");
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

  it("says a declared card was entered by hand, is not open, and where it came from", () => {
    const url = "https://example.com/card";
    const declared = {
      ...DATA,
      course: { ...DATA.course!, holesSource: "declared" as const, holesSourceUrl: url },
    };
    const t = text(declared);
    expect(t).toContain("entered by hand");
    expect(t).toContain("not openly licensed");
    expect(html(declared)).toContain(`href="${url}"`);
    expect(text(DATA)).not.toContain("entered by hand");
  });

  it("links OpenStreetMap's holes and the elevation reading to where they came from", () => {
    const osm = "https://www.openstreetmap.org/way/1";
    const reading = "https://api.open-meteo.com/v1/elevation?latitude=1";
    const h = html({
      ...DATA,
      course: {
        ...DATA.course!,
        holesSource: "openstreetmap" as const,
        holesSourceUrl: osm,
        altitudeSource: "copernicus" as const,
        elevationSourceUrl: reading,
      },
    });
    expect(h).toContain(`href="${osm}"`);
    expect(h).toContain(`href="${reading}"`);
  });

  it("shows untrusted hole data as unavailable, with the reason", () => {
    const t = text(UNTRUSTED);
    expect(t).toContain("Unavailable.");
    expect(t).toContain("1,080 yards short of the published 7,555 yards");
    expect(t).toContain("Trait unavailable");
  });

  it("attributes every Source, linking to its licence", () => {
    for (const data of [DATA, null]) {
      const h = html(data);
      for (const source of Object.values(LICENCES)) {
        expect(h).toContain(`href="${source.licenceUrl}"`);
        expect(h).toContain(source.licence);
      }
    }
  });

  // The Ticket this fixture exists for: with no Course there are no Traits, with no Traits no
  // Fit Score, and the ranking renders nothing at all. Two course-level Traits are enough.
  // Only Length is a Fit Trait, so every Fit Score here rests on part of the Weighting and the
  // Players are listed in the group beneath rather than ranked: rows either way.
  it("scores the field on a Course created from the Tournament's own article", () => {
    const h = html(FROM_ARTICLE);
    expect(h).toMatch(/<tr\b[^>]*\bdata-player="Casey Clark"/);
    expect([...h.matchAll(/<tr\b[^>]*\bdata-player="/g)]).toHaveLength(3);
    expect(text(FROM_ARTICLE)).toContain("resting on part of the Weighting");

    const t = text(FROM_ARTICLE);
    expect(t).toContain("7,315 yards");
    expect(t).toContain("Yokohama Country Club");
    // The gap is named honestly: OpenGolfAPI has no record of this Course to have given one.
    expect(t).toContain("states a published total rather than a hole-by-hole card");
    expect(t).not.toContain("OpenGolfAPI gave no hole-by-hole data");
    expect(t).toContain("Course facts from the English Wikipedia article");
    // The revision itself, linked: CC BY-SA wants the Source named and reachable.
    expect(h).toContain("oldid=1378612509");
  });

  it("states no prediction, probability or betting position anywhere", () => {
    for (const data of [DATA, UNTRUSTED, FROM_ARTICLE, null]) {
      expect(text(data)).not.toMatch(
        /\bodds\b|\bbet(s|ting)?\b|will win|expected finish|predict|probabilit|favourite|\btips?\b/i,
      );
    }
  });

  it("says so plainly when no Tournament is upcoming", () => {
    expect(text(null)).toContain("No upcoming PGA Tour Tournament is stored");
  });

  it("states the answer before the Course Profile heading, in document order", () => {
    const container = document.createElement("div");
    container.innerHTML = html(DATA);
    const answerEl = container.querySelector('[data-testid="answer"]');
    const courseHeading = container.querySelector("#course");
    expect(answerEl).not.toBeNull();
    expect(courseHeading).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4): courseHeading comes after answerEl.
    expect(
      answerEl!.compareDocumentPosition(courseHeading!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names the top three Players and the leader's biggest Trait in the answer, never a forecast", () => {
    const t = text(DATA);
    expect(t).toContain("Casey Clark");
    expect(t).not.toMatch(/\b(win|winner|favou?rite|tip|bet|odds|predict|will finish)\b/i);
  });

  it("hides the Record here column when no Player has a venue record value", () => {
    const playersNoVenueValue: typeof PLAYERS = PLAYERS.map((p) => ({
      ...p,
      venueRecord: { value: null, sampleSize: 0 },
    }));
    const data: PageData = { ...DATA, players: playersNoVenueValue };
    const h = html(data);
    const t = text(data);
    expect(t).not.toContain("Record here");
    expect(h).not.toMatch(/<th[^>]*>\s*Record here\s*<\/th>/);
  });

  it("states when Strengths were derived and results last read, in the header", () => {
    const t = text(DATA);
    expect(t).toContain("Strengths derived 27 Oct 2026");
    expect(t).toContain("results last read 27 Oct 2026");
  });

  it("does not flag Strengths as stale within two days of the derive", () => {
    const t = text(DATA);
    expect(t).not.toContain("How fresh this is");
  });

  it("flags Strengths as stale more than two days after the derive", () => {
    const stale: PageData = { ...DATA, strengthsDerivedAt: "2026-10-20T06:17:00Z" };
    const t = text(stale);
    expect(t).toContain("How fresh this is");
    expect(t).toContain("20 Oct 2026");
  });

  it("reads a never-derived Strength as stale, with 'never' wording, and does not throw", () => {
    const never: PageData = { ...DATA, strengthsDerivedAt: null, resultsReadAt: null };
    expect(() => text(never)).not.toThrow();
    const t = text(never);
    expect(t).toContain("How fresh this is");
    expect(t).toContain("Strengths derived never");
    expect(t).toContain("results last read never");
  });

  it("shows the Record here column when at least one Player has a venue record value", () => {
    const playersWithOneVenue: typeof PLAYERS = PLAYERS.map((p, i) => ({
      ...p,
      venueRecord: i === 0 ? { value: 0.75, sampleSize: 3 } : { value: null, sampleSize: 0 },
    }));
    const data: PageData = { ...DATA, players: playersWithOneVenue };
    const h = html(data);
    const t = text(data);
    expect(h).toMatch(/<th[^>]*>\s*Record here\s*<\/th>/);
    // Verify cells show the values and "no record" for Players without a venue record value
    expect(t).toContain("75 %");
    expect(t).toContain("3 results");
    expect(t).toContain("no record");
  });

  it("names a skipped Tournament, its reason and a link to it, above the ranking", () => {
    const data: PageData = { ...DATA, skipped: [SKIPPED_BERMUDA] };
    const h = html(data);
    const t = text(data);
    expect(t).toContain("Butterfield Bermuda Championship");
    expect(t).toContain(SKIPPED_BERMUDA.reason);
    expect(h).toContain(`href="${SKIPPED_BERMUDA.sourceUrl!.replace(/&/g, "&amp;")}"`);
    // Above the ranking: a reader meets the disclosure before the Players it explains.
    expect(h.indexOf("Butterfield Bermuda Championship")).toBeLessThan(
      h.indexOf("data-player"),
    );
    // And the Tournament on show is no longer called the next one without qualification.
    expect(t).toContain("The next PGA Tour Tournament we can rank");
    expect(t).toContain("Arnold Palmer Invitational is the soonest one we can rank");
  });

  it("names every skipped Tournament, in schedule order, each with its own reason", () => {
    const data: PageData = { ...DATA, skipped: [SKIPPED_AUSTIN, SKIPPED_BERMUDA] };
    const h = html(data);
    const t = text(data);
    expect(t).toContain("2 were skipped");
    expect(t).toContain(SKIPPED_AUSTIN.reason);
    expect(t).toContain(SKIPPED_BERMUDA.reason);
    expect(h).toContain(`href="${SKIPPED_AUSTIN.sourceUrl!.replace(/&/g, "&amp;")}"`);
    expect(h).toContain(`href="${SKIPPED_BERMUDA.sourceUrl!.replace(/&/g, "&amp;")}"`);
    expect(h.indexOf("Austin Championship")).toBeLessThan(
      h.indexOf("Butterfield Bermuda Championship"),
    );
  });

  it("names a skipped Tournament the schedule has no revision for, without a link", () => {
    const data: PageData = {
      ...DATA,
      skipped: [{ ...SKIPPED_AUSTIN, sourceUrl: null }],
    };
    expect(text(data)).toContain("Austin Championship");
    expect(() => html(data)).not.toThrow();
  });

  it("renders no disclosure at all when nothing was skipped", () => {
    const h = html(DATA);
    const t = text(DATA);
    expect(h).not.toContain('id="skipped"');
    expect(t).not.toContain("skipped");
    expect(t).not.toContain("not the soonest Tournament");
    expect(t).toContain("The next PGA Tour Tournament");
    expect(t).not.toContain("The next PGA Tour Tournament we can rank");
  });

  it("says the Field is assumed and entered this week when the Tournament starts within 6 days", () => {
    const t = text(DATA);
    expect(t).toContain("The field is assumed, not confirmed.");
    expect(t).toContain("Players actually entered this week.");
    expect(t).toContain("says nothing about where anyone finishes this week.");
  });
});

describe("PageView, weeks from the next Tournament", () => {
  /** `days` whole calendar days after `NOW`, as a `YYYY-MM-DD`. */
  const daysLater = (days: number) =>
    new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const FAR: PageData = {
    ...DATA,
    tournament: { ...DATA.tournament, startDate: daysLater(61), endDate: daysLater(64) },
  };

  it("names how far off it is, drops 'this week', and says no Field exists yet, with nothing skipped", () => {
    const data: PageData = { ...FAR, skipped: [] };
    const t = text(data);
    expect(t).not.toContain("this week");
    expect(t).toContain("The next PGA Tour Tournament, in 9 weeks");
    expect(t).toMatch(/no field/i);
    expect(t).toContain(`stored result in the last ${ROSTER_WINDOW_MONTHS} months`);
    expect(t).toContain("No PGA Tour Tournament is played before this one.");
  });

  it("makes no claim that nothing is played before it, when a Tournament was skipped", () => {
    const data: PageData = { ...FAR, skipped: [SKIPPED_BERMUDA] };
    const t = text(data);
    expect(t).not.toContain("this week");
    expect(t).toMatch(/no field/i);
    expect(t).toContain(`stored result in the last ${ROSTER_WINDOW_MONTHS} months`);
    expect(t).not.toContain("No PGA Tour Tournament is played before this one.");
  });

  it("leaves the band label unqualified and keeps today's copy within 6 days", () => {
    const data: PageData = {
      ...DATA,
      tournament: { ...DATA.tournament, startDate: daysLater(6), endDate: daysLater(9) },
    };
    const t = text(data);
    expect(t).toContain("Players actually entered this week.");
    expect(t).not.toMatch(/The next PGA Tour Tournament, in \d+ weeks?/);
  });
});
