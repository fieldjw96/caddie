// The page itself, as a server component over plain data. Everything a reader needs is here
// in the HTML: the Tournament, the Course Profile, the ranking with its working, the gaps and
// the attribution. Only the sliders inside <Ranking> need JavaScript.

import {
  courseProfile,
  coverageSentences,
  fitTraits,
  formatDates,
  holesUnavailableReason,
  type PageData,
} from "../lib/page/data";
import { Ranking } from "./ranking";

export const LICENCES = {
  wikipedia: {
    name: "Wikipedia",
    home: "https://en.wikipedia.org/",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    covers:
      "the schedule, each Tournament's venue, every result, and a matched Course's altitude and green surface where its own article states them",
  },
  opengolfapi: {
    name: "OpenGolfAPI",
    home: "https://opengolfapi.org/",
    licence: "ODbL 1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    covers: "the Course: par, yardage, tees, Slope and Rating, hole by hole",
  },
  wikidata: {
    name: "Wikidata",
    home: "https://www.wikidata.org/",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    covers: "who the Players are",
  },
} as const;

function Attribution({ data }: { data: PageData | null }) {
  return (
    <footer
      aria-labelledby="attribution"
      className="mt-12 border-t border-rule pt-6 text-sm break-words"
    >
      <h2 id="attribution" className="text-base font-semibold">
        Where this comes from
      </h2>
      <ul className="mt-2 space-y-1.5">
        {Object.values(LICENCES).map((s) => (
          <li key={s.name}>
            <a href={s.home} className="underline">
              {s.name}
            </a>
            , under{" "}
            <a href={s.licenceUrl} rel="license" className="underline">
              {s.licence}
            </a>
            : {s.covers}.
          </li>
        ))}
      </ul>
      {data?.course?.attribution && (
        <p className="mt-2 text-muted">
          Course data: {data.course.attribution}
          {data.course.sourceUrl && (
            <>
              {" "}
              (
              <a href={data.course.sourceUrl} className="underline">
                record
              </a>
              )
            </>
          )}
          .
        </p>
      )}
      {data?.tournament.sourceUrl && (
        <p className="mt-1 text-muted">
          Schedule:{" "}
          <a href={data.tournament.sourceUrl} className="underline">
            the Wikipedia revision it was read from
          </a>
          .
        </p>
      )}
      {data?.course?.courseFactsSourceUrl && (
        <p className="mt-1 text-muted">
          Altitude and green surface:{" "}
          <a href={data.course.courseFactsSourceUrl} className="underline">
            the Wikipedia revision they were read from
          </a>
          .
        </p>
      )}
      <p className="mt-2 text-muted">
        Every Player Strength and every Fit Score is Derived: computed here from those facts,
        never copied from anyone&rsquo;s published figures. The Course Traits are measured from
        the Course&rsquo;s own card. Code:{" "}
        <a href="https://github.com/fieldjw96/caddie" className="underline">
          github.com/fieldjw96/caddie
        </a>
        .
      </p>
    </footer>
  );
}

export function PageView({ data }: { data: PageData | null }) {
  if (data === null) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-semibold">Caddie</h1>
        <p className="mt-3 max-w-prose">
          No upcoming PGA Tour Tournament is stored, so there is no Course to describe and no
          roster to rank. The schedule is read from Wikipedia; this page fills in once the next
          season&rsquo;s is.
        </p>
        <Attribution data={null} />
      </main>
    );
  }

  const { tournament, course, traits, players, coverage } = data;
  const profile = courseProfile(course, traits);
  const hasVenue = players.some((p) => p.venueRecord !== null);
  const courseName = course?.name ?? tournament.courseName;
  const holesTrusted = course?.holesTrusted === true;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 break-words sm:py-10">
      <p className="text-sm text-muted">Caddie · the next PGA Tour Tournament</p>
      <header aria-labelledby="tournament">
        <h1 id="tournament" className="mt-1 text-3xl leading-tight font-semibold sm:text-4xl">
          {tournament.name}
        </h1>
        <p className="mt-2 text-lg">
          {formatDates(tournament.startDate, tournament.endDate)}
          {courseName ? `, at ${courseName}` : ", at a Course not yet known to us"}
        </p>
        <p className="mt-3 rounded border border-rule bg-gap-panel p-3 text-sm">
          <strong>The field is assumed, not confirmed.</strong> No open source publishes entry
          lists, so this ranks the regular tour roster we hold, {players.length} Players,
          rather than the Players actually entered this week.
        </p>
      </header>

      <section aria-labelledby="course" className="mt-8">
        <h2 id="course" className="text-xl font-semibold">
          The Course{course ? `: ${course.name}` : ""}
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {profile.map((line) => (
            <div
              key={line.label}
              className="flex flex-col border-b border-rule pb-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <dt className="text-sm text-muted">{line.label}</dt>
              {line.value !== null ? (
                <dd className="text-lg font-semibold sm:text-right">
                  {line.value}
                  {"detail" in line && line.detail && (
                    <span className="block text-xs font-normal text-muted">{line.detail}</span>
                  )}
                </dd>
              ) : (
                <dd className="text-sm text-gap sm:max-w-[60%] sm:text-right">
                  <span className="font-semibold">Unavailable.</span>{" "}
                  {line.reason.replace(/^Not shown: /, "")}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      <Ranking players={players} traits={fitTraits(traits)} hasVenue={hasVenue} />

      <section aria-labelledby="unknowns" className="mt-10">
        <h2 id="unknowns" className="text-xl font-semibold">
          What we do not know
        </h2>
        <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5">
          <li>
            <strong>The field.</strong> It is assumed: the {players.length} Players on the tour
            roster we hold, not a confirmed entry list, because no open source publishes one.
          </li>
          <li>
            <strong>Most results.</strong> {coverageSentences(coverage).join(" ")}
          </li>
          {!holesTrusted && (
            <li>
              <strong>Some of the Course.</strong> {holesUnavailableReason(course)}
            </li>
          )}
          <li>
            <strong>Anything about how a Player plays.</strong> No open source carries
            shot-level data or strokes gained, so Skill and Form are measured from finishing
            positions alone. A Strength resting on fewer than five results is not stated.
          </li>
          <li>
            <strong>What this Course rewards.</strong> The Weightings are declared, not fitted:
            there are too few openly published results to tell what a Course rewards from who
            happened to play it. A Fit Score is an opinion with its arithmetic on display, and
            says nothing about where anyone finishes this week.
          </li>
        </ul>
      </section>

      <Attribution data={data} />
    </main>
  );
}
