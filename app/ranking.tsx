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
  type Weightings,
} from "../lib/fit";
import type { PlayerView, StrengthView } from "../lib/page/data";

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
    <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">
      {strength?.value != null ? (
        <span>{Math.round(strength.value * 100)}%</span>
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
  return <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">{body}</td>;
}

const subscribeNothing = () => () => {};

/** The names and results counts of every unscored Player, collapsible past 40. */
function UnscoredList({
  unscored,
}: {
  unscored: readonly { player: PlayerView; fit: FitScore }[];
}) {
  return (
    <details className="mt-3 rounded border border-rule p-3" open={unscored.length <= 40}>
      <summary className="cursor-pointer text-sm font-medium">
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
}: {
  players: readonly PlayerView[];
  traits: FitCourseTraits;
  hasVenue: boolean;
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
      <section aria-labelledby="ranking" className="mt-10">
        <h2 id="ranking" className="text-xl font-semibold">
          The roster, ordered by Fit Score
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
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
          <p className="mt-4 rounded border border-rule bg-gap-panel p-3 text-sm">
            {unscoredReason === "record"
              ? "No Player has a Fit Score: no Player has enough results for a Strength this " +
                "Course asks for."
              : courseOrWeightingsSentence}
          </p>
        ) : (
          <div className="mt-4 max-h-[36rem] overflow-auto rounded border border-rule">
            <table className="w-full min-w-[68rem] border-collapse text-sm">
              <thead className="sticky top-0 bg-panel text-xs text-muted">
                <tr>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Player
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Fit Score
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Skill
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Consistency
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Low rounds
                  </th>
                  {FIT_TRAITS.map((t) => (
                    <th key={t} scope="col" className="px-2 py-2 text-right font-medium">
                      {TRAIT_LABELS[t]}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Form
                  </th>
                  {hasVenue && (
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      Record here
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ranked.scored.map(({ player, fit }, index) => (
                  <tr
                    key={player.id}
                    className="border-t border-rule"
                    data-player={player.name}
                  >
                    <td className="px-2 py-1.5 text-right align-top text-muted">
                      {index + 1}
                    </td>
                    <th scope="row" className="px-2 py-1.5 text-left align-top font-medium">
                      {player.name}
                      {player.country && (
                        <span className="block text-xs font-normal text-muted">
                          {player.country}
                        </span>
                      )}
                    </th>
                    <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">
                      <span className={`font-semibold ${tone(fit.score)}`}>
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

      <section aria-labelledby="weightings" className="mt-10">
        <h2 id="weightings" className="text-xl font-semibold">
          The Weightings
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          These are our opinion of how much each Trait should count, not something fitted to
          past results. Move one and the ranking above is worked out again.
          {!interactive &&
            " The sliders need JavaScript; the ranking above uses the values shown."}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FIT_TRAITS.map((trait) => {
            const scale = TRAIT_SCALES[trait];
            const value = traits[trait] ?? null;
            const asks = value === null ? null : normalise(value, scale.min, scale.max);
            const id = `weighting-${trait}`;
            return (
              <div key={trait} className="rounded border border-rule bg-panel p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={id} className="font-medium">
                    {TRAIT_LABELS[trait]}
                  </label>
                  <output htmlFor={id} className="font-semibold">
                    {weightings[trait].toFixed(2)}
                  </output>
                </div>
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
                  className="mt-2 w-full"
                />
                <p className="mt-1 text-sm">
                  <strong>Calls for {STRENGTH_LABELS[scale.calls]}.</strong> {scale.why}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Scaled from {formatRangeEnd(trait, scale.min)} to{" "}
                  {formatRangeEnd(trait, scale.max)};{" "}
                  {asks === null
                    ? "unknown for this Course, so it counts for nobody."
                    : `this Course asks ${asks.toFixed(2)} of 1.`}{" "}
                  Declared: {DEFAULT_WEIGHTINGS[trait].toFixed(2)}.
                </p>
              </div>
            );
          })}
        </div>
        {changed && (
          <button
            type="button"
            onClick={() => setWeightings(DEFAULT_WEIGHTINGS)}
            className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-panel"
          >
            Back to the declared Weightings
          </button>
        )}
      </section>

      {ranked.unscored.length > 0 &&
        (unscoredReason === "record" ? (
          <section aria-labelledby="no-record" className="mt-10">
            <h2 id="no-record" className="text-xl font-semibold">
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
          <section aria-labelledby="unscored" className="mt-10">
            <h2 id="unscored" className="text-xl font-semibold">
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
