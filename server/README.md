# Game server

Runs the game's shared core (`../dist/core.js` — the same rules, AI and map generator the
browser uses) as the authority for online games: it keeps each game's state, rolls the dice
and plays the AI turns. A client only ever sends "I ask to do this" and gets back what
happened.

## Run it locally

```sh
cd server
npm install
node ../build.js        # builds ../dist (the server loads ../dist/core.js and serves ../dist)
npm start               # http://127.0.0.1:8787
```

Without `DATABASE_URL` games are kept in memory and lost on restart — fine for trying it out.

| Variable | Meaning |
|---|---|
| `PORT`, `HOST` | where to listen (default `127.0.0.1:8787`) |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://localhost/risk`. The schema (`schema.sql`) is applied on startup. |
| `GAME_SECRET` | secret the dice are derived from. Required when `NODE_ENV=production`; keep it out of the repo. |
| `ADMIN_PASSWORD` | enables the admin page at `/admin`. Without it there is no admin access at all. Use a long one. |
| `CORS_ORIGINS` | comma-separated origins allowed to call the API from another site |
| `TRUST_PROXY=1` | set when behind a reverse proxy, so rate limits see the real client address |

Then open http://127.0.0.1:8787 — the menu shows **🌐 Chơi online** when the page is served by
this server (it is hidden when the game is opened as a file or from a static host such as
GitHub Pages, where only offline play exists).

## Files

- `engine.js` — wraps the core: `createGame(options)` and `applyAction(game, action)`, both
  synchronous. Returns the full `state` (stored), the player's `view` of it, and the `events`
  to play back.
- `app.js` — the HTTP API (Fastify): guest tokens, ownership, validation, versioning, rate limits.
- `store-pg.js` / `store-memory.js` — where games live; same interface.
- `admin-config.js`, `admin/` — which settings an admin may change, and the page to do it.
- `schema.sql` — Postgres tables: `guests`, `games`, `game_actions` (the audit log), `settings`.

## Admin page

`http://127.0.0.1:8787/admin` (only when `ADMIN_PASSWORD` is set): edit the game settings used
for online games — AI thresholds per difficulty, AI personalities, alliance and power weights,
cards and reinforcements. The list of editable settings and their allowed ranges is in
`admin-config.js`; the defaults are `../src/config.json`. A change applies to games created
after it is saved; a game in progress keeps the settings it started with. Sessions last 8 hours
and are kept in memory (a restart signs the admin out).

## What the server guarantees

- The client never sends state, only actions; every action is checked against the rules
  (`applyAction()` in `src/js/04b-actions.js`).
- Each request must carry the game's current `version`; a repeated or out-of-date request is
  refused, and of two simultaneous requests only one is applied.
- A player only sees their own games, and never the dice generator's state or other players' cards.
- Dice are re-derived for every request from `GAME_SECRET`, the game's seed and its version,
  so rolls already seen say nothing about the next ones, and a game can be replayed from its
  action log.

## Tests

```sh
npm test                                   # engine + API, in-memory store
DATABASE_URL=postgres://localhost/risk_test node test/api-test.js   # same API test on Postgres
```
