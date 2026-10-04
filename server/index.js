"use strict";
// Starts the game server. Settings come from the environment (see README.md):
//   PORT, HOST            where to listen (default 127.0.0.1:8787)
//   DATABASE_URL          Postgres connection string; without it games live in memory only
//   GAME_SECRET           secret the dice are derived from — required in production
//   CORS_ORIGINS          comma-separated origins allowed to call the API from another site
//   TRUST_PROXY=1         when behind a reverse proxy (so rate limits see the real client IP)
const path = require('path');
const crypto = require('crypto');
const { makeEngine } = require('./engine.js');
const { buildApp } = require('./app.js');

async function main(){
  const config = require(path.join(__dirname, '..', 'src', 'config.json'));
  const production = process.env.NODE_ENV==='production';
  let secret = process.env.GAME_SECRET;
  if(!secret){
    if(production){ console.error('GAME_SECRET must be set in production.'); process.exit(1); }
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('GAME_SECRET not set — using a random one for this run.');
  }
  let store;
  if(process.env.DATABASE_URL){
    store = require('./store-pg.js').makePgStore(process.env.DATABASE_URL);
  } else {
    if(production){ console.error('DATABASE_URL must be set in production.'); process.exit(1); }
    console.warn('DATABASE_URL not set — games are kept in memory and lost on restart.');
    store = require('./store-memory.js').makeMemoryStore();
  }
  await store.init();
  const app = await buildApp({
    store, engine: makeEngine(config, secret), config,
    staticDir: path.join(__dirname, '..', 'dist'),
    corsOrigins: (process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY==='1',
    logger: { level: process.env.LOG_LEVEL || 'info' },
  });
  const port = Number(process.env.PORT)||8787, host = process.env.HOST||'127.0.0.1';
  await app.listen({ port, host });
  const stop = async ()=>{ await app.close(); await store.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(e=>{ console.error(e); process.exit(1); });
