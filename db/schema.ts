// The tables every other part of Caddie writes into and reads out of. The words are
// CONTEXT.md's: Player, Course, Tournament, Course Trait, Player Strength, Source, Derived.
//
// Every table carries its Source, and the database, not the ingest code, is what makes that
// true. See docs/adr/0001 and 0002: a fact whose Source is unknown cannot be stored, and
// therefore cannot be displayed.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  integer,
  jsonb,
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
    country: text("country"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    turnedProfessionalYear: integer("turned_professional_year"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("players_wikidata_id_unique").on(t.wikidataId),
    check("players_wikidata_id_is_a_qid", sql`${t.wikidataId} ~ '^Q[1-9][0-9]*$'`),
    sourceIsRecorded("players", t),
  ],
);

/** One set of tees as its Source publishes it: the card a round is rated from. */
export type CourseTee = {
  name: string;
  gender: string | null;
  par: number | null;
  yardage: number | null;
  rating: number | null;
  slope: number | null;
};

/** One hole as fetched, before anyone has decided whether to believe its yardages. */
export type CourseHole = {
  number: number;
  par: number | null;
  /** Yardage by tee, keyed as the Source keys it (`member`, `The Players`). */
  yardages: Record<string, number | null>;
};

/**
 * How far, in percent, a course's hole yardages may sum from its published total before they
 * stop being believed. More than this and `holes_trusted` is false. A whole number so that the
 * check is integer arithmetic, in which JavaScript and Postgres cannot disagree at the edge.
 * The database checks the same arithmetic, so the figure appears in
 * `courses_holes_trusted_is_the_check` too.
 */
export const HOLE_YARDAGE_TOLERANCE_PERCENT = 3;

/**
 * One golf course, by its own name. It outlives any Tournament held there.
 *
 * `holes_trusted` is the contract with whatever derives Course Traits. It records whether the
 * hole-by-hole yardages, summed, agree with the published total to within
 * HOLE_YARDAGE_TOLERANCE_PERCENT. OpenGolfAPI returns member-tee holes for Augusta, 1,080 yards short
 * of the card, and a Trait built on those holes would be confidently wrong. A Trait derived
 * from hole yardages must be refused for a course where this is false.
 */
export const courses = pgTable(
  "courses",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    wikidataId: text("wikidata_id"),
    openGolfApiId: text("opengolfapi_id"),
    par: integer("par"),
    /** The course's own published total, as its Source states it. Not the sum of the holes. */
    publishedYardage: integer("published_yardage"),
    architect: text("architect"),
    tees: jsonb("tees").$type<CourseTee[]>(),
    /** Hole-by-hole par and yardage exactly as fetched, trusted or not. */
    holes: jsonb("holes").$type<CourseHole[]>(),
    /** Which of the holes' yardage keys was summed for the check. */
    holesCheckedTee: text("holes_checked_tee"),
    holesYardageSum: integer("holes_yardage_sum"),
    /** `holes_yardage_sum - published_yardage`: negative when the holes come up short. */
    holesYardageDifference: integer("holes_yardage_difference"),
    holesTrusted: boolean("holes_trusted"),
    /** The attribution the Source's licence requires, ready for a page to print as it is. */
    attribution: text("attribution"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("courses_wikidata_id_unique").on(t.wikidataId),
    uniqueIndex("courses_opengolfapi_id_unique").on(t.openGolfApiId),
    sourceIsRecorded("courses", t),
    // ODbL requires attribution, so a row from OpenGolfAPI without it cannot be stored.
    check(
      "courses_opengolfapi_is_attributed",
      sql`${t.source} <> 'opengolfapi' or (${t.attribution} is not null and btrim(${t.attribution}) <> '')`,
    ),
    // A verdict with its working, or no verdict: `holes_trusted` never stands alone.
    check(
      "courses_holes_check_is_complete",
      sql`${t.holesTrusted} is null or (
        ${t.holes} is not null
        and ${t.holesCheckedTee} is not null
        and ${t.publishedYardage} is not null
        and ${t.holesYardageSum} is not null
        and ${t.holesYardageDifference} = ${t.holesYardageSum} - ${t.publishedYardage}
      )`,
    ),
    // The verdict is the arithmetic, and the database recomputes it rather than taking the
    // ingest code's word for it. The 3 is HOLE_YARDAGE_TOLERANCE_PERCENT.
    check(
      "courses_holes_trusted_is_the_check",
      sql`${t.holesTrusted} is null or ${t.holesTrusted} = (
        abs(${t.holesYardageDifference}) * 100 <= 3 * ${t.publishedYardage}
      )`,
    ),
  ],
);

/**
 * How a Tournament's `course_name` was matched to its `courses` row, most certain first.
 *
 * - `exact`: OpenGolfAPI's name is the schedule's, character for character, in the same state.
 * - `normalised`: the same after ignoring case, punctuation, accents and generic words such as
 *   "Golf Club", in the same state, and no other course in that state reads the same.
 * - `declared`: a person read both names and wrote the pairing down, in
 *   `DECLARED_MATCHES` in lib/courses/match.ts, because normalising could not settle it.
 *
 * There is no fuzzier level. A match less certain than these is reported and left null.
 */
export const courseMatch = pgEnum("course_match", ["exact", "normalised", "declared"]);

export type CourseMatch = (typeof courseMatch.enumValues)[number];

/**
 * One event on the schedule in one season. The Course is nullable because a Tournament can
 * be scheduled before its venue is known to us, and because a match that is not certain is
 * left null rather than guessed. `courseName` is the venue as written by the Source, kept
 * whether or not it matched; `courseMatch` says how certain the match is, and is present
 * exactly when `courseId` is. `location` is the schedule's Location cell, a state or a
 * country, which a match must agree with.
 */
export const tournaments = pgTable(
  "tournaments",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    season: integer("season").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    courseName: text("course_name"),
    location: text("location"),
    courseId: integer("course_id").references(() => courses.id),
    courseMatch: courseMatch("course_match"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("tournaments_name_season_unique").on(t.name, t.season),
    check("tournaments_ends_after_it_starts", sql`${t.endDate} >= ${t.startDate}`),
    // A matched Course always says how it was matched, and nothing else claims a match.
    check(
      "tournaments_course_match_is_recorded",
      sql`(${t.courseId} is null) = (${t.courseMatch} is null)`,
    ),
    sourceIsRecorded("tournaments", t),
  ],
);

/**
 * Which kind of table a Result was read from, because the two are not equally trustworthy.
 *
 * - `leaderboard`: an event article's own full-field final leaderboard, every Player who
 *   teed off, with their round-by-round scores.
 * - `standings`: the season article's FedEx Cup standings table, which gives only the top 30
 *   Players' finishes in the majors, signature and playoff events, and no scores at all. A
 *   Player's presence there is conditioned on a good season, so these rows are a biased
 *   sample and must never be read as a field. Also the season's FedEx Cup Playoffs article,
 *   each playoff event's finishes for the Players who qualified for it, likewise with no
 *   scores; its rows' `sourceUrl` is that article, which is how they are told apart.
 */
export const resultBasis = pgEnum("result_basis", ["leaderboard", "standings"]);

export type ResultBasis = (typeof resultBasis.enumValues)[number];

/**
 * One Player's finish in one Tournament. `position` is null when the Player has no finishing
 * position, having missed the cut or withdrawn; `finish` keeps the Source's own label (`T14`,
 * `CUT`, `WD`) so the reason is not lost. A tie shares its position.
 *
 * Round scores are strokes, exactly as the leaderboard prints them, and null where it prints
 * none: a Player who missed the cut has no third round, and a standings row has no rounds at
 * all. A null is never filled in with an average, a zero or a guess, and the database refuses
 * a round score on a `standings` row outright.
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
    basis: resultBasis("basis").notNull(),
    finish: text("finish").notNull(),
    round1: integer("round_1"),
    round2: integer("round_2"),
    round3: integer("round_3"),
    round4: integer("round_4"),
    ...provenance,
  },
  (t) => [
    uniqueIndex("results_player_tournament_unique").on(t.playerId, t.tournamentId),
    check("results_position_is_positive", sql`${t.position} is null or ${t.position} >= 1`),
    check(
      "results_standings_have_no_rounds",
      sql`${t.basis} <> 'standings' or (
        ${t.round1} is null and ${t.round2} is null and ${t.round3} is null and ${t.round4} is null
      )`,
    ),
    check(
      "results_rounds_are_positive",
      sql`(${t.round1} is null or ${t.round1} >= 1)
        and (${t.round2} is null or ${t.round2} >= 1)
        and (${t.round3} is null or ${t.round3} >= 1)
        and (${t.round4} is null or ${t.round4} >= 1)`,
    ),
    check("results_finish_is_recorded", sql`btrim(${t.finish}) <> ''`),
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
 * The fewest results a Player Strength may rest on and still be stated as a number. The
 * reasoning is beside `MINIMUM_SAMPLE` in lib/strengths/derive.ts, which is this figure; the
 * database checks the same arithmetic, so it appears in
 * `player_strengths_value_needs_minimum_sample` too.
 */
export const STRENGTH_MINIMUM_SAMPLE = 5;

/**
 * One measurable characteristic of a Player's game. Always Derived, computed here from
 * scoring data, never copied from anyone's published rating: the table refuses any other
 * Source.
 *
 * `value` is null when the Strength rests on too few results to state: "no record" is a
 * stored answer, not a missing row. `sample_size` is the number of results it rests on, and
 * is there whether or not `value` is, because the page shows it beside every Strength.
 */
export const playerStrengths = pgTable(
  "player_strengths",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    strength: text("strength").notNull(),
    value: doublePrecision("value"),
    sampleSize: integer("sample_size").notNull(),
    ...provenance,
  },
  (t) => [
    uniqueIndex("player_strengths_player_strength_unique").on(t.playerId, t.strength),
    check("player_strengths_are_derived", sql`${t.source} = 'derived'`),
    check("player_strengths_sample_size_is_not_negative", sql`${t.sampleSize} >= 0`),
    // The 5 is STRENGTH_MINIMUM_SAMPLE: below it, a number would be noise, and is refused.
    check(
      "player_strengths_value_needs_minimum_sample",
      sql`${t.value} is null or ${t.sampleSize} >= 5`,
    ),
    sourceIsRecorded("player_strengths", t),
  ],
);
