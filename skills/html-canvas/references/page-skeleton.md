# A page you can start from

A star chart: one file, no external asset, laid out for the default 1280-wide design. Copy the
shape, then replace the drawing with yours.

## The whole file, in one piece

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Star chart, 03:00</title>
  <meta name="description" content="Tonight's sky as seen from the roof.">
  <meta name="airp-design" content="desktop">
  <style>
    /* The card face scales the whole page as one picture, so the page controls its own margins. */
    html, body { margin: 0; height: 100%; background: #0b1024; }
    body {
      width: 1280px;
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 40px;
      padding: 48px;
      box-sizing: border-box;
      font: 16px/1.5 system-ui, sans-serif;
      color: #cfd6f5;
    }
    h1 { font-size: 44px; margin: 0 0 8px; }
    .legend { border-left: 1px solid #2c3766; padding-left: 28px; }
    .legend dt { color: #7f8fc0; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    .legend dd { margin: 4px 0 20px; font-size: 20px; }
    canvas { width: 100%; aspect-ratio: 1; display: block; }
    .seal { width: 72px; height: 72px; opacity: .8; }
  </style>
</head>
<body>
  <main>
    <h1>Star chart</h1>
    <p>Computed for the roof at 03:00. Nothing here is fetched — the sky is drawn from the
       numbers in the script below.</p>
    <canvas id="sky" width="760" height="760"></canvas>
  </main>
  <aside class="legend">
    <dl>
      <dt>Seeing</dt><dd id="seeing">good</dd>
      <dt>Objects plotted</dt><dd id="count">0</dd>
    </dl>
    <img class="seal" alt="observatory seal"
      src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA3MiA3MiI+PGNpcmNsZSBjeD0iMzYiIGN5PSIzNiIgcj0iMzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzdmOGZjMCIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTM2IDggTDQ0IDI5IEw2NiAzMCBMNDggNDMgTDU1IDY1IEwzNiA1MSBMMTcgNjUgTDI0IDQzIEw2IDMwIEwyOCAyOSBaIiBmaWxsPSIjN2Y4ZmMwIiBvcGFjaXR5PSIwLjQiLz48L3N2Zz4=">
  </aside>

  <script>
    // Runs at load: the picture is already right before anyone touches anything.
    const stars = [[190, 240], [430, 180], [610, 400], [300, 520], [520, 620], [150, 430], [660, 220]];
    const canvas = document.getElementById('sky');
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0b1024';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [x, y] of stars) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#cfd6f5';
      ctx.fill();
    }
    for (const [x, y] of stars) {
      ctx.beginPath();
      ctx.moveTo(380, 380);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(127,143,192,.35)';
      ctx.stroke();
    }

    document.getElementById('count').textContent = String(stars.length);
  </script>
</body>
</html>
```

Every asset in that file is inside it: the style block, the script, and the seal as a `data:` URI.
The page renders the same wherever it lands.

## What each part is doing

| Part | What it decides |
|---|---|
| `<title>` | The card's name, and the first line `look_at` prints |
| `<meta name="description">` | The one-line summary in the canvas listing and the second line `look_at` prints; omit it and the card is listed with no summary |
| `<meta name="airp-design">` | The width the layout was written for, and therefore the scale the card face uses |
| `<style>` | Applies inside this page only; never to the canvas around it |
| `<script>` | Runs in this page only, with no origin — it cannot reach the world or the parent document |
| `data:` URIs | The only images that travel with the file |

## Designing at a width

| `airp-design` | Width to lay out at | Pick it when |
|---|---|---|
| `desktop` (the default) | 1280 | A 16:9 layout — the usual choice |
| `tablet` | 834 | The layout reads better in a narrow column, iPad held upright |
| `phone` | 390 | A single-column layout meant for a phone screen |

The card face shrinks the entire page to fit, so the width you designed at is the width you must
lay out at. Anything not exactly `desktop`, `tablet`, or `phone` falls back to `desktop`, silently.

Do not reach for `<meta name="viewport">` instead of `airp-design`. They are different things: a
viewport describes how a browser should adapt a page, while `airp-design` declares the coordinate
system of your design. The page is rendered at the width `airp-design` names regardless of what the
viewport says, so a viewport tag does not tell the card how to scale.

## What breaks

**A misspelled tier.**

```html
<meta name="airp-design" content="laptop">
```

The page is scaled as if it were 1280 wide. Nothing warns the author: no card text, no canvas
message, no runtime error. A layout written for 834 and tagged `laptop` will be stretched, and the
only way to notice is to look at the card face.

**An image beside the file.**

```html
<img src="./sketch.png">
```

The page is served on its own, with no sibling lookup and no `<base>`, so `./sketch.png` resolves
against the serving URL and matches no route. The image does not appear — on the card face or in
the second layer. Inline it as a `data:` URI instead, or accept that the page depends on a live
host.

**Content that only appears after a click.**

```html
<p id="reading" hidden>Upper air steady; the low over the coast is gone by morning.</p>
<button onclick="document.getElementById('reading').hidden = false">Show the reading</button>
```

The card face takes no clicks, so this page is an empty frame on the canvas. A reader who opens the
second layer can press the button and get the text, but every reader who does not open it sees
nothing at all. Put the reading in the resting picture; keep the button for the parts that are a
bonus.

## The rule behind all three

1. The file must carry everything it needs — nothing beside it is delivered to the page.
2. The head is the card: the title names it, the description is the only prose most readers ever
   get, and `airp-design` decides how it scales down.
3. The resting picture has to say what the page is for, because that is the version almost every
   reader sees.
