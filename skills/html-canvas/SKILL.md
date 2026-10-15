---
name: html-canvas
description: "Use when the thing to show is a page rather than prose — a live drawing, a chart, a puzzle, an instrument panel, a scene that has to move — and chalk, a note, or a letter would flatten it. Covers writing the html file itself: the head fields that become the card title and the look_at text, the airp-design width, and what the sandbox lets the page do at rest and in the second layer."
---

# Pages on the canvas

Reach for this skill when what you have to show is a **page** rather than a passage of prose: real
layout, real CSS, scripts that run, and a card that opens into a second layer when it is clicked.

A `.html` file is a card like any other — same face on the canvas, same second layer. This skill is
only about the page: choosing between chalk, note, letter, and a behaviour kind is a different
question, answered in `component-narration`.

## When a page, and when not

Write a `.html` when at least one of these holds:

- **It has to draw.** Geometry, a plot, a diagram, a route through a building — anything whose meaning
  is spatial. Prose describing a shape is a description; a page showing it is the shape.
- **It has to move.** An animation, a simulation, a clock face sweeping, ink spreading. A card face is
  a still picture; only a page can differ from second to second.
- **It has to be operated.** A calculator, a synthesizer panel, a puzzle with movable pieces — a page
  whose own scripts respond to a click *inside the second layer*.
- **It has to be a document with a designed look.** A poster, a ticket, a specimen label, a page torn
  from a manual. Here the typography is the content.

Do **not** write one when the answer is prose with a little styling. A page costs something: the
reader gets a rendered box instead of words, and nothing inside it appears in the text view they read
when they look at the thing. Chalk carries a sentence better. If the text is a *thing* that must be
kept or handed over, that is a `note`; if it conceals an inside, that is a `letter`.

## One file, carrying everything

The `.html` file is all there is. Nothing beside it is served to it.

**Inline everything**: CSS in `<style>`, scripts in `<script>`, images as `data:` URIs.

```html
<img src="data:image/svg+xml;base64,...">
```

**Never** a relative path. `./sketch.png` and `../shared/plot.css` point at nothing the page can
reach: there is no sibling lookup and no `<base>`. A page written as several files renders broken.

A link out to the wider web (`https://…`, a CDN script, a webfont) **does** load — the sandbox does
not filter the network. It also means the page breaks the day that host does, so inline unless a
hosted library is genuinely doing the work.

## The head is the card

Three things in the head are read. Nothing else in the file is.

```html
<title>Star chart, 03:00</title>
<meta name="description" content="Tonight's sky as seen from the roof.">
<meta name="airp-design" content="desktop">
```

- **`<title>`** — the card's name, and the first line `look_at` prints for this file. Leave it out
  and the name falls back to the filename, which is worse than the name you already know.
- **`<meta name="description">`** — the one-line summary: the second line `look_at` prints, and what
  the canvas listing shows. Leave it out and the card is listed with **no summary at all** — not a
  guess and not a stub. This is the only sentence most readers ever see of the page, so write it.
- **`<meta name="airp-design">`** — the width you designed at. `desktop` (1280) is the default,
  `tablet` is 834, `phone` is 390.

The card face scales the whole page down as one picture, against that width. A page laid out for 1280
and shown at `phone` is illegible at face size, so pick the tier that matches the layout you actually
wrote. A misspelled value falls back to `desktop` silently — spell it exactly.

## The face is a picture; the second layer is the page

On the canvas the page is a **read-only thumbnail**: it takes no clicks, drags, or scrolls. The card
around it still behaves like a card, and clicking it opens the second layer, where the page is live
and interactive.

So the page has to make sense **untouched**. Put the point in what it looks like at rest: draw the
current state, print the numbers, show the result. Anything that only appears after a click is
invisible until the second layer, so keep it a bonus and never the only route to the meaning.

## What a page cannot do

The page runs sandboxed: scripts run, and it has **no origin of its own**.

- It cannot see the canvas, the parent document, or any other page in the world.
- It cannot read or write world files, and calls it makes to the world's own API are cross-origin and
  will be refused.
- It cannot keep anything that outlives it: no `localStorage`, no cookies, no persistent storage.

Whatever the page needs must be **inside** the file. It can hold state in memory while it is open;
that is the whole budget. Only a few pages on one canvas stay live at a time and the rest fall back to
title and summary alone — one more reason the `description` has to carry the point by itself.

## Writing one

Write it with the same `write` tool as any other file, at a path under a content root —
`world/`, `player/`, or `characters/<id>/`.

```text
world/lab/star-chart.html
characters/mira/plate.html
```

The write is accepted for `.html` in those roots (an asset directory is still refused), the file lands,
the canvas gets a card, and the world event fires. No registration step.

Afterwards it is a file like any other: movable, collectible, deletable with the usual tools. Moving it
rewrites the relative paths inside it — keep the page self-contained and there is nothing to rewrite.

## Before you call it done

- Does the head carry a `<title>` and a `description`? The description is the only prose most readers
  will ever get without opening the page.
- Is `airp-design` one of the three exact words, and the width you really laid out at?
- Is every asset inlined, or a deliberate live external link?
- Does the resting picture already say what the page is for?

For a complete page you can copy the shape from, see `references/page-skeleton.md`.
