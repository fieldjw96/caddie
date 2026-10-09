import { describe, expect, it } from "vitest";
import {
  extractCoursePar,
  extractCourseName,
  extractCourseYardage,
  extractTournamentCourse,
} from "./course-name";

// The Baycurrent Classic's infobox, as the article carried it on 2026-10-08. The Tournament
// this Ticket exists for: OpenGolfAPI's only hit for Yokohama Country Club is a driving range,
// so these three lines are the only Source for its Course that this repo may publish.
const BAYCURRENT_CLASSIC = `{{Infobox golf tournament
| name             = Baycurrent Classic
| location         = [[Yokohama]], Kanagawa Prefecture, Japan
| establishment    = 2019
| course           = Yokohama Country Club
| par              = 71
| yardage          = {{Convert|7315|yd}}
| org              = [[PGA Tour]]
}}
The '''Baycurrent Classic''' is a professional golf tournament in [[Yokohama]], Japan.`;

const PHOENIX_OPEN = `{{Infobox golf tournament
| name             = WM Phoenix Open
| location         = [[Scottsdale, Arizona]], U.S.
| establishment    = 1932
| course           = [[TPC Scottsdale]]
| par              = 71
| yardage          = {{convert|7261|yd|m}}
}}
The '''Phoenix Open''' is a tournament.`;

describe("extractCourseName", () => {
  it("strips the wikilink down to the Course's name", () => {
    expect(extractCourseName(PHOENIX_OPEN)).toBe("TPC Scottsdale");
  });

  it("returns null when the article has no infobox", () => {
    expect(extractCourseName("Just some prose, no infobox at all.")).toBeNull();
  });

  it("returns null when the infobox has no course field", () => {
    const noCourse = `{{Infobox golf tournament\n| name = Some Event\n| par = 72\n}}`;
    expect(extractCourseName(noCourse)).toBeNull();
  });

  it("returns null when the course field is blank", () => {
    const blank = `{{Infobox golf tournament\n| course = \n| par = 72\n}}`;
    expect(extractCourseName(blank)).toBeNull();
  });

  it("resolves a piped wikilink to its display text", () => {
    const piped = `{{Infobox golf tournament\n| course = [[Trump National Doral|Doral]]\n}}`;
    expect(extractCourseName(piped)).toBe("Doral");
  });

  it("joins a comma-separated list written with <br>", () => {
    const multi = `{{Infobox golf tournament\n| course = [[Bay Hill Club]]<br>[[Isleworth Golf and Country Club|Isleworth]]\n}}`;
    expect(extractCourseName(multi)).toBe("Bay Hill Club, Isleworth");
  });

  it("collapses a non-breaking space, and repeated or trailing whitespace", () => {
    // The literal U+00A0 character, as it reaches this function once wikipedia.ts has
    // decoded the "&nbsp;" entity MediaWiki's response carried.
    const nbsp = `{{Infobox golf tournament\n| course = TPC Toronto at Osprey Valley (North course)  \n}}`;
    expect(extractCourseName(nbsp)).toBe("TPC Toronto at Osprey Valley (North course)");
  });
});

describe("extractCoursePar", () => {
  it("reads the par the infobox states", () => {
    expect(extractCoursePar(BAYCURRENT_CLASSIC)).toBe(71);
    expect(extractCoursePar(PHOENIX_OPEN)).toBe(71);
  });

  it("returns null when the infobox has no par, or a blank one", () => {
    expect(extractCoursePar(`{{Infobox golf tournament\n| course = Somewhere\n}}`)).toBeNull();
    expect(extractCoursePar(`{{Infobox golf tournament\n| par = \n}}`)).toBeNull();
  });

  it("refuses a par that is not a plain number rather than guessing at it", () => {
    expect(extractCoursePar(`{{Infobox golf tournament\n| par = 70/71\n}}`)).toBeNull();
    expect(extractCoursePar(`{{Infobox golf tournament\n| par = 72 (2026)\n}}`)).toBeNull();
    expect(extractCoursePar(`{{Infobox golf tournament\n| par = see below\n}}`)).toBeNull();
  });

  it("is not fooled by another field whose name starts with par", () => {
    const participants = `{{Infobox golf tournament\n| participants = 144\n| par = 71\n}}`;
    expect(extractCoursePar(participants)).toBe(71);
  });

  it("drops a footnote on the par rather than reading its digits", () => {
    const ref = `{{Infobox golf tournament\n| par = 71<ref>Scorecard, 2025</ref>\n}}`;
    expect(extractCoursePar(ref)).toBe(71);
  });
});

describe("extractCourseYardage", () => {
  it("reads a {{Convert}} template's yardage, however it is capitalised", () => {
    expect(extractCourseYardage(BAYCURRENT_CLASSIC)).toBe(7315);
    expect(extractCourseYardage(PHOENIX_OPEN)).toBe(7261);
    expect(extractCourseYardage(`{{Infobox\n| yardage = {{cvt|7,100|yd|m}}\n}}`)).toBe(7100);
  });

  it("reads a plain number, with or without its unit and its separator", () => {
    expect(extractCourseYardage(`{{Infobox\n| yardage = 7315\n}}`)).toBe(7315);
    expect(extractCourseYardage(`{{Infobox\n| yardage = 7,315 yards\n}}`)).toBe(7315);
    expect(extractCourseYardage(`{{Infobox\n| yardage = 7,315 yd\n}}`)).toBe(7315);
  });

  it("returns null when the infobox states no yardage", () => {
    expect(extractCourseYardage(`{{Infobox\n| par = 71\n}}`)).toBeNull();
    expect(extractCourseYardage(`{{Infobox\n| yardage = \n}}`)).toBeNull();
  });

  it("refuses a yardage it cannot read as yards rather than converting a guess", () => {
    expect(extractCourseYardage(`{{Infobox\n| yardage = {{convert|6700|m}}\n}}`)).toBeNull();
    expect(extractCourseYardage(`{{Infobox\n| yardage = 6,700 metres\n}}`)).toBeNull();
    expect(extractCourseYardage(`{{Infobox\n| yardage = varies\n}}`)).toBeNull();
  });
});

describe("extractTournamentCourse", () => {
  it("reads all three facts from one pass over the article", () => {
    expect(extractTournamentCourse(BAYCURRENT_CLASSIC)).toEqual({
      name: "Yokohama Country Club",
      par: 71,
      yardage: 7315,
    });
  });

  it("reads nothing at all from an article with no infobox", () => {
    expect(extractTournamentCourse("Just some prose.")).toEqual({
      name: null,
      par: null,
      yardage: null,
    });
  });
});

describe("extractCourseYardage, on the shapes real articles use", () => {
  it("reads a yardage followed by its metric equivalent", () => {
    expect(extractCourseYardage(`{{Infobox\n| yardage = 7,315 yards (6,689 m)\n}}`)).toBe(
      7315,
    );
  });

  it("refuses a bare number with anything after it", () => {
    expect(extractCourseYardage(`{{Infobox\n| yardage = 7,315 (from 2025)\n}}`)).toBeNull();
  });
});
