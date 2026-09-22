// The Wikipedia-native name to look a Course's own article up by, and how confidently a
// MediaWiki search result can stand in for it when no exact title is known. Both read from
// what lib/courses/match.ts already derives from the schedule's own Course name — never
// OpenGolfAPI's reconstructed name, which title-cases itself differently from Wikipedia and is
// why the lookup this exists for missed 23 of 31 Courses. Pure: nothing here fetches anything,
// so both are tested from fixtures.

import { declaredFor, distinctiveWords, scheduledCourses, searchQueries } from "./match";

/**
 * The facility a Tournament's schedule Course name names, as Wikipedia would title it: the
 * club or resort itself, not OpenGolfAPI's "club + course" composite. `{{Infobox golf
 * facility}}` lives on the facility's own article, so this is what a Course's altitude and
 * green surface are read from.
 *
 * A schedule name naming one club resolves to it outright. One naming several — an event
 * played over more than one course — resolves only when a `DECLARED_MATCHES` pairing exists
 * for it and exactly one of the clubs listed is the one that pairing's `query` names: the same
 * disambiguation a person already made once for OpenGolfAPI matching, read back rather than
 * repeated. Anything looser returns null rather than guessing which of several clubs is meant.
 */
export function wikipediaFacilityName(scheduleCourseName: string): string | null {
  const clubs = [...new Set(scheduledCourses(scheduleCourseName).map((c) => c.club))];
  if (clubs.length === 1) return clubs[0]!;
  const declared = declaredFor(scheduleCourseName);
  if (!declared) return null;
  const matching = clubs.filter((club) => searchQueries(club).includes(declared.query));
  return matching.length === 1 ? matching[0]! : null;
}

/** One page a MediaWiki search returned, reduced to what confidence reads. */
export type SearchHit = { title: string };

export type ArticleConfidence =
  { status: "confident"; title: string } | { status: "unconfident"; titles: string[] };

/**
 * Whether exactly one of a search's results reads as the same Course as `name` — case,
 * punctuation and generic words such as "Golf Club" or "Country Club" ignored, the same rule
 * lib/courses/match.ts's `normalised` tier uses for OpenGolfAPI, applied here to Wikipedia
 * titles instead. Zero results, several that all read the same, or `name` reducing to nothing
 * once the generic words are dropped, is not a confident pick: a wrong article is worse than
 * none, so every title search returned is passed back for the caller to report rather than
 * choose from.
 */
export function confidentArticle(
  name: string,
  results: readonly SearchHit[],
): ArticleConfidence {
  const target = distinctiveWords(name).join(" ");
  const matches =
    target === "" ? [] : results.filter((r) => distinctiveWords(r.title).join(" ") === target);
  if (matches.length === 1) return { status: "confident", title: matches[0]!.title };
  return { status: "unconfident", titles: results.map((r) => r.title) };
}
