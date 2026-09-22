// The fast half of the Source rule's tests: that every table declares it. The half that
// proves Postgres enforces it is source-rule.db.test.ts.

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  courses,
  courseTraits,
  players,
  playerStrengths,
  results,
  source,
  tournaments,
} from "./schema";

const tables: PgTable[] = [
  players,
  courses,
  tournaments,
  results,
  courseTraits,
  playerStrengths,
];

describe("source", () => {
  it("is exactly the three Sources and derived", () => {
    expect(source.enumValues).toEqual(["wikidata", "wikipedia", "opengolfapi", "derived"]);
  });
});

describe.each(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)] as const))(
  "%s",
  (name, config) => {
    it("carries source, source_url and derivation", () => {
      const column = (n: string) => config.columns.find((c) => c.name === n);
      expect(column("source")?.notNull).toBe(true);
      expect(column("source")?.getSQLType()).toBe("source");
      expect(column("source_url")?.notNull).toBe(false);
      expect(column("derivation")?.notNull).toBe(false);
    });

    it("declares its named Source check", () => {
      expect(config.checks.map((c) => c.name)).toContain(`${name}_source_is_recorded`);
    });
  },
);
