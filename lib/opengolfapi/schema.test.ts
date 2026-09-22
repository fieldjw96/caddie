// @vitest-environment node

import { describe, expect, it } from "vitest";
import augusta from "./fixtures/augusta-national.detail.json";
import bayHill from "./fixtures/bay-hill.search.json";
import { courseResponse, parse, searchResponse, ShapeError } from "./schema";

const clone = <T>(value: T): T => structuredClone(value);

describe("courseResponse", () => {
  it("parses a real response, dropping the fields we do not read", () => {
    const course = parse(courseResponse, augusta, "fixture");
    expect(course.yardage).toBe(7445);
    expect(course.holes_data).toHaveLength(18);
    expect(course.tees?.[0]).toMatchObject({
      tee_name: "Black",
      course_rating: 76.2,
      slope: 148,
    });
    expect(course).not.toHaveProperty("insights");
  });

  it("fails naming the field when a hole's par changes type", () => {
    const changed = clone(augusta);
    (changed.holes_data[3] as { par: unknown }).par = "3";
    expect(() => parse(courseResponse, changed, "GET course")).toThrow(ShapeError);
    expect(() => parse(courseResponse, changed, "GET course")).toThrow(/holes_data\.3\.par/);
  });

  it("fails naming the field when one goes missing", () => {
    const changed: Partial<typeof augusta> = clone(augusta);
    delete changed.yardage;
    expect(() => parse(courseResponse, changed, "GET course")).toThrow(/^.*\. yardage:/);
  });

  it("names every failing field, not just the first", () => {
    const changed = clone(augusta);
    (changed.tees[0] as { slope: unknown }).slope = "148";
    (changed as { par: unknown }).par = -1;
    expect(() => parse(courseResponse, changed, "GET course")).toThrow(
      /tees\.0\.slope.*; par:|par:.*; tees\.0\.slope/,
    );
  });
});

describe("searchResponse", () => {
  it("parses a real response", () => {
    const found = parse(searchResponse, bayHill, "fixture");
    expect(found.courses.length).toBeGreaterThan(1);
    expect(found._attribution).toMatch(/OpenStreetMap contributors \(ODbL 1\.0\)/);
  });

  it("refuses a response under any licence but ODbL 1.0", () => {
    expect(() => parse(searchResponse, { ...bayHill, _license: "CC-BY-NC-4.0" }, "x")).toThrow(
      /_license/,
    );
  });

  it("refuses a response with no attribution to carry", () => {
    expect(() => parse(searchResponse, { ...bayHill, _attribution: " " }, "x")).toThrow(
      /_attribution/,
    );
  });
});
