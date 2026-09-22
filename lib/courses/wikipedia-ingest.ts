// Reads altitude and green surface off every stored Course's own Wikipedia article. One
// request per Course, at the module-wide one-a-second throttle lib/schedule/wikipedia.ts
// already enforces for every caller. Nothing is written here; the caller decides what to do
// with an outcome.
//
// A Course whose article cannot be found or whose infobox has neither field is expected, not
// exceptional: see the Ticket's own notes on how inconsistent these articles are. One Course
// failing never stops the run.

import { extractCourseFacts } from "./wikipedia-facts";
import { fetchIntro, revisionUrl } from "../schedule/wikipedia";

/** The stored Course this ingest needs: enough to look its article up and write its facts back. */
export interface CourseToRead {
  id: number;
  name: string;
}

export type CourseFactsOutcome =
  | {
      status: "read";
      courseId: number;
      name: string;
      altitudeFeet: number | null;
      greenSurface: string | null;
      sourceUrl: string;
    }
  | { status: "no-article"; courseId: number; name: string; reason: string };

/**
 * Reads one Course's article by its own stored name, following redirects, and pulls out
 * whichever of altitude and green surface its infobox carries. A Course with no article under
 * that name, or whose article could not be read, is reported rather than thrown: the run
 * carries on to the rest.
 */
export async function fetchCourseFacts(
  courses: readonly CourseToRead[],
): Promise<CourseFactsOutcome[]> {
  const outcomes: CourseFactsOutcome[] = [];
  for (const course of courses) {
    try {
      const article = await fetchIntro(course.name);
      const facts = extractCourseFacts(article.wikitext);
      outcomes.push({
        status: "read",
        courseId: course.id,
        name: course.name,
        ...facts,
        sourceUrl: revisionUrl(article.title, article.revid),
      });
    } catch (error) {
      outcomes.push({
        status: "no-article",
        courseId: course.id,
        name: course.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}
