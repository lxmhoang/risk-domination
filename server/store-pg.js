"use strict";
// Postgres store. Same interface as store-memory.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function makePgStore(connectionString){
  const pool = new Pool({ connectionString, max: 10 });
  const gameRow = r=> r && {
    id:r.id, guestId:r.guest_id, status:r.status, version:r.version, options:r.options, config:r.config,
    mapSeed:r.map_seed, map:r.map, state:r.state, createdAt:r.created_at, updatedAt:r.updated_at,
  };
  return {
    async init(){ await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); },
    async close(){ await pool.end(); },
    async createGuest(tokenHash){
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO guests (id, token_hash) VALUES ($1, $2)', [id, tokenHash]);
      return {id};
    },
    async findGuestByTokenHash(tokenHash){
      const r = await pool.query('SELECT id FROM guests WHERE token_hash = $1', [tokenHash]);
      return r.rows[0] ? {id:r.rows[0].id} : null;
    },
    async createGame({guestId, status, options, config, mapSeed, map, state}){
      const id = crypto.randomUUID();
      await pool.query(
        'INSERT INTO games (id, guest_id, status, options, config, map_seed, map, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, guestId, status, JSON.stringify(options), JSON.stringify(config), mapSeed, JSON.stringify(map), state]);
      return id;
    },
    async getGame(id){
      const r = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
      return gameRow(r.rows[0]) || null;
    },
    async listGames(guestId, limit){
      const r = await pool.query(
        'SELECT id, status, version, options, created_at, updated_at FROM games WHERE guest_id = $1 ORDER BY updated_at DESC LIMIT $2',
        [guestId, limit]);
      return r.rows.map(x=> ({id:x.id, status:x.status, version:x.version, options:x.options, createdAt:x.created_at, updatedAt:x.updated_at}));
    },
    async abandonOldActiveGames(guestId, keep){
      await pool.query(
        `UPDATE games SET status = 'abandoned', updated_at = now()
         WHERE id IN (SELECT id FROM games WHERE guest_id = $1 AND status = 'active' ORDER BY updated_at DESC OFFSET $2)`,
        [guestId, keep]);
    },
    async saveAction(id, expectedVersion, {state, status}, action){
      const client = await pool.connect();
      try{
        await client.query('BEGIN');
        // the version check and the bump are one statement, so two requests can't both win
        const r = await client.query(
          'UPDATE games SET state = $3, status = $4, version = version + 1, updated_at = now() WHERE id = $1 AND version = $2',
          [id, expectedVersion, state, status]);
        if(r.rowCount!==1){ await client.query('ROLLBACK'); return false; }
        await client.query('INSERT INTO game_actions (game_id, seq, action) VALUES ($1, $2, $3)', [id, expectedVersion+1, JSON.stringify(action)]);
        await client.query('COMMIT');
        return true;
      }catch(e){ await client.query('ROLLBACK').catch(()=>{}); throw e; }
      finally{ client.release(); }
    },
    async listActions(id){
      const r = await pool.query('SELECT seq, action FROM game_actions WHERE game_id = $1 ORDER BY seq', [id]);
      return r.rows;
    },
  };
}
module.exports = { makePgStore };
