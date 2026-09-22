// OpenGolfAPI's responses, parsed at the boundary. Only the fields this repo reads are
// declared; anything else the API sends is dropped here rather than reaching a row.
//
// Shapes are as observed on the wire on 2026-09-21, not as documented. Not read, deliberately:
//   - `insights`, which is unreliable: TPC Sawgrass returns `water_holes: 0`.
//   - every piece of hole geometry (`tee_coords`, `green`, `green_polygon`, `dogleg`,
//     `elevation`, `plays_like_yards`, `hazards`), which is null for all 18 holes on the free
//     tier whatever the documentation implies.

import { z } from "zod";

/**
 * The licence every response is issued under. Pinned rather than read: if it ever changes,
 * our right to publish has changed with it, and ingesting must stop until an ADR says what
 * the new licence permits.
 */
export const OPENGOLFAPI_LICENCE = "ODbL-1.0";

const yards = z.number().int().nonnegative();

/** `GET /v1/courses/search?q=&state=`. */
export const searchResponse = z.object({
  courses: z.array(
    z.object({
      id: z.string().min(1),
      course_name: z.string().min(1),
      city: z.string().nullable(),
      state: z.string().nullable(),
    }),
  ),
  /** How many courses matched, of which `courses` is the first page: at most 20. */
  total: z.number().int().nonnegative(),
  _license: z.literal(OPENGOLFAPI_LICENCE),
  /** The attribution ODbL requires, in the words OpenGolfAPI asks for. */
  _attribution: z.string().trim().min(1),
});

export type SearchResponse = z.infer<typeof searchResponse>;

const tee = z.object({
  tee_name: z.string().min(1),
  gender: z.string().nullable(),
  course_rating: z.number().positive().nullable(),
  slope: z.number().int().positive().nullable(),
  par: z.number().int().positive().nullable(),
  yardage: yards.nullable(),
});

const hole = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6).nullable(),
  // Keyed by tee name, and the keys differ per course: `member`, `The Players`, `blue`.
  yardages: z.record(z.string(), yards.nullable()).nullable(),
});

/**
 * `GET /api/v1/courses/:id`. The `/v1/courses/:id` route returns a truncated record with no
 * tees or yardage, and says so in its own `_upgrade` field; this one is the full record.
 */
export const courseResponse = z.object({
  id: z.string().min(1),
  course_name: z.string().min(1),
  par: z.number().int().positive().nullable(),
  /** The course's published total yardage. Checked against the holes, never replaced by them. */
  yardage: yards.nullable(),
  architect: z.string().nullable(),
  tees: z.array(tee).nullable(),
  holes_data: z.array(hole).nullable(),
});

export type CourseResponse = z.infer<typeof courseResponse>;

/**
 * A response that did not have the shape we parse. The message names every field that failed,
 * by path, so that a change at OpenGolfAPI reads as `holes_data.3.par: ...` rather than as an
 * `undefined` three layers further in.
 */
export class ShapeError extends Error {
  constructor(what: string, error: z.ZodError) {
    const fields = error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    super(`${what} did not have the expected shape. ${fields}`);
    this.name = "ShapeError";
  }
}

export function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ShapeError(what, result.error);
  return result.data;
}
