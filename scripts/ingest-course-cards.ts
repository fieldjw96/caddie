// `npm run ingest:course-cards` gives a Course OpenGolfAPI has no holes for its card, from a card
// declared by hand or from the committed OpenStreetMap snapshot, and takes the coordinates of a
// Course that has none from that snapshot. The rules are lib/courses/cards.ts's; this is the
// database plumbing around them. Makes no request, so it cannot fail for anyone else's reasons.
//
// A Course named in the data but not stored is reported rather than failing the run: the name
// is the schedule's, and it changing should cost that Course its card, not the day's ingest.
//
// Idempotent: storing the same card twice writes the same row.

import { eq } from "drizzle-orm";
import { client, db } from "../db/migration-client";
import { courses } from "../db/schema";
import { DECLARED_CARDS, loadOsmCourses, planCourseCard } from "../lib/courses/cards";

async function main(): Promise<void> {
  try {
    const osm = loadOsmCourses();
    const rows = await db
      .select({
        id: courses.id,
        name: courses.name,
        publishedYardage: courses.publishedYardage,
        holes: courses.holes,
        holesSource: courses.holesSource,
        latitude: courses.latitude,
      })
      .from(courses);

    let cards = 0;
    for (const row of rows) {
      const plan = planCourseCard(row, DECLARED_CARDS, osm);
      if (plan === null) continue;
      await db
        .update(courses)
        .set({ ...plan.card, ...plan.coordinates })
        .where(eq(courses.id, plan.courseId));
      if (plan.card?.holesSource) cards += 1;
      const card =
        plan.card === null
          ? "no card"
          : plan.card.holesSource === null
            ? "card taken away, its entry has gone"
            : `card from ${plan.card.holesSource}`;
      const where = plan.coordinates === null ? "" : ", coordinates from openstreetmap";
      console.log(`  ok    ${plan.name}: ${card}${where}`);
    }

    const storedNames = new Set(rows.map((r) => r.name));
    const named = [
      ...DECLARED_CARDS.map((c) => c.courseName),
      ...osm.map((c) => c.courseName),
    ];
    for (const name of new Set(named)) {
      if (!storedNames.has(name))
        console.log(`  miss  ${name}: no stored Course has this name`);
    }
    console.log(`\n${cards} of ${rows.length} Courses have a card from this stage.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
