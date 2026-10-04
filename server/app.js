"use strict";
/* =========================================================================
   HTTP API
   ---------------------------------------------------------------------
     POST /api/guest                    -> {token}          an anonymous player identity
     POST /api/games                    -> a new game       (server makes the map, AIs ahead of you move)
     GET  /api/games                    -> your recent games
     GET  /api/games/:id                -> map + current view (to resume)
     POST /api/games/:id/actions        -> {version, action} => what happened + the new view

   All but /api/guest need `Authorization: Bearer <token>`. The client never
   sends game state — only "I ask to do this" — and only ever receives the
   view of its own games.
   ========================================================================= */
const crypto = require('crypto');
const path = require('path');
const Fastify = require('fastify');

const MAX_ACTIVE_GAMES = 5;   // per guest; starting another abandons the least recently played
const GAME_LIST_LIMIT = 20;
const sha256 = s=> crypto.createHash('sha256').update(s).digest('hex');
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const int = {type:'integer', minimum:0, maximum:100000};
const actionSchema = {
  type:'object', required:['type'], additionalProperties:false,
  properties:{
    type:{enum:['place','trade','attack','moveAfterCapture','endAttack','fortify','endTurn']},
    terrId:int, from:int, to:int, count:int, allOut:{type:'boolean'},
    cards:{type:'array', items:{type:'integer', minimum:0, maximum:200}, minItems:3, maxItems:3},
  },
};
const createSchema = {
  type:'object', required:['players','difficulty','tradeRule','alliance','globalMap'], additionalProperties:false,
  properties:{
    players:{type:'array', minItems:2, maxItems:6, items:{
      type:'object', required:['name','color','personality'], additionalProperties:false,
      properties:{ name:{type:'string', minLength:1, maxLength:24}, color:{type:'string', maxLength:7}, personality:{type:'string', maxLength:20} },
    }},
    difficulty:{type:'string', maxLength:12}, tradeRule:{type:'string', maxLength:12},
    alliance:{type:'boolean'}, globalMap:{type:'boolean'},
  },
};

// options: {store, engine, config, staticDir?, corsOrigins?, rateLimit?, logger?}
async function buildApp(options){
  const { store, engine, config } = options;
  const app = Fastify({
    logger: options.logger||false, bodyLimit: 16*1024, trustProxy: !!options.trustProxy,
    // strict: an unknown field or a wrong type is an error, not something to quietly fix up
    ajv: { customOptions: { removeAdditional:false, coerceTypes:false } },
  });

  if(options.corsOrigins && options.corsOrigins.length){
    await app.register(require('@fastify/cors'), { origin: options.corsOrigins, methods:['GET','POST'] });
  }
  if(options.rateLimit!==false){
    await app.register(require('@fastify/rate-limit'), { global:true, max:600, timeWindow:'1 minute', ...(options.rateLimit||{}) });
  }
  if(options.staticDir){
    await app.register(require('@fastify/static'), { root: path.resolve(options.staticDir) });
  }
  app.addHook('onSend', async (req, reply)=>{
    reply.header('X-Content-Type-Options', 'nosniff');
    if(req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // Never echo internals to the client.
  app.setErrorHandler((err, req, reply)=>{
    if(err.validation) return reply.code(400).send({error:'bad_request'});
    if(err.statusCode===429) return reply.code(429).send({error:'too_many_requests'});
    if(err.statusCode && err.statusCode<500) return reply.code(err.statusCode).send({error:'bad_request'});
    req.log.error(err);
    reply.code(500).send({error:'server_error'});
  });

  async function requireGuest(req, reply){
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization||'');
    const guest = m && await store.findGuestByTokenHash(sha256(m[1]));
    if(!guest) return reply.code(401).send({error:'unauthorized'});
    req.guest = guest;
  }
  // A game the caller doesn't own looks exactly like one that doesn't exist.
  async function loadOwnGame(req, reply){
    const game = await store.getGame(req.params.id);
    if(!game || game.guestId!==req.guest.id){ reply.code(404).send({error:'not_found'}); return null; }
    return game;
  }
  const idParams = {type:'object', required:['id'], properties:{id:{type:'string', pattern:UUID}}};

  app.post('/api/guest', { config:{ rateLimit:{ max:10, timeWindow:'1 minute' } } }, async ()=>{
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createGuest(sha256(token));
    return {token};
  });

  app.post('/api/games', { preHandler:requireGuest, schema:{body:createSchema}, config:{ rateLimit:{ max:20, timeWindow:'1 minute' } } }, async (req, reply)=>{
    const made = engine.createGame(req.body, config);
    if(made.error) return reply.code(422).send({error:made.error});
    const id = await store.createGame({
      guestId:req.guest.id, status:'active', options:req.body, config, mapSeed:made.mapSeed, map:made.map, state:made.state,
    });
    await store.abandonOldActiveGames(req.guest.id, MAX_ACTIVE_GAMES);
    return reply.code(201).send({ id, version:0, map:made.map, state:{...made.view, id}, events:made.events });
  });

  app.get('/api/games', { preHandler:requireGuest }, async (req)=>{
    const games = await store.listGames(req.guest.id, GAME_LIST_LIMIT);
    return { games: games.map(g=> ({
      id:g.id, status:g.status, version:g.version, createdAt:g.createdAt, updatedAt:g.updatedAt,
      players:g.options.players.length, difficulty:g.options.difficulty,
    })) };
  });

  app.get('/api/games/:id', { preHandler:requireGuest, schema:{params:idParams} }, async (req, reply)=>{
    const game = await loadOwnGame(req, reply); if(!game) return;
    return { id:game.id, status:game.status, version:game.version, map:game.map,
      state:{...engine.viewOfState(game.state), id:game.id}, log:JSON.parse(game.state).log };
  });

  app.post('/api/games/:id/actions', {
    preHandler:requireGuest,
    schema:{ params:idParams, body:{ type:'object', required:['version','action'], additionalProperties:false,
      properties:{ version:{type:'integer', minimum:0}, action:actionSchema } } },
  }, async (req, reply)=>{
    const game = await loadOwnGame(req, reply); if(!game) return;
    if(game.status!=='active') return reply.code(409).send({error:'game_not_active', status:game.status});
    // The client must be acting on the current state: stops double submits and replayed requests.
    const stale = ()=> reply.code(409).send({error:'version_mismatch', version:game.version, state:{...engine.viewOfState(game.state), id:game.id}});
    if(req.body.version!==game.version) return stale();
    const res = engine.applyAction(game, req.body.action);
    if(!res.ok) return reply.code(422).send({error:res.error});
    const status = !res.over ? 'active' : (res.view.players[0].alive ? 'won' : 'lost');
    const saved = await store.saveAction(game.id, game.version, {state:res.state, status}, req.body.action);
    if(!saved){
      const fresh = await store.getGame(game.id);
      return reply.code(409).send({error:'version_mismatch', version:fresh.version, state:{...engine.viewOfState(fresh.state), id:fresh.id}});
    }
    return { version:game.version+1, status, result:res.result, events:res.events, state:{...res.view, id:game.id} };
  });

  app.get('/api/health', async ()=> ({ok:true}));
  return app;
}
module.exports = { buildApp, MAX_ACTIVE_GAMES };
