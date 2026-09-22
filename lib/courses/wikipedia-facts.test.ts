import { describe, expect, it } from "vitest";
import { extractCourseFacts, parseAltitudeFeet, parseGreenSurface } from "./wikipedia-facts";

// Modeled on the real `{{Infobox golf facility}}` these three PGA Tour venue articles carry,
// trimmed to the fields this module reads.

const BETHPAGE_BLACK = `{{Infobox golf facility
| name           = Bethpage Black Course
| elevation      = {{convert|125|ft|round=5}}
| greens         = ''[[Poa annua]]''<!-- type of grass used -->
| fairways       = [[Lolium|Ryegrass]] / ''Poa annua''
}}`;

const AUGUSTA_NATIONAL = `{{Infobox golf facility
| name            = Augusta National Golf Club
| elevation       = {{cvt|160|–|310|ft|round=5}}
| greens          = [[Agrostis|Bentgrass]]
| fairways        = [[Lolium|Ryegrass]]
}}`;

// Pebble Beach's real elevation field is commented out outright, and its greens field is not:
// a genuine mixed case, real rather than invented.
const PEBBLE_BEACH = `{{Infobox golf facility
| name           = Pebble Beach Golf Links
| elevation      = <!-- {{convert|30|ft}} -->
| greens         = ''[[Poa annua]]''
| fairways       = [[Lolium perenne|Winter ryegrass]]
}}`;

const NO_INFOBOX = "Just some prose about a golf course, no infobox at all.";

describe("parseAltitudeFeet", () => {
  it("reads a plain feet reading", () => {
    expect(parseAltitudeFeet(BETHPAGE_BLACK)).toBe(125);
  });

  it("reads a metres reading and converts it to feet", () => {
    const metric = `{{Infobox golf facility\n| elevation = {{convert|22|m|ft}}\n}}`;
    expect(parseAltitudeFeet(metric)).toBe(72); // 22 * 3.28084 = 72.18, rounds to 72
  });

  it("takes the midpoint of a range", () => {
    expect(parseAltitudeFeet(AUGUSTA_NATIONAL)).toBe(235); // (160 + 310) / 2
  });

  it("reads a plain-text feet value with no template", () => {
    const plain = `{{Infobox golf facility\n| elevation = 400 ft\n}}`;
    expect(parseAltitudeFeet(plain)).toBe(400);
  });

  it("reads a plain-text metres value with no template", () => {
    const plain = `{{Infobox golf facility\n| elevation = 122 m\n}}`;
    expect(parseAltitudeFeet(plain)).toBe(400); // 122 * 3.28084 = 400.26, rounds to 400
  });

  it("keeps the sign on a below-sea-level reading", () => {
    const belowSeaLevel = `{{Infobox golf facility\n| elevation = {{convert|-30|ft}}\n}}`;
    expect(parseAltitudeFeet(belowSeaLevel)).toBe(-30);
  });

  it("keeps the sign on a below-sea-level plain-text reading", () => {
    const belowSeaLevel = `{{Infobox golf facility\n| elevation = -30 ft\n}}`;
    expect(parseAltitudeFeet(belowSeaLevel)).toBe(-30);
  });

  it("returns null when the elevation field is commented out", () => {
    expect(parseAltitudeFeet(PEBBLE_BEACH)).toBeNull();
  });

  it("returns null when the article has no elevation field at all", () => {
    const noElevation = `{{Infobox golf facility\n| name = Some Course\n| par1 = 72\n}}`;
    expect(parseAltitudeFeet(noElevation)).toBeNull();
  });

  it("returns null when the article has no infobox", () => {
    expect(parseAltitudeFeet(NO_INFOBOX)).toBeNull();
  });
});

describe("parseGreenSurface", () => {
  it("resolves a piped wikilink to its display text", () => {
    expect(parseGreenSurface(AUGUSTA_NATIONAL)).toBe("Bentgrass");
  });

  it("strips italics markup around a plain wikilink", () => {
    expect(parseGreenSurface(BETHPAGE_BLACK)).toBe("Poa annua");
  });

  it("returns null when the greens field is a placeholder comment", () => {
    const placeholder = `{{Infobox golf facility\n| greens = <!-- type of grass used -->\n}}`;
    expect(parseGreenSurface(placeholder)).toBeNull();
  });

  it("returns null when the article has no greens field at all", () => {
    expect(parseGreenSurface(NO_INFOBOX)).toBeNull();
  });
});

describe("extractCourseFacts", () => {
  it("reads both facts from one article", () => {
    expect(extractCourseFacts(BETHPAGE_BLACK)).toEqual({
      altitudeFeet: 125,
      greenSurface: "Poa annua",
    });
  });

  it("reports each fact missing on its own, not the whole article as unusable", () => {
    expect(extractCourseFacts(PEBBLE_BEACH)).toEqual({
      altitudeFeet: null,
      greenSurface: "Poa annua",
    });
  });

  it("returns both null for an article with neither", () => {
    expect(extractCourseFacts(NO_INFOBOX)).toEqual({ altitudeFeet: null, greenSurface: null });
  });
});
