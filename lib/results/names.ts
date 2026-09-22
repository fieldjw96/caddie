// Matching a name read from a results table to an existing `players` row. Exact matching
// after obvious normalisation only: case, accents, punctuation and spacing. Nothing fuzzier,
// because a wrong match is worse than a missing one: nothing downstream can detect it, where
// a miss is reported at the end of the run and can be looked at.

/**
 * A name reduced to what two spellings of the same name share: `J. T. Poston`, `J.T. Poston`
 * and `jt poston` all become `jtposton`, and `Ludvig Åberg` becomes `ludvigaberg`.
 */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .replace(/đ/gi, "d")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The name a wikilink's target gives an article, less Wikipedia's disambiguator:
 * `Matt McCarty (golfer)` is `Matt McCarty`.
 */
export function withoutDisambiguator(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export interface NamedPlayer {
  id: number;
  name: string;
}

export type NameMatch =
  | { kind: "matched"; playerId: number }
  | { kind: "unmatched" }
  | { kind: "ambiguous"; playerIds: number[] };

/**
 * An index from normalised name to the players carrying it. Two players who normalise to the
 * same key are both kept, so that a lookup can refuse to choose between them.
 */
export class PlayerIndex {
  private readonly byKey = new Map<string, number[]>();

  constructor(players: readonly NamedPlayer[]) {
    for (const player of players) {
      const key = normaliseName(player.name);
      if (key === "") continue;
      const ids = this.byKey.get(key) ?? [];
      ids.push(player.id);
      this.byKey.set(key, ids);
    }
  }

  /**
   * The one player every candidate spelling agrees on. Candidates are tried in order and the
   * first that finds anyone decides: a name that matches two players is ambiguous, and is
   * refused rather than resolved by a later, looser candidate.
   */
  match(candidates: readonly string[]): NameMatch {
    for (const candidate of candidates) {
      const ids = this.byKey.get(normaliseName(candidate));
      if (!ids) continue;
      const unique = [...new Set(ids)];
      return unique.length === 1
        ? { kind: "matched", playerId: unique[0]! }
        : { kind: "ambiguous", playerIds: unique };
    }
    return { kind: "unmatched" };
  }
}
