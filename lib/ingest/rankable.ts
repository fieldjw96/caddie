// Whether the next Tournament can be ranked, as a pure decision over what the earlier ingest
// stages have already stored. Three ways a run can finish healthy everywhere and still be
// unrankable: no `courses` row is matched to the next Tournament; its Course is matched but has
// no Course Trait; or no Player anywhere has any Strength. Any one of them means the ranking
// page renders zero Player rows, which is the one thing this product cannot ship, so each one
// is a failure rather than a note in the report.
//
// Pure: scripts/ingest-rankable.ts gathers the counts this reads from the database and prints
// the verdict; this file only decides it, so each of the three cases is one test away from the
// passing one, and none of them needs a database to check.

export type NextTournament = {
  name: string;
  /** The Course name as the schedule's own Source recorded it, whether or not it matched. */
  courseName: string | null;
  /**
   * The matched `courses` row id, resolved the same way lib/page/data.ts's `matchCourse`
   * resolves it for rendering: `tournaments.courseId` where stored, otherwise the row whose
   * name matches `courseName` exactly, ignoring case and spacing. The caller must resolve it
   * that way rather than passing the raw stored column, or this can fail a Tournament the
   * page would actually render fine.
   */
  courseId: number | null;
};

export type RankableInput = {
  /** The Tournament whose start date is soonest, or null once the season has none left. */
  next: NextTournament | null;
  /** Course Traits stored for `next.courseId`. Irrelevant, and ignored, when it is null. */
  courseTraitCount: number;
  /** Whether any Player anywhere has a non-null Strength of any kind. */
  anyPlayerHasStrength: boolean;
};

export type RankableResult = { ok: true } | { ok: false; reason: string };

export function checkRankable(input: RankableInput): RankableResult {
  const { next } = input;

  // Nothing is scheduled to rank, which is a real off-season state, not a broken one: it is
  // out of scope here and already reported in plain words by derive:strengths.
  if (next === null) return { ok: true };

  if (next.courseId === null) {
    if (next.courseName === null) {
      return {
        ok: false,
        reason:
          `Next Tournament: ${next.name}. The schedule recorded no Course name for it at ` +
          "all, so none can be matched to a `courses` row. That is the condition that " +
          "renders zero Player rows: find why `npm run ingest:schedule` read no venue for " +
          "this Tournament.",
      };
    }
    return {
      ok: false,
      reason:
        `Next Tournament: ${next.name}. Its Course, ${next.courseName} as the schedule ` +
        "recorded it, is not matched to a `courses` row. That is the condition that " +
        `renders zero Player rows: match ${next.courseName} to a \`courses\` row (\`npm run ` +
        "ingest:courses` matches it by this name) before the next run.",
    };
  }

  if (input.courseTraitCount === 0) {
    return {
      ok: false,
      reason:
        `Next Tournament: ${next.name}. Its Course is matched but has no Course Trait, so ` +
        "there is nothing to weight a Fit Score against and the ranking renders zero Player " +
        "rows. Run `npm run ingest:course-facts` then `npm run derive:course-traits` for " +
        "this Course, or find why the first found nothing for it.",
    };
  }

  if (!input.anyPlayerHasStrength) {
    return {
      ok: false,
      reason:
        `Next Tournament: ${next.name}. No Player has any Strength, so none can be ranked ` +
        "at any Course. Check that `npm run ingest:results` is storing this season's " +
        "results and that `npm run derive:strengths` is deriving from them.",
    };
  }

  return { ok: true };
}
