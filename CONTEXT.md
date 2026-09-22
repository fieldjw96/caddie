# Caddie

A public site that answers one question: of the players in the next tournament's field, whose
game best suits that course, and why. Everything else on the site exists to make that answer
readable and to show the working.

## Language

### The subjects

**Player**:
One professional golfer. The PGA Tour's own word for the people who compete, so it is the one
used here. There are no user accounts in this product, so the term is never ambiguous.
_Avoid_: golfer, pro, competitor, user

**Course**:
One golf course, identified by its own name rather than by the tournament played on it. A
Course outlives any Tournament held there and can host several.
_Avoid_: venue, track, layout

**Tournament**:
One event on the schedule, played on one Course in one week. A Tournament that moves Course
between years is still one Tournament.
_Avoid_: event, comp, competition

**Field**:
The set of Players entered in one Tournament. A Field is known only shortly before play, and
is empty rather than assumed for Tournaments further out.
_Avoid_: lineup, entry list, roster

**Round**:
One Player's eighteen holes in one Tournament on one day. The smallest unit of performance
this product holds.

### The model

**Course Trait**:
One measurable characteristic of a Course that plausibly favours a kind of game: total length,
par, elevation, green surface. A Trait is a fact about the Course, never a judgement about who
it suits.
_Avoid_: feature, attribute, characteristic

**Player Strength**:
One measurable characteristic of a Player's game, derived from their Rounds. A Strength is
computed here from scoring data, never copied from a published rating.
_Avoid_: skill, stat, rating

**Fit Score**:
The weighted match between a Player's Strengths and a Course's Traits, for one Player at one
Tournament. It is an opinion with its arithmetic on display, not a prediction, and the site
must never present it as a forecast of who will win.
_Avoid_: prediction, projection, rating, ranking

**Weighting**:
How much one Course Trait counts towards the Fit Score. Weightings are visible on the page and
adjustable by the reader, because a Fit Score whose weights are hidden is indistinguishable
from a guess.

### Provenance

**Source**:
Where one fact came from, and the licence it arrived under. Every stored fact carries its
Source. This is load-bearing rather than tidy: this product exists on openly-licensed data
only, and a fact whose Source is unknown cannot be shown. See `docs/adr/0001`.
_Avoid_: origin, feed, provider

**Derived**:
A fact this repo computed from other facts, rather than read from a Source. Every Player
Strength is Derived. Marking it so is what makes the difference between publishing our own
analysis, which is allowed, and republishing someone else's, which is not.
