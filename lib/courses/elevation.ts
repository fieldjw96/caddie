// Reads a Course's altitude off the Copernicus elevation model (GLO-90), through Open-Meteo's
// free elevation API. The one place this repo calls that API. See ADR 0005.
//
// One reading at one point on a grid about 90 metres square, so this is good to the nearest
// few tens of feet and no better: enough to say how thin the air is, which is all a Trait asks
// of it. The page says "about" for that reason. Wikipedia's figure, where an article states
// one, is preferred, and this only fills the gap it leaves.

import { z } from "zod";

export const OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

/** How many points this asks Open-Meteo to read in one request. */
export const POINTS_PER_REQUEST = 100;

const METRES_TO_FEET = 3.28084;

/** Below the Dead Sea or above any course on Earth: the model's no-data value, not a reading. */
const plausibleMetres = z.number().min(-450).max(5000);

const elevationResponse = z.object({ elevation: z.array(plausibleMetres) });

export interface CourseToLocate {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export type AltitudeOutcome =
  | { status: "read"; courseId: number; name: string; altitudeFeet: number; sourceUrl: string }
  | { status: "unread"; courseId: number; name: string; reason: string };

/** The request that reads these points: kept as the fact's Source, so a reader can repeat it. */
export function elevationUrl(
  points: readonly { latitude: number; longitude: number }[],
): string {
  const join = (key: "latitude" | "longitude") => points.map((p) => p[key]).join(",");
  return `${OPEN_METEO_ELEVATION_URL}?latitude=${join("latitude")}&longitude=${join("longitude")}`;
}

/**
 * Reads every Course, in batches. A batch that fails costs only its own Courses, which are
 * reported and keep whatever they had: the next day's run asks again.
 */
export async function readCourseAltitudes(
  stored: readonly CourseToLocate[],
  fetchFn: typeof fetch = fetch,
): Promise<AltitudeOutcome[]> {
  const outcomes: AltitudeOutcome[] = [];
  for (let start = 0; start < stored.length; start += POINTS_PER_REQUEST) {
    const batch = stored.slice(start, start + POINTS_PER_REQUEST);
    try {
      const response = await fetchFn(elevationUrl(batch));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { elevation } = elevationResponse.parse(await response.json());
      if (elevation.length !== batch.length) {
        throw new Error(`asked for ${batch.length} points, got ${elevation.length}`);
      }
      batch.forEach((course, i) => {
        outcomes.push({
          status: "read",
          courseId: course.id,
          name: course.name,
          altitudeFeet: Math.round(elevation[i]! * METRES_TO_FEET),
          sourceUrl: elevationUrl([course]),
        });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const course of batch) {
        outcomes.push({ status: "unread", courseId: course.id, name: course.name, reason });
      }
    }
  }
  return outcomes;
}
