#!/usr/bin/env node
"use strict";
// API test: the HTTP layer end to end (in-process, in-memory store), with the emphasis on what
// a tampering client could try. Set DATABASE_URL to run the same test against Postgres.
const assert = require('assert');
const path = require('path');
const { makeEngine } = require('../engine.js');
const { buildApp, MAX_ACTIVE_GAMES } = require('../app.js');
const CONFIG = require(path.join(__dirname, '..', '..', 'src', 'config.json'));

const OPTIONS = {
  players: [
    {name:'Bạn', color:'#ef5b6b', personality:'balanced'},
    {name:'Caesar', color:'#5b8def', personality:'rusher'},
    {name:'Napoleon', color:'#4ac97e', personality:'turtle'},
  ],
  difficulty:'normal', tradeRule:'progressive', alliance:true, globalMap:true,
};

async function main(){
  const store = process.env.DATABASE_URL
    ? require('../store-pg.js').makePgStore(process.env.DATABASE_URL)
    : require('../store-memory.js').makeMemoryStore();
  await store.init();
  const engine = makeEngine(CONFIG, 'test-secret');
  const app = await buildApp({ store, engine, config:CONFIG });
  const call = async (method, url, token, body)=>{
    const res = await app.inject({ method, url, headers: token ? {authorization:'Bearer '+token} : {}, payload: body });
    let json = null; try{ json = res.json(); }catch(e){}
    return { status:res.statusCode, json, raw:res.body };
  };

  // ---- identity ----
  assert.strictEqual((await call('GET', '/api/games')).status, 401);
  assert.strictEqual((await call('GET', '/api/games', 'x'.repeat(43))).status, 401);
  assert.strictEqual((await call('POST', '/api/games', null, OPTIONS)).status, 401);
  const alice = (await call('POST', '/api/guest')).json.token;
  const mallory = (await call('POST', '/api/guest')).json.token;
  assert.ok(alice && mallory && alice!==mallory);

  // ---- creating a game ----
  assert.strictEqual((await call('POST', '/api/games', alice, {})).status, 400);
  assert.strictEqual((await call('POST', '/api/games', alice, {...OPTIONS, extra:1})).status, 400);
  assert.deepStrictEqual((await call('POST', '/api/games', alice, {...OPTIONS, difficulty:'god'})).json, {error:'bad_difficulty'});
  const created = await call('POST', '/api/games', alice, OPTIONS);
  assert.strictEqual(created.status, 201);
  const id = created.json.id;
  let version = created.json.version, state = created.json.state;
  assert.strictEqual(version, 0);
  assert.ok(created.json.map.cellTerritory && created.json.events.length);
  // secrets never leave the server
  for(const leak of ['"rng"', '"seed"', '"startSnapshot"', 'test-secret']) assert.ok(!created.raw.includes(leak), 'leaked '+leak);

  // ---- someone else's game doesn't exist as far as they can tell ----
  assert.strictEqual((await call('GET', '/api/games/'+id, mallory)).status, 404);
  assert.strictEqual((await call('POST', '/api/games/'+id+'/actions', mallory, {version:0, action:{type:'endTurn'}})).status, 404);
  assert.strictEqual((await call('GET', '/api/games/not-a-uuid', alice)).status, 400);
  assert.strictEqual((await call('GET', '/api/games/00000000-0000-4000-8000-000000000000', alice)).status, 404);
  assert.deepStrictEqual((await call('GET', '/api/games', mallory)).json, {games:[]});
  assert.strictEqual((await call('GET', '/api/games', alice)).json.games.length, 1);

  // ---- resuming gives the same view ----
  const resumed = await call('GET', '/api/games/'+id, alice);
  assert.strictEqual(resumed.status, 200);
  assert.deepStrictEqual(resumed.json.state, state);
  assert.ok(Array.isArray(resumed.json.log) && resumed.json.log.length>0);
  assert.ok(!resumed.raw.includes('"rng"'));

  const act = (action, v=version, token=alice)=> call('POST', '/api/games/'+id+'/actions', token, {version:v, action});
  const mine = ()=> Object.keys(state.owner).map(Number).filter(t=> state.owner[t]===0);

  // ---- malformed requests ----
  for(const body of [
    {action:{type:'endTurn'}},                                    // no version
    {version:0, action:{type:'explode'}},
    {version:0, action:{type:'place', terrId:'1'}},
    {version:0, action:{type:'place', terrId:1, armies:99}},      // unknown field
    {version:0, action:{type:'trade', cards:[0,1]}},
    {version:0, action:{type:'endTurn'}, state:{armies:{1:999}}}, // trying to send state
    {version:-1, action:{type:'endTurn'}},
  ]) assert.strictEqual((await call('POST', '/api/games/'+id+'/actions', alice, body)).status, 400, JSON.stringify(body));
  const big = await call('POST', '/api/games/'+id+'/actions', alice, {version:0, action:{type:'endTurn'}, pad:'x'.repeat(20000)});
  assert.ok(big.status===413 || big.status===400);

  // ---- rule-breaking requests are refused and change nothing ----
  const enemy = Object.keys(state.owner).map(Number).find(t=> state.owner[t]!==0);
  for(const [action, error] of [
    [{type:'endTurn'}, 'wrong_phase'],
    [{type:'attack', from:mine()[0], to:enemy}, 'wrong_phase'],
    [{type:'place', terrId:enemy}, 'not_your_territory'],
    [{type:'place', terrId:99999}, 'not_your_territory'],
    [{type:'moveAfterCapture', count:50}, 'nothing_to_move'],
  ]){
    const r = await act(action);
    assert.strictEqual(r.status, 422); assert.deepStrictEqual(r.json, {error});
  }
  assert.deepStrictEqual((await call('GET', '/api/games/'+id, alice)).json.state, state);
  assert.strictEqual((await call('GET', '/api/games/'+id, alice)).json.version, 0);

  // ---- a stale or repeated request is refused ----
  const placed = await act({type:'place', terrId:mine()[0]});
  assert.strictEqual(placed.status, 200);
  assert.strictEqual(placed.json.version, 1);
  assert.strictEqual(placed.json.state.armies[mine()[0]], state.armies[mine()[0]]+1);
  const replay = await act({type:'place', terrId:mine()[0]}, 0);
  assert.strictEqual(replay.status, 409);
  assert.strictEqual(replay.json.error, 'version_mismatch');
  assert.strictEqual(replay.json.version, 1);
  assert.strictEqual((await act({type:'place', terrId:mine()[0]}, 7)).status, 409);
  version = 1; state = placed.json.state;

  // ---- two identical requests at once: exactly one counts ----
  if(state.reinforceRemaining>0){
    const [a, b] = await Promise.all([act({type:'place', terrId:mine()[0]}), act({type:'place', terrId:mine()[0]})]);
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
    const won = a.status===200 ? a : b;
    version = won.json.version; state = won.json.state;
  }

  // ---- play on to the end of the turn; the AIs' moves come back as events ----
  while(state.phase==='reinforce'){
    const r = await act({type:'place', terrId:mine()[0]});
    assert.strictEqual(r.status, 200);
    version = r.json.version; state = r.json.state;
  }
  let r = await act({type:'endAttack'}); assert.strictEqual(r.status, 200); version = r.json.version; state = r.json.state;
  r = await act({type:'endTurn'}); assert.strictEqual(r.status, 200); version = r.json.version; state = r.json.state;
  assert.ok(r.json.events.some(e=> e.t==='turn') && r.json.events.some(e=> e.t==='wait'), 'AI turns arrive as events');
  assert.ok(!r.raw.includes('"rng"') && !r.raw.includes('"seed"'));
  assert.ok(state.players.slice(1).every(p=> p.cards.every(c=> c==='?')), 'other hands stay hidden');
  assert.strictEqual(state.turnOrder[state.turnIdx], 0);
  assert.strictEqual((await store.listActions(id)).length, version, 'every accepted action is logged');

  // ---- starting more games than allowed abandons the oldest, which then accepts nothing ----
  for(let i=0;i<MAX_ACTIVE_GAMES;i++) assert.strictEqual((await call('POST', '/api/games', alice, OPTIONS)).status, 201);
  const old = await act({type:'place', terrId:mine()[0]});
  assert.strictEqual(old.status, 409);
  assert.deepStrictEqual({error:old.json.error, status:old.json.status}, {error:'game_not_active', status:'abandoned'});
  const list = (await call('GET', '/api/games', alice)).json.games;
  assert.strictEqual(list.filter(g=> g.status==='active').length, MAX_ACTIVE_GAMES);

  // ---- rate limit on creating identities ----
  let limited = false;
  for(let i=0;i<12;i++){ const g = await call('POST', '/api/guest'); if(g.status===429){ limited = true; assert.deepStrictEqual(g.json, {error:'too_many_requests'}); break; } }
  assert.ok(limited, 'guest creation should be rate limited');

  await app.close(); await store.close();
  console.log('API: auth, ownership, validation, versioning, concurrency, abandonment and rate limit all hold ('+(process.env.DATABASE_URL?'Postgres':'memory')+' store).');
}
main().catch(e=>{ console.error(e); process.exit(1); });
