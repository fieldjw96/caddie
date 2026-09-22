import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./html-entities";

describe("decodeHtmlEntities", () => {
  it("turns a non-breaking space into an ordinary one", () => {
    expect(decodeHtmlEntities("Osprey&nbsp;Valley")).toBe("Osprey Valley");
  });

  it("decodes an ampersand", () => {
    expect(decodeHtmlEntities("Isleworth Golf &amp; Country Club")).toBe(
      "Isleworth Golf & Country Club",
    );
  });

  it("decodes an en dash", () => {
    expect(decodeHtmlEntities("2026&ndash;27 season")).toBe("2026–27 season");
  });

  it("decodes a decimal and a hex numeric entity", () => {
    expect(decodeHtmlEntities("Golf&#160;Club")).toBe("Golf Club");
    expect(decodeHtmlEntities("Golf&#xA0;Club")).toBe("Golf Club");
  });

  it("leaves text with no entity unchanged", () => {
    expect(decodeHtmlEntities("Waialae Country Club")).toBe("Waialae Country Club");
  });

  it("leaves an entity it does not recognise as written", () => {
    expect(decodeHtmlEntities("Fish &chips; Club")).toBe("Fish &chips; Club");
  });
});
