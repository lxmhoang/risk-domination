-- Risk Domination server schema (Postgres). Applied on startup by store-pg.js; safe to re-run.

CREATE TABLE IF NOT EXISTS guests (
  id          uuid PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,          -- sha256 of the bearer token; the token itself is never stored
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id          uuid PRIMARY KEY,
  guest_id    uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('active', 'won', 'lost', 'abandoned')),
  version     integer NOT NULL DEFAULT 0,    -- +1 per accepted action; guards against replays and double submits
  options     jsonb NOT NULL,                -- what the player asked for (players, difficulty, …)
  config      jsonb NOT NULL,                -- rule settings in force when the game was created
  map_seed    text NOT NULL,
  map         jsonb NOT NULL,
  state       text NOT NULL,                 -- the full game state as the core serializes it (includes the seed)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_guest_idx ON games (guest_id, updated_at DESC);

-- Every accepted action, in order: the audit trail, and enough to replay a game from its seed.
CREATE TABLE IF NOT EXISTS game_actions (
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq         integer NOT NULL,              -- the game version this action produced
  action      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, seq)
);
