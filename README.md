# sounds mint — official site

Static single-page site for London post-punk four-piece **sounds mint**. Replaces the band's Linktree.

- `index.html` — the whole site (pages: home, music, watch, live, press, about, contact via `#hash` routes)
- `assets/` — logo (ink + white) and band photo

## Deploy
Vercel, imported from this repo. No build step: Framework preset **Other**, output directory `.`

## Editing content
All releases, videos, press, members, timeline and gigs live in the `RELEASES`, `VIDEOS`, `PRESS`, `MEMBERS`, `TIMELINE`, `GIGS_UP` and `GIGS_PAST` arrays near the top of the `<script>` in `index.html`.
Spotify / Apple Music / YouTube players and cover art load automatically on the live domain.
