# Third Party Notices

This Game Mode embeds the following open-source game, used under its license.

## Minesweeper (upstream)

- Source: https://github.com/PitPik/minesweeper
- Author: PitPik
- Ported from commit: `62c490102a417d8887f79cd627a1f17686a65a4f`
- License: MIT

The upstream game (`app.js`, `index.html`, `index.css`, and the license text) is included
largely unmodified except for a scoring seam added in `app.js` (a left-click reveal calls
`window.__ms_onReveal(cells)`). The full upstream license text is in `UPSTREAM-LICENSE.txt`.
