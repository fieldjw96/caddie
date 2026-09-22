// The tables every other part of Caddie writes into and reads out of. The words are
// CONTEXT.md's: Player, Course, Tournament, Course Trait, Player Strength, Source, Derived.
//
// Every table carries its Source, and the database, not the ingest code, is what makes that
// true. See docs/adr/0001 and 0002: a fact whose Source is unknown cannot be stored, and
// therefore cannot be displayed.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Where one fact came from. Three Sources we have the right to publish, and `derived` for
 * anything this repo computed itself. That is the whole vocabulary: adding a value here is
 * adding a Source, which needs an ADR amending 0001.
 */
export const source = pgEnum("source", ["wikidata", "wikipedia", "opengolfapi", "derived"]);

export type Source = (typeof source.enumValues)[number];

/**
 * The provenance columns every table carries. An ingested row records the URL a reader can
 * follow, because CC BY-SA and ODbL both require attribution. A Derived row records instead
 * what it was derived from.
 */
const provenance = {
  source: source("source").notNull(),
  sourceUrl: text("source_url"),
  derivation: text("derivation"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * The check that turns the Source rule from aspiration into fact. Named per table, so a
 * violation reports `players_source_is_recorded` rather than an anonymous constraint.
 *
 * Blank means blank after trimming: a URL of " " attributes nothing.
 */
function sourceIsRecorded(
  table: string,
  columns: { source: AnyPgColumn; sourceUrl: AnyPgColumn; derivation: AnyPgColumn },
) {
  return check(
    `${table}_source_is_recorded`,
    sql`(
      ${columns.source} = 'derived'
      and ${columns.derivation} is not null
      and btrim(${columns.derivation}) <> ''
      and ${columns.sourceUrl} is null
    ) or (
      ${columns.source} <> 'derived'
      and ${columns.sourceUrl} is not null
      and btrim(${columns.sourceUrl}) <> ''
    )`,
  );
}

/** One professional golfer, identified by their Wikidata item. */
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    /** The Wikidata item, `Q` and digits. The identity every other Source is matched to. */
    wikidataId: text("wikidata_id").notNull(),
    name: text("name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    ...provenance,
  },
  (t) => [
    uniqueIndex("players_wikidata_id_unique").on(t.wikidataId),
    check("players_wikidata_id_is_a_qid", sql`${t.wikidataId} ~ '^Q[1-9][0-9]*$'`),
    sourceIsRecorded("players", t),
  ],
);

/** One golf course, by its own name. It outlives any Tournament held there. */
export const courses = pgTable(
  "courses",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    wikidataId: text("wikidata_id"),
    openGolfApiId: text("opengolfapi_id"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("courses_wikidata_id_unique").on(t.wikidataId),
    uniqueIndex("courses_opengolfapi_id_unique").on(t.openGolfApiId),
    sourceIsRecorded("courses", t),
  ],
);

/**
 * One event on the schedule in one season. The Course is nullable because a Tournament can
 * be scheduled before its venue is known to us.
 */
export const tournaments = pgTable(
  "tournaments",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    season: integer("season").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    courseId: integer("course_id").references(() => courses.id),
    ...provenance,
  },
  (t) => [
    uniqueIndex("tournaments_name_season_unique").on(t.name, t.season),
    check("tournaments_ends_after_it_starts", sql`${t.endDate} >= ${t.startDate}`),
    sourceIsRecorded("tournaments", t),
  ],
);

/**
 * One Player's finish in one Tournament. `position` is null when the Player has no finishing
 * position, having missed the cut or withdrawn. A tie shares its position.
 */
export const results = pgTable(
  "results",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    position: integer("position"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("results_player_tournament_unique").on(t.playerId, t.tournamentId),
    check("results_position_is_positive", sql`${t.position} is null or ${t.position} >= 1`),
    sourceIsRecorded("results", t),
  ],
);

/**
 * One measurable characteristic of a Course: a fact about the Course, never a judgement
 * about who it suits. `trait` names it (`length_yards`, `par`), `unit` says what `value` is.
 */
export const courseTraits = pgTable(
  "course_traits",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    trait: text("trait").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    ...provenance,
  },
  (t) => [
    uniqueIndex("course_traits_course_trait_unique").on(t.courseId, t.trait),
    sourceIsRecorded("course_traits", t),
  ],
);

/**
 * One measurable characteristic of a Player's game. Always Derived, computed here from
 * scoring data, never copied from anyone's published rating: the table refuses any other
 * Source.
 */
export const playerStrengths = pgTable(
  "player_strengths",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    strength: text("strength").notNull(),
    value: doublePrecision("value").notNull(),
    ...provenance,
  },
  (t) => [
    uniqueIndex("player_strengths_player_strength_unique").on(t.playerId, t.strength),
    check("player_strengths_are_derived", sql`${t.source} = 'derived'`),
    sourceIsRecorded("player_strengths", t),
  ],
);
