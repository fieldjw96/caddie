// Reads altitude and green surface off every stored Course's own Wikipedia article. One
// request per Course for the exact-title attempt, and one more when that misses and a search
// fallback finds a confident match — both at the module-wide one-a-second throttle
// lib/schedule/wikipedia.ts already enforces for every caller. Nothing is written here; the
// caller decides what to do with an outcome.
//
// The title tried is the Wikipedia-native facility name lib/courses/wikipedia-name.ts derives
// from the schedule's own Course name, never OpenGolfAPI's reconstructed one — see that
// module's comment for why. A Course whose article cannot be found, confidently, under either
// name is expected, not exceptional: see the Ticket's own notes on how inconsistent these
// articles are. One Course failing never stops the run.

import {
  MissingArticleError,
  fetchIntro,
  revisionUrl,
  searchArticles,
} from "../schedule/wikipedia";
import { confidentArticle } from "./wikipedia-name";
import { extractCourseFacts } from "./wikipedia-facts";

/**
 * The stored Course this ingest needs: enough to look its article up and write its facts back.
 * `wikipediaName` is the facility name the schedule's own Course name resolves to (null when
 * the schedule named no Course for it, or named several with none disambiguated); `name` is
 * OpenGolfAPI's, kept only to label output and as search text when nothing better is known.
 */
export interface CourseToRead {
  id: number;
  name: string;
  wikipediaName: string | null;
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

interface Article {
  title: string;
  revid: number;
  wikitext: string;
}

/**
 * The Course's own article: `wikipediaName` fetched exactly, following redirects, when it is
 * known; otherwise, or when that title does not exist, a MediaWiki search for whichever of
 * `wikipediaName` and OpenGolfAPI's `name` is known, accepted only when exactly one result
 * reads confidently as the same Course. Throws with a reason a person can read when neither
 * finds anything to trust — a wrong article is worse than no article, so nothing here guesses.
 */
async function resolveArticle(course: CourseToRead): Promise<Article> {
  if (course.wikipediaName !== null) {
    try {
      return await fetchIntro(course.wikipediaName);
    } catch (error) {
      if (!(error instanceof MissingArticleError)) throw error;
    }
  }

  const query = course.wikipediaName ?? course.name;
  const results = await searchArticles(query);
  const confidence = confidentArticle(query, results);
  if (confidence.status !== "confident") {
    throw new Error(
      confidence.titles.length === 0
        ? `search for "${query}" found nothing`
        : `search for "${query}" found no single confident match, only: ${confidence.titles.join(", ")}`,
    );
  }
  return await fetchIntro(confidence.title);
}

/**
 * Reads one Course's article, pulling out whichever of altitude and green surface its infobox
 * carries. A Course whose article could not be found, confidently, is reported rather than
 * thrown: the run carries on to the rest.
 */
export async function fetchCourseFacts(
  courses: readonly CourseToRead[],
): Promise<CourseFactsOutcome[]> {
  const outcomes: CourseFactsOutcome[] = [];
  for (const course of courses) {
    try {
      const article = await resolveArticle(course);
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
