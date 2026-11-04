// The page itself, as a server component over plain data. Everything a reader needs is here
// in the HTML: the Tournament, the Course Profile, the ranking with its working, the gaps and
// the attribution. Only the sliders inside <Ranking> need JavaScript.

import {
  courseProfile,
  coverageSentences,
  fitTraits,
  formatDates,
  formatFreshnessDate,
  holesUnavailableReason,
  isStale,
  type PageData,
} from "../lib/page/data";
import { ROSTER_WINDOW_MONTHS } from "../lib/roster";
import { Ranking } from "./ranking";
import { SECTION_HEADING } from "./styles";

export const LICENCES = {
  wikipedia: {
    name: "Wikipedia",
    home: "https://en.wikipedia.org/",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    covers:
      "the schedule, each Tournament's venue, every result, a matched Course's altitude and green surface where its own article states them, and the par and yardage of a Course OpenGolfAPI does not have",
  },
  opengolfapi: {
    name: "OpenGolfAPI",
    home: "https://opengolfapi.org/",
    licence: "ODbL 1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    covers: "the Course: par, yardage, tees, Slope and Rating, hole by hole",
  },
  openstreetmap: {
    name: "OpenStreetMap",
    home: "https://www.openstreetmap.org/copyright",
    licence: "ODbL 1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    covers:
      "hole-by-hole pars and the location of a Course OpenGolfAPI has no holes for, © OpenStreetMap contributors",
  },
  copernicus: {
    name: "Copernicus DEM GLO-90, through Open-Meteo",
    home: "https://open-meteo.com/en/docs/elevation-api",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    covers: "a Course's altitude where its Wikipedia article states none",
  },
  wikidata: {
    name: "Wikidata",
    home: "https://www.wikidata.org/",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    covers: "who the Players are",
  },
} as const;

/** The page's one content column, inside the full-width bands. */
const COLUMN = "mx-auto max-w-6xl px-4 sm:px-6";

function Attribution({ data }: { data: PageData | null }) {
  return (
    <footer aria-labelledby="attribution" className="mt-16 bg-band text-on-band-muted">
      <div className={`${COLUMN} py-8 text-sm break-words`}>
        <h2
          id="attribution"
          className="font-display text-xl font-bold tracking-[0.06em] text-on-band uppercase"
        >
          Where this comes from
        </h2>
        <ul className="mt-2 space-y-1.5">
          {Object.values(LICENCES).map((s) => (
            <li key={s.name}>
              <a href={s.home} className="text-on-band underline">
                {s.name}
              </a>
              , under{" "}
              <a href={s.licenceUrl} rel="license" className="text-on-band underline">
                {s.licence}
              </a>
              : {s.covers}.
            </li>
          ))}
        </ul>
        {data?.course?.attribution && (
          <p className="mt-2">
            Course data: {data.course.attribution}
            {data.course.sourceUrl && (
              <>
                {" "}
                (
                <a href={data.course.sourceUrl} className="text-on-band underline">
                  record
                </a>
                )
              </>
            )}
            .
          </p>
        )}
        {data?.tournament.sourceUrl && (
          <p className="mt-1">
            Schedule:{" "}
            <a href={data.tournament.sourceUrl} className="text-on-band underline">
              the Wikipedia revision it was read from
            </a>
            .
          </p>
        )}
        {data?.course?.courseFactsSourceUrl && (
          <p className="mt-1">
            Altitude and green surface:{" "}
            <a href={data.course.courseFactsSourceUrl} className="text-on-band underline">
              the Wikipedia revision they were read from
            </a>
            .
          </p>
        )}
        {data?.course?.elevationSourceUrl && (
          <p className="mt-1">
            Altitude:{" "}
            <a href={data.course.elevationSourceUrl} className="text-on-band underline">
              the elevation reading at this Course
            </a>
            .
          </p>
        )}
        {data?.course?.holesSource === "openstreetmap" && data.course.holesSourceUrl && (
          <p className="mt-1">
            Hole-by-hole pars:{" "}
            <a href={data.course.holesSourceUrl} className="text-on-band underline">
              this Course on OpenStreetMap
            </a>
            .
          </p>
        )}
        {data?.course?.holesSource === "declared" && data.course.holesSourceUrl && (
          <p className="mt-1">
            Hole-by-hole card: entered by hand from{" "}
            <a href={data.course.holesSourceUrl} className="text-on-band underline">
              a published scorecard
            </a>
            , because no open Source holds it. It is not openly licensed, and is the one
            exception to the rule above.
          </p>
        )}
        <p className="mt-2">
          Every Player Strength and every Fit Score is Derived: computed here from those facts,
          never copied from anyone&rsquo;s published figures. The Course Traits are measured
          from the Course&rsquo;s own card. Code:{" "}
          <a href="https://github.com/fieldjw96/caddie" className="text-on-band underline">
            github.com/fieldjw96/caddie
          </a>
          .
        </p>
      </div>
    </footer>
  );
}

/** The brand mark: the name set in a white tile on the band. No logo exists. */
function Wordmark() {
  return (
    <span className="bg-on-band px-2.5 py-0.5 font-display text-xl font-extrabold text-band">
      CADDIE
    </span>
  );
}

export function PageView({ data, now = new Date() }: { data: PageData | null; now?: Date }) {
  if (data === null) {
    return (
      <main>
        <header className="bg-band text-on-band">
          <div className={`${COLUMN} py-10`}>
            <Wordmark />
            <h1 className="mt-6 font-display text-5xl leading-none font-extrabold uppercase sm:text-6xl">
              Caddie
            </h1>
          </div>
        </header>
        <div className={`${COLUMN} pt-8`}>
          <p className="max-w-prose text-lg">
            No upcoming PGA Tour Tournament is stored, so there is no Course to describe and no
            roster to rank. The schedule is read from Wikipedia; this page fills in once the
            next season&rsquo;s is.
          </p>
        </div>
        <Attribution data={null} />
      </main>
    );
  }

  const { tournament, course, traits, players, coverage } = data;
  const profile = courseProfile(course, traits);
  const hasVenue = players.some((p) => p.venueRecord !== null && p.venueRecord.value !== null);
  const courseName = course?.name ?? tournament.courseName;
  const holesTrusted = course?.holesTrusted === true;

  return (
    <main className="break-words">
      <header aria-labelledby="tournament" className="bg-band text-on-band">
        <div className={`${COLUMN} pt-6 pb-10`}>
          <div className="flex flex-wrap items-center justify-between gap-3 font-display text-base font-semibold tracking-[0.1em] uppercase">
            <p className="flex items-center gap-3">
              <Wordmark />
              <span className="text-on-band-muted">The next PGA Tour Tournament</span>
            </p>
            <p className="text-on-band-muted">
              Strengths derived {formatFreshnessDate(data.strengthsDerivedAt)}, from results
              last read {formatFreshnessDate(data.resultsReadAt)}.
            </p>
          </div>
          <h1
            id="tournament"
            className="mt-7 font-display text-[3.5rem] leading-[0.9] font-extrabold uppercase sm:text-7xl lg:text-[6.5rem]"
          >
            {tournament.name}
          </h1>
          <p className="mt-3 font-display text-xl font-semibold tracking-[0.04em] text-highlight uppercase sm:text-2xl">
            {formatDates(tournament.startDate, tournament.endDate)}
            {courseName ? `, at ${courseName}` : ", at a Course not yet known to us"}
          </p>
        </div>
      </header>

      <div className="border-b border-gap-rule bg-gap-panel">
        <p className={`${COLUMN} py-3.5 text-[0.95rem] leading-normal`}>
          <strong className="mr-2 font-display text-[1.05rem] tracking-[0.06em] text-gap uppercase">
            The field is assumed, not confirmed.
          </strong>
          No open source publishes entry lists, so this ranks Players with a stored result in
          the last {ROSTER_WINDOW_MONTHS} months, {players.length} Players, rather than the
          Players actually entered this week.
        </p>
      </div>

      <div className={`${COLUMN} pt-10`}>
        <Ranking players={players} traits={fitTraits(traits)} hasVenue={hasVenue}>
          <section aria-labelledby="course" className="mt-14">
            <h2 id="course" className={SECTION_HEADING}>
              The Course
              {course ? <span className="font-semibold text-muted">: {course.name}</span> : ""}
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {profile.map((line) => (
                <div key={line.label} className="flex flex-col border border-rule-strong">
                  <dt className="bg-panel px-3.5 py-2 font-display text-[0.95rem] font-bold tracking-[0.08em] uppercase">
                    {line.label}
                  </dt>
                  {line.value !== null ? (
                    <dd className="px-3.5 pt-2.5 pb-3.5">
                      <span className="block font-display text-4xl leading-tight font-bold">
                        {line.value}
                      </span>
                      {"detail" in line && line.detail && (
                        <span className="block text-sm text-muted">{line.detail}</span>
                      )}
                    </dd>
                  ) : (
                    <dd className="px-3.5 pt-3 pb-3.5 text-sm text-gap">
                      <span className="font-semibold">Unavailable.</span>{" "}
                      {line.reason.replace(/^Not shown: /, "")}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        </Ranking>

        <section aria-labelledby="unknowns" className="mt-14">
          <h2 id="unknowns" className={SECTION_HEADING}>
            What we do not know
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <li className="bg-panel p-4">
              <strong className="block font-display text-xl font-bold uppercase">
                The field.
              </strong>{" "}
              It is assumed: the {players.length} Players with a stored result in the last{" "}
              {ROSTER_WINDOW_MONTHS} months, not a confirmed entry list, because no open source
              publishes one.
            </li>
            <li className="bg-panel p-4">
              <strong className="block font-display text-xl font-bold uppercase">
                Most results.
              </strong>{" "}
              {coverageSentences(coverage).join(" ")}
            </li>
            {isStale(data.strengthsDerivedAt, now) && (
              <li className="bg-panel p-4">
                <strong className="block font-display text-xl font-bold uppercase">
                  How fresh this is.
                </strong>{" "}
                Strengths were last derived {formatFreshnessDate(data.strengthsDerivedAt)} and
                may not reflect results since: the daily ingest that keeps them current has
                missed its run.
              </li>
            )}
            {!holesTrusted && (
              <li className="bg-panel p-4">
                <strong className="block font-display text-xl font-bold uppercase">
                  Some of the Course.
                </strong>{" "}
                {holesUnavailableReason(course)}
              </li>
            )}
            <li className="bg-panel p-4">
              <strong className="block font-display text-xl font-bold uppercase">
                Most of how a Player plays.
              </strong>{" "}
              No open source carries shot-level data or strokes gained. Skill and Form are
              measured from finishing positions, and Consistency and Low rounds from round
              scores, which only the full-field leaderboards of the majors and the Players
              carry. A Strength resting on fewer than five events is not stated.
            </li>
            <li className="bg-panel p-4">
              <strong className="block font-display text-xl font-bold uppercase">
                What this Course rewards.
              </strong>{" "}
              The Weightings are declared, not fitted: there are too few openly published
              results to tell what a Course rewards from who happened to play it. A Fit Score
              is an opinion with its arithmetic on display, and says nothing about where anyone
              finishes this week.
            </li>
          </ul>
        </section>
      </div>

      <Attribution data={data} />
    </main>
  );
}
