// A stand-in for `fetch` that answers from fixtures, so no test depends on OpenGolfAPI being up,
// or on its data staying wrong.

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Answers each request from the first route whose substring appears in its URL. */
export function fakeFetch(routes: Record<string, Reply>) {
  const requested: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    requested.push(url);
    const match = Object.entries(routes).find(([path]) => url.includes(path));
    if (!match) return new Response("not found", { status: 404 });
    const [, reply] = match;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requested };
}
