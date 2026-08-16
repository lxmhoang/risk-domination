# Risk: Domination

A single-player-vs-AI, Risk-style territory conquest game with a hand-drawn map editor
(no official Risk map/assets — you paint your own territories and continents). Classic
Risk ruleset: continent bonuses, card trading, dice combat, fortify. Play against 1-5 AI
opponents, or watch AI play itself in spectator mode.

## Playing

Open **`dist/index.html`** directly in any browser. No server, no install, no build step
needed to play — it's a single self-contained file.

## Developing

The source is split into small files under `src/` (see `src/js/README.md` for what each
one does). After editing, rebuild the single-file artifact:

```
npm run build
# or: node build.js
```

This regenerates `dist/index.html` by concatenating `src/style.css` + `src/body.html` +
`src/js/*.js` (in filename order) into `src/shell.html`. No bundler or external
dependencies are used — `build.js` is plain Node.

## Project layout

```
src/
  shell.html      the <!DOCTYPE>/<head>/<body> skeleton with __STYLE__/__BODY__/__SCRIPT__ placeholders
  style.css       all CSS
  body.html       the screen markup (menu / editor / setup / game)
  config.json     runtime-tunable settings (e.g. spectator mode delay), inlined at build time
  js/             game logic, split by feature (see src/js/README.md)
build.js          build script — concatenates src/ into dist/index.html
dist/
  index.html      the shippable single-file game (generated, but committed so it's
                   always playable straight out of a clone without running the build)
```
