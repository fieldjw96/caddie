---
status: accepted
---

# Only openly-licensed data, and every Player Strength is Derived

This site is public and has no login. That one decision determines where every fact in it may
come from, because a public page is publication, and publication is the thing most golf data
licences forbid.

## What was checked

**pgatour.com is prohibited, unambiguously.** Their Terms of Use §7C bans scrapers outright,
§7D restricts statistics to personal non-commercial use, and §7H bans publication of downloaded
material without express permission. Their `robots.txt` is permissive and even advertises a
stats sitemap; that is irrelevant, because the Terms override it. The undocumented
`orchestrator.pgatour.com/graphql` endpoint that community wrappers use is the richest free
source of exactly the data this product wants, and it is the one most clearly barred.

**ESPN and CBS are worse.** ESPN runs on Disney's terms, which ban automated extraction and
dataset compilation explicitly, "whether or not for profit".

**DataGolf is the only source that covers the whole brief**, with round-level strokes gained
across 33 tours. It is $270 a year and its §13 grants personal, non-commercial use and says
"you will not redistribute or transfer any of the Data Golf Services or Contents". A free
public site is redistribution. Rejected for that reason, not on cost.

**Every free strokes gained dataset traces back to the PGA Tour.** The Kaggle sets, the GitHub
repos, Advanced Sports Analytics. An uploader cannot grant rights they never held, so a
declared CC0 on a derived set does not cure its provenance. They are also mostly stale, ending
in 2022.

## The decision

> **Amended by ADR 0002.** The test below is drawn too tight. It is the right to publish
> that matters, and an explicit written grant is such a right just as an open licence is.
> ADR 0002 also records what calling these sources actually showed, and why a learned
> course-fit model is out of scope. The prohibitions in this ADR all still stand, and so
> does everything below about Source and Derived.

**Only data under an open licence may be stored or displayed.** Wikidata (CC0), Wikipedia
(CC BY-SA 4.0), OpenGolfAPI (ODbL 1.0). Each carries its attribution obligation and the site
discharges it visibly.

**Every Player Strength is Derived here, from scoring data we are entitled to hold.** We do not
display anyone else's strokes gained column. We compute our own field-relative measures and say
plainly how.

**Every stored fact carries its Source.** A fact whose Source is unknown is not shown. This is
enforced in the schema rather than by convention, in the same shape as `rolodeck-ai`'s
provenance constraint.

## Consequences

**The product is worse at first and more defensible forever.** We cannot show the numbers
everybody else shows. What we show instead is our own, which is the better portfolio story: the
constraint is the reason the analysis exists rather than an excuse for it being thin.

**Any new Source needs an ADR amending this one.** Adding a feed is not a routine change here
the way it is elsewhere; it is a licensing decision with a public page at the end of it.

**If a Source's terms are ambiguous rather than open, it does not go in on a judgement call.**
Ask the provider in writing and keep the reply. Slash Golf was the live example, and ADR 0002 records how it resolved: it publishes no terms at all, which is a refusal rather than an ambiguity. What follows is the reasoning as it stood when this ADR was written: their free tier
would give us hole-by-hole scorecards, which is exactly the raw input our Derived measures need,
and their terms say nothing either way about public display. That is a question to ask, not to
assume.
