import { describe, expect, it } from "vitest";
import { sparqlResponseSchema, toPlayerRows, type SparqlResponse } from "./wikidata-players";

function response(bindings: unknown[]): SparqlResponse {
  return sparqlResponseSchema.parse({ results: { bindings } });
}

const label = (value: string) => ({ type: "literal", value });
const player = (qid: string) => ({
  type: "uri",
  value: `http://www.wikidata.org/entity/${qid}`,
});

describe("sparqlResponseSchema", () => {
  it("refuses a response that has changed shape", () => {
    expect(() => sparqlResponseSchema.parse({ results: {} })).toThrow();
    expect(() => sparqlResponseSchema.parse({})).toThrow();
  });
});

describe("toPlayerRows", () => {
  it("stores an optional field as null rather than guessing when Wikidata has none", () => {
    const rows = toPlayerRows(
      response([{ player: player("Q10993"), playerLabel: label("Tiger Woods") }]),
    );
    expect(rows).toEqual([
      {
        wikidataId: "Q10993",
        name: "Tiger Woods",
        country: null,
        dateOfBirth: null,
        turnedProfessionalYear: null,
        sourceUrl: "http://www.wikidata.org/entity/Q10993",
      },
    ]);
  });

  it("parses the full set of fields present", () => {
    const rows = toPlayerRows(
      response([
        {
          player: player("Q10993"),
          playerLabel: label("Tiger Woods"),
          countryLabel: label("United States"),
          dob: { type: "literal", value: "1975-12-30T00:00:00Z" },
          turnedPro: { type: "literal", value: "1996-01-01T00:00:00Z" },
        },
      ]),
    );
    expect(rows).toEqual([
      {
        wikidataId: "Q10993",
        name: "Tiger Woods",
        country: "United States",
        dateOfBirth: "1975-12-30",
        turnedProfessionalYear: 1996,
        sourceUrl: "http://www.wikidata.org/entity/Q10993",
      },
    ]);
  });

  it("collapses a player with more than one optional statement into one row", () => {
    const rows = toPlayerRows(
      response([
        {
          player: player("Q327813"),
          playerLabel: label("Tim Herron"),
          countryLabel: label("United States"),
          dob: { type: "literal", value: "1970-02-06T00:00:00Z" },
        },
        {
          player: player("Q327813"),
          playerLabel: label("Tim Herron"),
          countryLabel: label("Zimbabwe"),
          dob: { type: "literal", value: "1970-02-06T00:00:00Z" },
        },
      ]),
    );
    expect(rows).toHaveLength(1);
    // Deterministic regardless of which duplicate arrived first from Wikidata: the
    // alphabetically first country wins, so re-running the ingest is stable.
    expect(rows[0]?.country).toBe("United States");
  });

  it("picks the earliest date and year among duplicate statements, in either order", () => {
    const bindingsInOrder = [
      {
        player: player("Q1"),
        playerLabel: label("A Player"),
        dob: { type: "literal", value: "1990-06-01T00:00:00Z" },
        turnedPro: { type: "literal", value: "2015-01-01T00:00:00Z" },
      },
      {
        player: player("Q1"),
        playerLabel: label("A Player"),
        dob: { type: "literal", value: "1989-06-01T00:00:00Z" },
        turnedPro: { type: "literal", value: "2012-01-01T00:00:00Z" },
      },
    ];
    const forwards = toPlayerRows(response(bindingsInOrder));
    const backwards = toPlayerRows(response([...bindingsInOrder].reverse()));

    expect(forwards[0]?.dateOfBirth).toBe("1989-06-01");
    expect(forwards[0]?.turnedProfessionalYear).toBe(2012);
    expect(backwards).toEqual(forwards);
  });

  it("refuses an entity URI that is not a Wikidata item", () => {
    expect(() =>
      toPlayerRows(
        response([
          {
            player: { type: "uri", value: "http://www.wikidata.org/entity/P2811" },
            playerLabel: label("Not an item"),
          },
        ]),
      ),
    ).toThrow(/does not name an item/);
  });
});
