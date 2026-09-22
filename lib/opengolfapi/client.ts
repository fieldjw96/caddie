// The only code that talks to OpenGolfAPI. Every request goes through one throttle, and every
// response through a Zod schema before anything else sees it.

import { z } from "zod";
import { parse } from "./schema";

export const OPENGOLFAPI_BASE_URL = "https://api.opengolfapi.org";

/**
 * Anonymous requests allowed per day. Observed as `X-RateLimit-Limit: 500` on 2026-09-21,
 * resetting at 00:00 UTC. OpenGolfAPI's documentation says 1,000; the wire says 500, and the
 * wire is what we believe.
 */
export const DAILY_REQUEST_LIMIT = 500;

/**
 * The gap left between requests. Not needed to stay under the daily limit, which is a count,
 * but it keeps one run from arriving as a burst.
 */
export const MIN_REQUEST_INTERVAL_MS = 1_000;

/**
 * The daily allowance is used up, by this run or by anything else sharing the address. Every
 * later request would fail the same way, so this ends the run rather than one course.
 */
export class RateLimitExhausted extends Error {
  constructor(detail: string) {
    super(
      `OpenGolfAPI's daily limit of ${DAILY_REQUEST_LIMIT} requests is used up: ${detail}`,
    );
    this.name = "RateLimitExhausted";
  }
}

/** One request that failed. It costs the course that made it, and the run carries on. */
export class RequestError extends Error {
  constructor(url: string, detail: string) {
    super(`GET ${url} failed: ${detail}`);
    this.name = "RequestError";
  }
}

const remainingHeader = z.coerce.number().int().nonnegative();

export type ClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Requests this client may send in its lifetime. Never more than the daily limit. */
  budget?: number;
  intervalMs?: number;
};

export class OpenGolfApiClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly budget: number;
  private readonly intervalMs: number;
  private sent = 0;
  private lastSentAt: number | null = null;
  /** What the server last said is left today, when it said anything. */
  private remaining: number | null = null;

  constructor(options: ClientOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.budget = Math.min(options.budget ?? DAILY_REQUEST_LIMIT, DAILY_REQUEST_LIMIT);
    this.intervalMs = options.intervalMs ?? MIN_REQUEST_INTERVAL_MS;
  }

  get requestsSent(): number {
    return this.sent;
  }

  /** What the server last said is left today, or null before it has said anything. */
  get remainingToday(): number | null {
    return this.remaining;
  }

  /**
   * Throws RateLimitExhausted unless `count` more requests can be sent, by this client's
   * budget and by what the server last said remains. For a caller that would rather not start
   * than stop halfway.
   */
  ensure(count: number): void {
    const left = this.budget - this.sent;
    const available = this.remaining === null ? left : Math.min(left, this.remaining);
    if (available < count) {
      throw new RateLimitExhausted(`${count} more requests are needed and ${available} remain`);
    }
  }

  /** Fetches `path` and parses its body with `schema`, or throws saying which field failed. */
  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${OPENGOLFAPI_BASE_URL}${path}`;
    await this.throttle();

    let response: Response;
    try {
      response = await this.fetch(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new RequestError(url, error instanceof Error ? error.message : String(error));
    }

    // Advisory: the budget above is the guarantee. A header that is missing or unreadable
    // leaves the last reading in place rather than failing a response whose body is fine.
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining !== null) {
      const parsed = remainingHeader.safeParse(remaining);
      if (parsed.success) this.remaining = parsed.data;
    }

    if (response.status === 429) {
      throw new RateLimitExhausted(`GET ${url} returned 429`);
    }
    if (!response.ok) {
      throw new RequestError(url, `HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RequestError(url, "the body was not JSON");
    }
    return parse(schema, body, `GET ${url}`);
  }

  private async throttle(): Promise<void> {
    if (this.sent >= this.budget) {
      throw new RateLimitExhausted(`this run has already sent its budget of ${this.budget}`);
    }
    if (this.remaining === 0) {
      throw new RateLimitExhausted("the server reports 0 remaining");
    }
    if (this.lastSentAt !== null) {
      const wait = this.lastSentAt + this.intervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastSentAt = this.now();
    this.sent += 1;
  }
}
