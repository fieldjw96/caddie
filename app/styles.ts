// Class strings shared by the server-rendered page and the client-rendered ranking. Kept out of
// both so neither imports the other for a constant: a value exported from a "use client"
// module reaches a server component as a client reference, not as the string.

/** The scoreboard's section heading: condensed, uppercase, heavy. */
export const SECTION_HEADING =
  "font-display text-[2rem] leading-tight font-extrabold tracking-[0.02em] uppercase";
