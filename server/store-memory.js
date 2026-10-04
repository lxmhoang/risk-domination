"use strict";
// In-memory store with the same interface as store-pg.js — for tests and for trying the
// server out without a database. Everything is lost when the process exits.
const crypto = require('crypto');

function makeMemoryStore(){
  const guests = new Map();   // id -> {id, tokenHash}
  const games = new Map();    // id -> row
  const actions = new Map();  // gameId -> [{seq, action}]
  const settings = new Map(); // key -> JSON string
  let clock = 0;              // strictly increasing, so "oldest"/"newest" is well defined in tests
  const copy = row=> row && { ...row };

  return {
    async init(){},
    async close(){},
    async createGuest(tokenHash){
      const id = crypto.randomUUID();
      guests.set(id, {id, tokenHash});
      return {id};
    },
    async findGuestByTokenHash(tokenHash){
      for(const g of guests.values()) if(g.tokenHash===tokenHash) return {id:g.id};
      return null;
    },
    async createGame(row){
      const id = crypto.randomUUID();
      games.set(id, {id, version:0, createdAt:++clock, updatedAt:clock, ...row});
      actions.set(id, []);
      return id;
    },
    async getGame(id){ return copy(games.get(id)); },
    async listGames(guestId, limit){
      return [...games.values()].filter(g=> g.guestId===guestId)
        .sort((a,b)=> b.updatedAt-a.updatedAt).slice(0, limit)
        .map(({id,status,version,options,createdAt,updatedAt})=> ({id,status,version,options,createdAt,updatedAt}));
    },
    // Marks all but the `keep` most recently played active games of this guest as abandoned.
    async abandonOldActiveGames(guestId, keep){
      const active = [...games.values()].filter(g=> g.guestId===guestId && g.status==='active').sort((a,b)=> b.updatedAt-a.updatedAt);
      active.slice(keep).forEach(g=>{ g.status = 'abandoned'; });
    },
    // Stores the result of one accepted action. False if the game moved on in the meantime.
    async saveAction(id, expectedVersion, {state, status}, action){
      const g = games.get(id);
      if(!g || g.version!==expectedVersion) return false;
      g.state = state; g.status = status; g.version = expectedVersion+1; g.updatedAt = ++clock;
      actions.get(id).push({seq:g.version, action});
      return true;
    },
    async getSetting(key){ return settings.has(key) ? JSON.parse(settings.get(key)) : null; },
    async setSetting(key, value){ settings.set(key, JSON.stringify(value)); },
    async listActions(id){ return actions.get(id) ? actions.get(id).map(a=> ({...a})) : []; },
  };
}
module.exports = { makeMemoryStore };
