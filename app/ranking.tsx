"use client";

// The ranking and the Weightings that drive it. Rendered on the server with the declared
// Weightings, so a reader without JavaScript sees the whole ranking, every row's working and
// the Players with no record; only moving a slider needs the browser. The arithmetic is
// lib/fit.ts's, the same pure function on both sides, so the numbers cannot drift apart.

import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_WEIGHTINGS,
  FIT_TRAITS,
  TRAIT_SCALES,
  fitScore,
  normalise,
  rankFits,
  type FitComponent,
  type FitCourseTraits,
  type FitScore,
  type FitStrengthName,
  type FitTraitName,
  type RankedFits,
  type Weightings,
} from "../lib/fit";
import { listInWords, type PlayerView, type StrengthView } from "../lib/page/data";
import { SECTION_HEADING } from "./styles";

export const TRAIT_LABELS: Readonly<Record<FitTraitName, string>> = {
  length_yards: "Length",
  slope_rating_gap: "Slope against rating",
  mean_par_4_yards: "Mean par 4",
  longest_par_4_yards: "Longest par 4",
  par_5_share: "Par 5 share",
};

export const STRENGTH_LABELS: Readonly<Record<FitStrengthName, string>> = {
  skill: "Skill",
  consistency: "Consistency",
  low_rounds: "Low rounds",
};

function formatRangeEnd(trait: FitTraitName, value: number): string {
  if (trait === "par_5_share") return `${Math.round(value * 18)} of 18`;
  if (trait === "slope_rating_gap") return `${value}`;
  return value.toLocaleString("en-US");
}

function signed(n: number, digits: number): string {
  const fixed = Math.abs(n).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${n > 0 ? "+" : "−"}${fixed}`;
}

function tone(n: number): string {
  if (Math.abs(n) < 0.0005) return "text-muted";
  return n > 0 ? "text-gain" : "text-loss";
}

const results = (n: number) => `${n} result${n === 1 ? "" : "s"}`;

/** A Strength and its sample: "no record" when there is no value, never a zero or a blank. */
function StrengthCell({ strength }: { strength: StrengthView | null }) {
  const sample = strength?.sampleSize ?? 0;
  return (
    <td className="px-3 py-2 text-right align-top whitespace-nowrap">
      {strength?.value != null ? (
        <span className="font-medium">{Math.round(strength.value * 100)}%</span>
      ) : (
        <span className="text-gap italic">no record</span>
      )}
      <span className="block text-xs text-muted">{results(sample)}</span>
    </td>
  );
}

function ContributionCell({ component }: { component: FitComponent }) {
  let body: React.ReactNode;
  if (component.contribution !== null) {
    body = (
      <span className={tone(component.contribution)}>{signed(component.contribution, 3)}</span>
    );
  } else if (component.normalised === null) {
    body = <span className="text-gap italic">Trait unavailable</span>;
  } else {
    body = <span className="text-gap italic">no record</span>;
  }
  return (
    <td className="px-3 py-2 text-right align-top font-semibold whitespace-nowrap">{body}</td>
  );
}

/**
 * The answer the site exists to give, read off the same `ranked` result the table below
 * renders rather than worked out again. When nothing separates the Players it says so and
 * gives the same reason the ranking section does, naming no Player; otherwise it names the
 * top three by Fit Score and, for the leader, the Trait behind most of their score and the
 * Strength that Trait calls for.
 */
function Answer({
  ranked,
  unscoredReason,
  courseOrWeightingsSentence,
}: {
  ranked: RankedFits<PlayerView>;
  unscoredReason: "course" | "weightings" | "record";
  courseOrWeightingsSentence: React.ReactNode;
}) {
  if (ranked.scored.length === 0) {
    return (
      <p data-testid="answer" className="max-w-prose text-lg">
        {unscoredReason === "course" ? (
          courseOrWeightingsSentence
        ) : unscoredReason === "weightings" ? (
          <>
            Nothing separates the Players on the current Weightings:{" "}
            {courseOrWeightingsSentence}
          </>
        ) : (
          <>
            Nothing separates the Players: no Player has enough results for a Strength this
            Course asks for.
          </>
        )}
      </p>
    );
  }

  const top3 = ranked.scored.slice(0, 3);
  const leader = top3[0]!;
  // A scored Player has at least one known contribution (fitScore.score is only non-null when
  // some component's weight x normalised x edge separates the field), so this always finds a
  // leading Trait even when every known contribution is zero or negative: the Trait is still
  // the largest, just not an edge in the field's favour.
  const known = leader.fit.components.filter(
    (c): c is FitComponent & { contribution: number } => c.contribution !== null,
  );
  const leading = known.reduce((best, c) => (c.contribution > best.contribution ? c : best));
  const names = listInWords(top3.map(({ player }) => player.name));

  return (
    <section aria-labelledby="top-of-the-fit">
      <h2 id="top-of-the-fit" className={SECTION_HEADING}>
        Top of the fit
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {top3.map(({ player, fit }, index) => (
          <li key={player.id} className="flex items-stretch border-2 border-band">
            <span
              aria-hidden="true"
              className="flex w-16 shrink-0 items-center justify-center bg-band font-display text-[2.75rem] font-extrabold text-on-band"
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
              <span className="font-display text-2xl leading-none font-bold uppercase">
                {player.name}
              </span>
              {player.country && <span className="text-sm text-muted">{player.country}</span>}
            </span>
            <span
              className={`flex items-center px-4 font-display text-[2.5rem] font-bold ${tone(fit.score)}`}
            >
              {signed(fit.score, 3)}
            </span>
          </li>
        ))}
      </ol>
      <p data-testid="answer" className="mt-4 max-w-prose text-lg">
        On the current Weightings, {names} {top3.length > 1 ? "lead" : "leads"} the field by
        Fit Score. {leader.player.name}&rsquo;s largest contribution comes from{" "}
        {TRAIT_LABELS[leading.trait]}, which calls for{" "}
        {STRENGTH_LABELS[TRAIT_SCALES[leading.trait].calls]}.
      </p>
    </section>
  );
}

const subscribeNothing = () => () => {};

/** The names and results counts of every unscored Player, collapsible past 40. */
function UnscoredList({
  unscored,
}: {
  unscored: readonly { player: PlayerView; fit: FitScore }[];
}) {
  return (
    <details className="mt-3 border border-rule-strong p-3" open={unscored.length <= 40}>
      <summary className="cursor-pointer font-display text-lg font-bold tracking-[0.04em] uppercase">
        Show all {unscored.length}
      </summary>
      <ul className="mt-3 columns-1 gap-6 text-sm sm:columns-2 lg:columns-3">
        {unscored.map(({ player }) => (
          <li key={player.id} className="break-inside-avoid py-0.5">
            {player.name}{" "}
            <span className="text-xs text-muted">
              ({results(player.skill?.sampleSize ?? 0)})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Ranking({
  players,
  traits,
  hasVenue,
  children,
}: {
  players: readonly PlayerView[];
  traits: FitCourseTraits;
  hasVenue: boolean;
  /** The Course Profile section, rendered between the answer and the ranking below it. */
  children?: React.ReactNode;
}) {
  const [weightings, setWeightings] = useState<Weightings>(DEFAULT_WEIGHTINGS);
  const deferred = useDeferredValue(weightings);
  // False on the server and in a browser without JavaScript, where the sliders cannot work
  // and are shown disabled rather than inviting a drag that does nothing.
  const interactive = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  const ranked = useMemo(() => {
    const { scored, unscored } = rankFits(
      players.map((player) => ({
        player,
        fit: fitScore(
          traits,
          {
            skill: player.skill?.value ?? null,
            consistency: player.consistency?.value ?? null,
            low_rounds: player.lowRounds?.value ?? null,
          },
          deferred,
        ),
      })),
    );
    return {
      scored,
      unscored: [...unscored].sort((a, b) => a.player.name.localeCompare(b.player.name, "en")),
    };
  }, [players, traits, deferred]);

  // The Course's own fit, with no Player's Strengths at all: every contribution is unknown,
  // but `demand` and each component's `normalised` do not depend on a Player's Strengths, so
  // this is the same for every Player and is read once rather than per row.
  const courseFit = useMemo(() => fitScore(traits, {}, deferred), [traits, deferred]);
  const knownTraits = useMemo(
    () => courseFit.components.filter((c) => c.normalised !== null),
    [courseFit],
  );
  // The known Traits sitting at or below the bottom of their range: the reason nothing
  // separates the Players when every known Trait is one of these.
  const blockingTraits = useMemo(
    () => knownTraits.filter((c) => c.normalised === 0),
    [knownTraits],
  );
  // The known Traits the Course asks something of, whatever the current Weightings do with
  // that. If this is empty, the Course itself is why nothing separates the Players; if it is
  // not empty but `demand` is still zero, every one of these is weighted zero, and the
  // Weightings, not the Course, are why.
  const askingTraits = useMemo(
    () => knownTraits.filter((c) => c.normalised !== null && c.normalised > 0),
    [knownTraits],
  );
  // Why an unscored Player has no Fit Score, read off courseFit rather than asserted. This is
  // the same for every unscored Player: "record" can only happen once `demand` is positive,
  // because a Fit Score needs some known Trait with weight x normalised > 0 to be non-null at
  // all, so when `demand` is zero no Player can ever score, whatever their record.
  const unscoredReason: "course" | "weightings" | "record" =
    courseFit.demand > 0 ? "record" : askingTraits.length > 0 ? "weightings" : "course";
  // The sentence naming the reason when it is "course" or "weightings", shared between the
  // ranking section's fallback and the unscored section below it, so both use the same terms.
  const courseOrWeightingsSentence =
    unscoredReason === "weightings" ? (
      <>
        This Course asks something of{" "}
        {askingTraits.map((c) => TRAIT_LABELS[c.trait]).join(", ")}, but the current Weightings
        count none of it: every Trait it asks something of is weighted zero.
      </>
    ) : knownTraits.length === 0 ? (
      <>This Course has no known Fit Trait, so nothing separates the Players.</>
    ) : (
      <>
        This Course&rsquo;s known Traits all sit at or below the bottom of their ranges on the
        current Weightings, so nothing separates the Players:{" "}
        {blockingTraits
          .map(
            (c) =>
              `${TRAIT_LABELS[c.trait]} is ${formatRangeEnd(c.trait, c.traitValue ?? 0)}, at or below the minimum of ${formatRangeEnd(c.trait, c.range.min)}`,
          )
          .join("; ")}
        .
      </>
    );

  const changed = FIT_TRAITS.some((t) => weightings[t] !== DEFAULT_WEIGHTINGS[t]);
  const totalWeight = FIT_TRAITS.reduce((sum, t) => sum + weightings[t], 0);

  return (
    <>
      <Answer
        ranked={ranked}
        unscoredReason={unscoredReason}
        courseOrWeightingsSentence={courseOrWeightingsSentence}
      />
      {children}
      <section aria-labelledby="ranking" className="mt-14">
        <h2 id="ranking" className={SECTION_HEADING}>
          The roster, ordered by Fit Score
        </h2>
        <p className="mt-2 text-sm text-muted">
          <span className="font-semibold text-gain">Red +</span> adds to the Fit Score, as
          under par does on a leaderboard; <span className="font-semibold text-loss">−</span>{" "}
          takes away.
        </p>
        <p className="mt-2 max-w-prose text-[0.95rem] text-muted">
          Each Trait&rsquo;s contribution is its Weighting, times how much this Course asks for
          the Strength it calls for, times the Player&rsquo;s edge in that Strength over the
          middle of the field. The Fit Score is their sum, between −{totalWeight.toFixed(2)}{" "}
          and +{totalWeight.toFixed(2)} on the current Weightings. Skill is the share of the
          field a Player finished ahead of. Consistency is how little their rounds swing
          against each day&rsquo;s field, and Low rounds how often one of their rounds is in
          the lowest tenth of it, each as the share of the other Players with a value they
          beat. Beneath each is the number of events it rests on.
        </p>

        {ranked.scored.length === 0 ? (
          <p className="mt-4 border border-gap-rule bg-gap-panel p-3 text-sm">
            {unscoredReason === "record"
              ? "No Player has a Fit Score: no Player has enough results for a Strength this " +
                "Course asks for."
              : courseOrWeightingsSentence}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto border-2 border-band sm:max-h-[36rem] sm:overflow-y-auto">
            <table className="w-full min-w-[68rem] border-collapse text-[0.95rem]">
              <thead className="sticky top-0 z-30 bg-band font-display text-base tracking-[0.06em] text-on-band uppercase">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-20 w-14 bg-band px-2 py-2.5 text-center font-bold"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="sticky left-14 z-20 min-w-[11rem] bg-band px-3 py-2.5 text-left font-bold"
                  >
                    Player
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">
                    Fit Score
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">
                    Skill
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">
                    Consistency
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">
                    Low rounds
                  </th>
                  {FIT_TRAITS.map((t) => (
                    <th key={t} scope="col" className="px-3 py-2.5 text-right font-bold">
                      {TRAIT_LABELS[t]}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">
                    Form
                  </th>
                  {hasVenue && (
                    <th scope="col" className="px-3 py-2.5 text-right font-bold">
                      Record here
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ranked.scored.map(({ player, fit }, index) => (
                  <tr
                    key={player.id}
                    className="border-t border-rule odd:bg-paper even:bg-row-alt"
                    data-player={player.name}
                  >
                    <td className="sticky left-0 z-10 w-14 bg-inherit px-2 py-2 text-center align-top">
                      <span className="inline-block min-w-8 bg-band py-0.5 font-display text-xl font-bold text-on-band">
                        {index + 1}
                      </span>
                    </td>
                    <th
                      scope="row"
                      className="sticky left-14 z-10 min-w-[11rem] bg-inherit px-3 py-2 text-left align-top"
                    >
                      <span className="font-display text-xl font-bold uppercase">
                        {player.name}
                      </span>
                      {player.country && (
                        <span className="block text-[0.8rem] font-normal text-muted">
                          {player.country}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                      <span
                        className={`inline-block border border-rule-strong bg-paper px-2 font-display text-2xl font-bold ${tone(fit.score)}`}
                      >
                        {signed(fit.score, 3)}
                      </span>
                      <span className="block text-xs text-muted">
                        on {Math.round((fit.knownWeight / (fit.totalWeight || 1)) * 100)}% of
                        the Weighting
                      </span>
                    </td>
                    <StrengthCell strength={player.skill} />
                    <StrengthCell strength={player.consistency} />
                    <StrengthCell strength={player.lowRounds} />
                    {fit.components.map((c) => (
                      <ContributionCell key={c.trait} component={c} />
                    ))}
                    <StrengthCell strength={player.form} />
                    {hasVenue && <StrengthCell strength={player.venueRecord} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ranked.scored.length > 0 && (
          <p className="mt-2 max-w-prose text-xs text-muted">
            {hasVenue
              ? "Form is Skill’s measure over the last six months, and Record here the same over a Player’s results at this Course. Both say how well a Player has done, not whose game suits this Course, so they are shown beside the Fit Score, not counted in it."
              : "Form is Skill’s measure over the last six months. It says how well a Player has done lately, not whose game suits this Course, so it is shown beside the Fit Score, not counted in it."}
          </p>
        )}
      </section>

      <section aria-labelledby="weightings" className="mt-14">
        <h2 id="weightings" className={SECTION_HEADING}>
          The Weightings
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          These are our opinion of how much each Trait should count, not something fitted to
          past results. Move one and the ranking above is worked out again.
          {!interactive &&
            " The sliders need JavaScript; the ranking above uses the values shown."}
        </p>
        <div className="mt-4 border-t-2 border-band">
          {FIT_TRAITS.map((trait) => {
            const scale = TRAIT_SCALES[trait];
            const value = traits[trait] ?? null;
            const asks = value === null ? null : normalise(value, scale.min, scale.max);
            const id = `weighting-${trait}`;
            return (
              <div
                key={trait}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule py-4"
              >
                <div className="min-w-[16rem] flex-[1_1_16rem]">
                  <label
                    htmlFor={id}
                    className="font-display text-[1.375rem] font-bold uppercase"
                  >
                    {TRAIT_LABELS[trait]}
                  </label>
                  <p className="mt-1 text-sm">
                    <strong>Calls for {STRENGTH_LABELS[scale.calls]}.</strong> {scale.why}
                  </p>
                </div>
                <div className="min-w-[16rem] flex-[2_1_20rem]">
                  <input
                    id={id}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={weightings[trait]}
                    disabled={!interactive}
                    onChange={(e) =>
                      setWeightings((w) => ({ ...w, [trait]: Number(e.target.value) }))
                    }
                    className="w-full"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Scaled from {formatRangeEnd(trait, scale.min)} to{" "}
                    {formatRangeEnd(trait, scale.max)};{" "}
                    {asks === null
                      ? "unknown for this Course, so it counts for nobody."
                      : `this Course asks ${asks.toFixed(2)} of 1.`}{" "}
                    Declared: {DEFAULT_WEIGHTINGS[trait].toFixed(2)}.
                  </p>
                </div>
                <output
                  htmlFor={id}
                  className="min-w-[4.5rem] bg-band px-2 py-1 text-center font-display text-[1.75rem] font-bold text-on-band"
                >
                  {weightings[trait].toFixed(2)}
                </output>
              </div>
            );
          })}
        </div>
        {changed && (
          <button
            type="button"
            onClick={() => setWeightings(DEFAULT_WEIGHTINGS)}
            className="mt-4 border-2 border-band px-4 py-2 font-display text-lg font-bold tracking-[0.04em] uppercase hover:bg-panel"
          >
            Back to the declared Weightings
          </button>
        )}
      </section>

      {ranked.unscored.length > 0 &&
        (unscoredReason === "record" ? (
          <section aria-labelledby="no-record" className="mt-14">
            <h2 id="no-record" className={SECTION_HEADING}>
              Players with no usable record
            </h2>
            <p className="mt-2 max-w-prose text-sm text-muted">
              {ranked.unscored.length} Players have no Fit Score, because no Strength the
              current Weightings call for rests on enough of their results to state. They are
              not ranked last: unknown is not bad, and most of them simply played events no
              source we can publish from covers.
            </p>
            <UnscoredList unscored={ranked.unscored} />
          </section>
        ) : (
          <section aria-labelledby="unscored" className="mt-14">
            <h2 id="unscored" className={SECTION_HEADING}>
              {unscoredReason === "weightings"
                ? "No Player has a Fit Score on the current Weightings"
                : "No Player has a Fit Score at this Course"}
            </h2>
            <p className="mt-2 max-w-prose text-sm text-muted">{courseOrWeightingsSentence}</p>
            <UnscoredList unscored={ranked.unscored} />
          </section>
        ))}
    </>
  );
}
