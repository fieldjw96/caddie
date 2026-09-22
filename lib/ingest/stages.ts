// The production ingest, in the order it must run. Each stage reads what the ones before it
// stored, so the order is the dependency graph written flat:
//
// - migrate first, so a schema change that merged is applied before anything writes to it;
// - schedule before courses, which match the Course names it stored;
// - players before results, which match names against players and never create one;
// - courses before course facts and course traits, which add to and derive from its rows;
// - results before strengths, which are derived from them, and last because they also read
//   the next Tournament's Course;
// - and a report last, which counts what they stored.
//
// .github/workflows/ingest.yml runs exactly these, one step each, in this order, and
// lib/ingest/workflow.test.ts fails if the two drift apart.

export type Stage = {
  /** What the workflow calls this stage, in its step name and in a failure. */
  name: string;
  /** The package.json script it runs. */
  script: string;
};

export const STAGES: readonly Stage[] = [
  { name: "migrate", script: "db:migrate" },
  { name: "schedule", script: "ingest:schedule" },
  { name: "players", script: "ingest:players" },
  { name: "courses", script: "ingest:courses" },
  { name: "course facts", script: "ingest:course-facts" },
  { name: "results", script: "ingest:results" },
  { name: "course traits", script: "derive:course-traits" },
  { name: "strengths", script: "derive:strengths" },
  // Not an ingest: counts what the ones above left, and fails on an empty table.
  { name: "report", script: "ingest:report" },
];
