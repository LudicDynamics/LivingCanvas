# Community QR codes

The contact panel (`the design notes`) shows a scannable image for the channels that
are joined by scanning. Drop the real files here; the table in
`apps/web/src/lib/community.ts` already points at these paths.

| File | Channel | What to export |
|---|---|---|
| `wechat-qr.png` | WeChat official account (公众号) | The account's 二维码 from the 公众平台 backend |
| `qq-qr.png` | QQ group | The group's 群二维码 (note: QQ regenerates these, so re-export when it expires) |

Requirements:

- **PNG, square, at least 264×264** — the panel renders them at 132 CSS px, so
  264 keeps them crisp on a 2× screen. Bigger is fine; they are static assets.
- **Quiet zone included.** Export with the white margin the generator gives you;
  the panel adds 6px of padding on a white ground, which is not enough on its own.
- **No transparency.** A transparent QR on the panel's dark glass is unscannable.

Until a file exists, leave the channel's `todo: true` in `community.ts`: the
panel then shows the channel greyed with "coming soon" instead of a broken
image, and `apps/web/test/community.test.mjs` asserts that every placeholder
value is marked that way.

After dropping a file, in `community.ts` for that channel: replace the
`TODO-value…` value with the real id and delete the `todo: true` line.
