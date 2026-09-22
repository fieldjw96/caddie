import { describe, expect, it } from "vitest";
import { confidentArticle, wikipediaFacilityName } from "./wikipedia-name";

describe("wikipediaFacilityName", () => {
  it("resolves a schedule name that lists one club outright", () => {
    expect(wikipediaFacilityName("TPC Scottsdale")).toBe("TPC Scottsdale");
  });

  it("resolves a schedule name listing the same club more than once", () => {
    expect(
      wikipediaFacilityName("Torrey Pines Golf Course, (South Course), (North Course)"),
    ).toBe("Torrey Pines Golf Course");
  });

  it("disambiguates a declared schedule name that lists several distinct clubs", () => {
    expect(
      wikipediaFacilityName(
        "La Quinta Country Club, PGA West, (Stadium Course), (Nicklaus Tournament Course)",
      ),
    ).toBe("PGA West");
    expect(
      wikipediaFacilityName("{{nowrap|Pebble Beach Golf Links, Spyglass Hill Golf Course}}"),
    ).toBe("Pebble Beach Golf Links");
  });

  it("returns null for several distinct clubs with no declared pairing to disambiguate them", () => {
    expect(
      wikipediaFacilityName("Some Club, Another Club, (A Course), (B Course)"),
    ).toBeNull();
  });
});

describe("confidentArticle", () => {
  it("accepts a single result differing only in capitalisation", () => {
    expect(confidentArticle("Tpc Deere Run", [{ title: "TPC Deere Run" }])).toEqual({
      status: "confident",
      title: "TPC Deere Run",
    });
  });

  it("accepts a single result missing a course suffix Wikipedia does not use", () => {
    expect(
      confidentArticle("Memorial Park Golf Course", [{ title: "Memorial Park" }]),
    ).toEqual({
      status: "confident",
      title: "Memorial Park",
    });
  });

  it("refuses when nothing reads the same", () => {
    expect(
      confidentArticle("Black Desert Resort", [
        { title: "Desert Inn" },
        { title: "Bank of Utah Championship" },
      ]),
    ).toEqual({
      status: "unconfident",
      titles: ["Desert Inn", "Bank of Utah Championship"],
    });
  });

  it("refuses when more than one result reads the same", () => {
    expect(
      confidentArticle("Renaissance Club", [
        { title: "The Renaissance Club" },
        { title: "Renaissance Golf Club" },
      ]),
    ).toEqual({
      status: "unconfident",
      titles: ["The Renaissance Club", "Renaissance Golf Club"],
    });
  });
});
