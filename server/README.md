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
| `CORS_ORIGINS` | comma-separated origins allowed to call the API from another site |
| `TRUST_PROXY=1` | set when behind a reverse proxy, so rate limits see the real client address |

## Files

- `engine.js` — wraps the core: `createGame(options)` and `applyAction(game, action)`, both
  synchronous. Returns the full `state` (stored), the player's `view` of it, and the `events`
  to play back.
- `app.js` — the HTTP API (Fastify): guest tokens, ownership, validation, versioning, rate limits.
- `store-pg.js` / `store-memory.js` — where games live; same interface.
- `schema.sql` — Postgres tables: `guests`, `games`, `game_actions` (the audit log).

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
