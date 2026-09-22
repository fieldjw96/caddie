import { describe, expect, it } from "vitest";
import { extractCourseName } from "./course-name";

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
});
