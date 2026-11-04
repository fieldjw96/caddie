// Where a Course OpenGolfAPI has no holes for gets its card. Pure: given what is stored, a
// card declared by hand and a snapshot of OpenStreetMap, this says what to write. See ADR 0005.
//
// In order of preference: OpenGolfAPI's own holes, which nothing here ever replaces; a card a
// person declared below; then OpenStreetMap's pars.
//
// OpenStreetMap supplies pars and no yardages. A golf=hole line is drawn by a mapper from tee to
// green, and at Waialae it read 525 yards for a hole on a course whose total came out only 1.4%
// over. A sum check would pass that and `longest_par_4_yards` would then state the error as a
// fact, so its holes carry no yardages at all and `holes_trusted` stays null. Their pars still
// have to pass the par check in lib/course-traits.ts, against the par the Course already has.

import { z } from "zod";
import type { CourseHole, Source } from "../../db/schema";
import { checkHoles } from "../opengolfapi/holes";
import snapshot from "../../data/osm-course-holes.json";

/** One hole of a declared card, as `[par, yards]`. */
type DeclaredHole = readonly [par: number, yards: number];

export interface DeclaredCard {
  /** The stored Course, by its `courses.name`. */
  courseName: string;
  /** The page a person read this off, which the site links to. */
  sourceUrl: string;
  /** What the card calls the tee whose yardages these are. */
  tee: string;
  holes: readonly DeclaredHole[];
}

/**
 * Cards entered by hand. ADR 0005 is why this exists and why it is not a general mechanism: this
 * is not an open Source, each entry is an exception somebody decided on, and an entry should go
 * once an open Source holds the Course.
 */
export const DECLARED_CARDS: readonly DeclaredCard[] = [
  {
    courseName: "El Cardonal",
    sourceUrl:
      "https://www.golfpass.com/travel-advisor/courses/34981-diamante-cabo-san-lucas-el-cardonal-course/scorecard-and-layout",
    tee: "Tee I",
    holes: [
      [5, 541],
      [3, 208],
      [4, 351],
      [4, 483],
      [4, 438],
      [5, 601],
      [4, 489],
      [4, 474],
      [3, 200],
      [4, 344],
      [3, 189],
      [4, 401],
      [4, 475],
      [5, 554],
      [4, 462],
      [3, 154],
      [4, 462],
      [5, 537],
    ],
  },
];

const osmCourse = z.object({
  courseName: z.string().min(1),
  /** `way/123` or `relation/123`, which the Course's card links to. */
  osm: z.string().regex(/^(way|relation)\/[1-9][0-9]*$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Par by hole, first to eighteenth, or null when the map does not hold a full 18. */
  pars: z.array(z.number().int().min(3).max(6)).length(18).nullable(),
});

export type OsmCourse = z.infer<typeof osmCourse>;

const osmSnapshot = z.object({
  licence: z.literal("ODbL-1.0"),
  attribution: z.string().min(1),
  readOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  courses: z.array(osmCourse),
});

/** The committed snapshot, parsed: a hand-edit that breaks its shape fails here, by field. */
export function loadOsmCourses(): OsmCourse[] {
  return osmSnapshot.parse(snapshot).courses;
}

export function osmUrl(course: Pick<OsmCourse, "osm">): string {
  return `https://www.openstreetmap.org/${course.osm}`;
}

/** The stored columns the plan reads. */
export interface StoredCourseCard {
  id: number;
  name: string;
  publishedYardage: number | null;
  holes: CourseHole[] | null;
  holesSource: Source | null;
  latitude: number | null;
}

/** The columns a card occupies, all null once it has been taken away. */
const NO_CARD = {
  holes: null,
  holesSource: null,
  holesSourceUrl: null,
  holesCheckedTee: null,
  holesYardageSum: null,
  holesYardageDifference: null,
  holesTrusted: null,
} as const;

/** What to write to one Course, each part present only where there is something to write. */
export interface CourseCardUpdate {
  courseId: number;
  name: string;
  card:
    | {
        holes: CourseHole[];
        holesSource: "declared" | "openstreetmap";
        holesSourceUrl: string;
        holesCheckedTee: string | null;
        holesYardageSum: number | null;
        holesYardageDifference: number | null;
        holesTrusted: boolean | null;
      }
    | typeof NO_CARD
    | null;
  coordinates: {
    latitude: number;
    longitude: number;
    coordinatesSource: "openstreetmap";
    coordinatesSourceUrl: string;
  } | null;
}

function declaredHoles(card: DeclaredCard): CourseHole[] {
  return card.holes.map(([par, yards], i) => ({
    number: i + 1,
    par,
    yardages: { [card.tee]: yards },
  }));
}

function parsOnly(pars: readonly number[]): CourseHole[] {
  return pars.map((par, i) => ({ number: i + 1, par, yardages: {} }));
}

/**
 * The write one Course needs, or null when it needs none. A card already written by this stage
 * is written again, because the card or the published total may have changed since; holes that
 * are the row's own never are. A card whose entry has gone is taken away: deleting an entry is
 * how ADR 0005 answers an objection, so deleting it has to reach the page.
 */
export function planCourseCard(
  course: StoredCourseCard,
  declared: readonly DeclaredCard[],
  osm: readonly OsmCourse[],
): CourseCardUpdate | null {
  const mapped = osm.find((c) => c.courseName === course.name) ?? null;
  const ownHoles = course.holes !== null && course.holesSource === null;
  const hand = declared.find((c) => c.courseName === course.name) ?? null;

  let card: CourseCardUpdate["card"] = null;
  if (!ownHoles && hand !== null) {
    const holes = declaredHoles(hand);
    const check = checkHoles(holes, null, course.publishedYardage);
    card = {
      holes,
      holesSource: "declared",
      holesSourceUrl: hand.sourceUrl,
      holesCheckedTee: check?.tee ?? null,
      holesYardageSum: check?.sum ?? null,
      holesYardageDifference: check?.difference ?? null,
      holesTrusted: check?.trusted ?? null,
    };
  } else if (!ownHoles && mapped?.pars) {
    card = {
      holes: parsOnly(mapped.pars),
      holesSource: "openstreetmap",
      holesSourceUrl: osmUrl(mapped),
      holesCheckedTee: null,
      holesYardageSum: null,
      holesYardageDifference: null,
      holesTrusted: null,
    };
  } else if (course.holesSource !== null) {
    card = NO_CARD;
  }

  const coordinates: CourseCardUpdate["coordinates"] =
    course.latitude === null && mapped !== null
      ? {
          latitude: mapped.latitude,
          longitude: mapped.longitude,
          coordinatesSource: "openstreetmap",
          coordinatesSourceUrl: osmUrl(mapped),
        }
      : null;

  if (card === null && coordinates === null) return null;
  return { courseId: course.id, name: course.name, card, coordinates };
}
