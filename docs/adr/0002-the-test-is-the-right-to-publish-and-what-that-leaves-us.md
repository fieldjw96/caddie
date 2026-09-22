---
status: accepted
amends: 0001
---

# The test is the right to publish, and what that leaves us buildable

ADR 0001 got the principle right and the rule wrong, and it assumed a product that the
evidence does not support. This ADR corrects both. Everything else in 0001 stands: the
prohibition on pgatour.com, ESPN and CBS, the requirement that every fact carry its Source,
and the requirement that every Player Strength be Derived here.

## The rule was drawn too tight

ADR 0001 said "only data under an open licence". That is one way of having the right to
publish something, not the definition of it. A provider who says in writing that you may copy
and redistribute their output has granted a right just as real as a CC licence.

**The test is whether we have the right to publish, and an open licence and an explicit written
grant both satisfy it.** What does not satisfy it is a judgement call about whether anybody
would mind.

This is not a loosening in practice. It rules out the same sources 0001 ruled out, and it rules
out one more that 0001's wording would have let through, below.

## Slash Golf is now refused, and the reason is instructive

ADR 0001 named Slash Golf as the ambiguous case to resolve by asking. Checked properly, it is
not ambiguous, it is empty. Its own OpenAPI document carries `termsOfService:
https://slashgolf.dev/TODO`, commented out. Every `/terms` URL it publishes returns 404. Every
RapidAPI plan it offers carries an empty `legalDocumentId`. It serves PGA Tour internal
tournament and stat identifiers, from a two-person LLC, which means it is almost certainly not
a licensee and cannot grant what it does not hold.

**A vacuum is worse than a restriction.** A restrictive licence tells you where you stand. No
licence at all means the question has never been answered by anybody, and the upstream rights
holder is the one whose terms then apply. Those are pgatour.com's, and they say no.

## What the evidence actually showed

Every claim below was verified by calling the source, not by reading its documentation.

**The schedule is available.** Wikipedia resolved 10 of 10 upcoming tournaments to venue, par
and yardage. CC BY-SA 4.0.

**Course description is available and partly wrong.** OpenGolfAPI is ODbL 1.0, free, needs no
key, and holds 32,704 courses; all 8 PGA venues tested resolve with par, yardage, per-tee
rating and slope, hole-by-hole par and yardage, architect and climate normals. Two corrections
to what its docs claim: the rate limit is 500 a day, not 1,000, and **all hole-level geometry
is null on the free tier**. More seriously, **championship-tee hole yardages are wrong at 3 of
7 venues tested**: Augusta returns member tees, 1,080 yards short of the championship card. Any
length-derived Trait that trusts hole yardages without checking them against the published
course total will be confidently wrong.

**Player identity is available.** Wikidata, CC0, 1,592 golfers carrying a PGA Tour identifier,
99% with a date of birth.

**Per-round, per-player scoring is not available, and this is the one that matters.** Wikidata
holds 11 statements on the 2025 Masters and zero per-edition items for regular tour events.
Wikipedia carries full-field round-by-round leaderboards for the majors, the Players and the
Tour Championship, roughly six events a season, and none for regular events: 2025 Genesis,
Travelers, Phoenix and Arnold Palmer all return `missing:true`. There is no CC or public-domain
source for shot-level or strokes-gained data anywhere. data.world retired its open data
community in July 2026 and deleted the sets; every Kaggle and GitHub golf dataset is a
pgatour.com or ESPN scrape carrying an invented licence tag.

## The decision this forces

**A learned course-fit model is out of scope, and not because of effort.** "This course rewards
long driving" is a claim about player outcomes conditioned on player attributes. Establishing it
needs many players of differing distance playing the same course across seasons. Open data
yields about six venue-seasons a year, three of them at rotating venues, and is silent on Bay
Hill, Muirfield Village, Riviera, TPC Scottsdale and Waialae. A model fitted on that would be
separating a course effect from a field effect on a sample that cannot do it.

**What replaces it is a descriptive Course Profile and a declared Fit Score.** Course Traits are
measured from the course itself: total yardage, par mix, the length of its longest par 4s, the
gap between slope and rating, altitude, architect, green surface. They are facts about the
Course. The Weightings that turn them into a Fit Score are **declared by us and shown on the
page**, adjustable by the reader, never fitted. That is the difference between an opinion with
its arithmetic on display and a prediction dressed up as one.

**Editorial analysis is reading, not a Source.** Golf Digest and similar publish good writing on
which players suit which venues. It informs which Traits are worth measuring. None of it is
fetched, stored or reproduced: it is Condé Nast's, its terms prohibit automated extraction, and
republishing their conclusions is exactly what ADR 0001 exists to stop.

**The Field is assumed, and the page says so.** No open source publishes entry lists. The page
ranks the regular tour roster rather than the actual field, and states that plainly rather than
implying a confirmed entry list exists.

## Consequences

**The site must show its gaps rather than paper over them.** Every Fit Score carries the sample
it rests on. Where a Player has no record at a venue, the page says so instead of printing a
number. This is a display requirement, not a nicety: a descriptive score presented with the
confidence of a fitted one would be the dishonest version of this product.

**TheSportsDB remains open as a later decision, not taken now.** It states in writing that its
output may be scraped, copied and modified with attribution, for roughly £10 a month, and its
PGA data was verified real and current. It satisfies the right-to-publish test this ADR sets.
It is top-10-plus-ties and round-level rather than full field, so it thickens the record without
fixing the gap that killed the learned model. Adding it is a new ADR when someone wants it, not
a judgement call by whoever is holding the Ticket.
