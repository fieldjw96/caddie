// `npm run snapshot:osm-courses` rewrites data/osm-course-holes.json from OpenStreetMap. Run by a
// person, now and then, when a venue is added below or the map has improved: it is not an ingest
// stage. Overpass's public server asks automated users to run their own, and it spent the day
// this was written refusing requests at capacity, so a daily job would fail for reasons of its
// own to save re-reading pars that barely change. See ADR 0005.
//
// Each Course is named by its OpenStreetMap id because a person checked it. Most Courses that
// need this are unnamed or differently named on the map, and the wrong Course's pars would pass
// every check there is. A failed request leaves that Course's previous entry in place.

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { centre, readPars, type OsmHole, type Point } from "../lib/courses/osm-holes";

const OUTPUT = "data/osm-course-holes.json";
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** The stored Course's name, and the outline on the map a person checked it against. */
const COURSES: readonly { courseName: string; osm: string }[] = [
  // Unnamed on the map. Published coordinates for El Cardonal (22.9015, -109.985) fall inside
  // this outline, and those for Diamante's other course inside its neighbour, way/775852161.
  { courseName: "El Cardonal", osm: "way/775852162" },
  { courseName: "Port Royal Golf Course", osm: "way/174882622" },
];

const point = z.object({ lat: z.number(), lon: z.number() });

const element = z.object({
  type: z.string(),
  id: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
  geometry: z.array(point).optional(),
  members: z
    .array(z.object({ role: z.string(), geometry: z.array(point).optional() }))
    .optional(),
});

const answer = z.object({ elements: z.array(element) });

const USER_AGENT = "Caddie/0.1 (+https://github.com/fieldjw96/caddie) osm-snapshot";

async function overpass(query: string): Promise<z.infer<typeof answer>> {
  let last: unknown;
  let wait = 5_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]!;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return answer.parse(await response.json());
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(wait * 2, 60_000);
    }
  }
  throw new Error(`Overpass did not answer: ${String(last)}`);
}

function outlineOf(course: z.infer<typeof element>): Point[][] {
  if (course.geometry) return [course.geometry];
  return (course.members ?? [])
    .filter((m) => m.role === "outer" && m.geometry)
    .map((m) => m.geometry!);
}

async function readCourse(courseName: string, osm: string) {
  const [type, id] = osm.split("/");
  const outlines = await overpass(`[out:json][timeout:45];${type}(${id});out tags geom;`);
  const course = outlines.elements[0];
  if (!course) throw new Error(`${osm} is not on the map`);
  const outline = outlineOf(course);
  const points = outline.flat();
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const box = `${Math.min(...lats)},${Math.min(...lons)},${Math.max(...lats)},${Math.max(...lons)}`;
  const found = await overpass(
    `[out:json][timeout:45];way["golf"="hole"](${box});out tags geom;`,
  );
  const holes: OsmHole[] = found.elements.map((e) => ({
    ref: e.tags?.ref,
    par: e.tags?.par,
    geometry: e.geometry ?? [],
  }));
  const middle = centre(outline);
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return {
    courseName,
    osm,
    latitude: round(middle.lat),
    longitude: round(middle.lon),
    pars: readPars(holes, outline),
  };
}

async function main() {
  const previous = JSON.parse(readFileSync(OUTPUT, "utf8")) as {
    courses: { courseName: string }[];
  };
  const courses: unknown[] = [];
  for (const { courseName, osm } of COURSES) {
    try {
      const read = await readCourse(courseName, osm);
      courses.push(read);
      console.log(
        `  ok    ${courseName}: ${read.pars ? `par ${read.pars.reduce((a, b) => a + b, 0)}` : "no full 18"}`,
      );
    } catch (error) {
      console.log(`  miss  ${courseName}: ${String(error)}`);
      const kept = previous.courses.find((c) => c.courseName === courseName);
      if (kept) courses.push(kept);
    }
  }
  writeFileSync(
    OUTPUT,
    `${JSON.stringify(
      {
        licence: "ODbL-1.0",
        attribution: "© OpenStreetMap contributors",
        readOn: new Date().toISOString().slice(0, 10),
        courses,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
