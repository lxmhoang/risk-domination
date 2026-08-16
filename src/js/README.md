# Module map

Files are concatenated in filename order (`01-`, `02-`, ... prefixes = load/dependency
order) into one IIFE by `build.js`. They all share the same top-level scope — exactly
like the old single-file version — so there's no import/export ceremony, just files
split at the same logical boundaries the code already had.

- **01-utils.js** — DOM helpers (`$`, `el`), RNG helpers, Vietnamese name generation
  (`finalizeTerrName`, `finalizeContName`, prefix/base word lists), string sanitization.
- **02-map-model.js** — the map data model: `newMap`, `createTerritory`/`createContinent`,
  cell painting/flood-fill, water-mask generation, `generateRandomMap`, connected-component
  analysis, isolated-landmass bridging (`ensureNoIsolatedTerritories`).
- **03-editor.js** — map editor UI: canvas painting tools, sidebar accordion panels,
  territory/continent list rendering, validate/export/import.
- **04-game-state.js** — core game state machine: `initGame`, setup-place phase,
  reinforcement, combat resolution (`doBattle`), fortify, turn/elimination/win logic.
- **05-ai.js** — AI opponent logic (reinforcement targeting, attack scoring with reserve
  keeping / continent-completion / kill-priority, fortify). Has an inline "design doc"
  comment block explaining the strategy.
- **06-render-game.js** — game screen canvas rendering (territories, continent-view mode,
  stripe highlight overlay, labels).
- **07-cards-modal.js** — Risk card trade-in modal.
- **08-wiring.js** — DOM event listeners, screen navigation, app entry point, and the
  `window.__debug` testing hooks.

## Editing

Pick the file that owns the feature you're touching, edit it, then run `npm run build`
(or `node build.js`) to regenerate `dist/index.html`. That's the file to open in a
browser or hand to a player — the `src/` files alone won't run.
