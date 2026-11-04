// Reads one Course's holes off OpenStreetMap's answer. Pure, so every rule is testable from a
// fixture; scripts/snapshot-osm-courses.ts does the asking.
//
// A hole belongs to a Course when its middle is inside that Course's outline, because a bounding
// box alone mixes neighbours: Hurstbourne's holes come back with Oxmoor's. Its pars are read only
// when the outline holds one complete 18: each number once, each with a par. Anything less is no
// card at all, because a partial or mixed set would fail the par check downstream at best.

export interface Point {
  lat: number;
  lon: number;
}

export interface OsmHole {
  /** The mapper's hole number: `7`, or `7/18` where a club also has a nine. */
  ref: string | undefined;
  par: string | undefined;
  geometry: readonly Point[];
}

/** The standard ray cast, against each ring: an odd number of crossings is inside. */
export function isInside(point: Point, rings: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      const crosses =
        a.lat > point.lat !== b.lat > point.lat &&
        point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
      if (crosses) inside = !inside;
    }
  }
  return inside;
}

/** The hole number a ref gives on an 18, or null for a ref on a shorter loop or none at all. */
function holeNumber(ref: string | undefined): number | null {
  const match = /^(\d{1,2})(?:\/18)?$/.exec(ref?.trim() ?? "");
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= 18 ? number : null;
}

/** Par by hole, first to eighteenth, or null unless the outline holds exactly one full 18. */
export function readPars(
  holes: readonly OsmHole[],
  outline: readonly (readonly Point[])[],
): number[] | null {
  const pars = new Map<number, number>();
  for (const hole of holes) {
    const middle = hole.geometry[Math.floor(hole.geometry.length / 2)];
    if (!middle || !isInside(middle, outline)) continue;
    const number = holeNumber(hole.ref);
    if (number === null) continue;
    if (pars.has(number)) return null;
    const par = Number(hole.par);
    if (!Number.isInteger(par) || par < 3 || par > 6) return null;
    pars.set(number, par);
  }
  if (pars.size !== 18) return null;
  return Array.from({ length: 18 }, (_, i) => pars.get(i + 1)!);
}

/** The middle of an outline's bounds, which is what the elevation model is read at. */
export function centre(outline: readonly (readonly Point[])[]): Point {
  const points = outline.flat();
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}
