#!/usr/bin/env node
"use strict";
// Admin test: the admin API is off without a password, locked without a session, validates
// every value, and a saved change reaches new games only.
const assert = require('assert');
const path = require('path');
const { makeEngine } = require('../engine.js');
const { buildApp } = require('../app.js');
const { makeMemoryStore } = require('../store-memory.js');
const CONFIG = require(path.join(__dirname, '..', '..', 'src', 'config.json'));

const OPTIONS = {
  players: [{name:'Bạn', color:'#ef5b6b', personality:'balanced'}, {name:'Caesar', color:'#5b8def', personality:'rusher'}],
  difficulty:'normal', tradeRule:'progressive', alliance:false, globalMap:true,
};
const caller = app=> async (method, url, token, body)=>{
  const res = await app.inject({ method, url, headers: token ? {authorization:'Bearer '+token} : {}, payload: body });
  let json = null; try{ json = res.json(); }catch(e){}
  return { status:res.statusCode, json, headers:res.headers };
};

async function main(){
  // ---- no password configured: there is no admin at all ----
  {
    const app = await buildApp({ store:makeMemoryStore(), engine:makeEngine(CONFIG, 's'), config:CONFIG });
    const call = caller(app);
    for(const [m,u] of [['GET','/admin'],['GET','/api/admin/config'],['POST','/api/admin/login'],['PUT','/api/admin/config']])
      assert.strictEqual((await call(m, u, null, m==='GET' ? undefined : {password:'x'})).status, 404, m+' '+u);
    await app.close();
  }

  const store = makeMemoryStore();
  const app = await buildApp({ store, engine:makeEngine(CONFIG, 's'), config:CONFIG, adminPassword:'correct horse battery' });
  const call = caller(app);

  // ---- locked without a session ----
  assert.strictEqual((await call('GET', '/api/admin/config')).status, 401);
  assert.strictEqual((await call('PUT', '/api/admin/config', null, {values:{}})).status, 401);
  const guest = (await call('POST', '/api/guest')).json.token;
  assert.strictEqual((await call('GET', '/api/admin/config', guest)).status, 401, 'a player token is not an admin session');
  assert.strictEqual((await call('PUT', '/api/admin/config', guest, {values:{reinforceMin:20}})).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/login', null, {password:'wrong'})).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/login', null, {})).status, 400);
  const page = await call('GET', '/admin');
  assert.strictEqual(page.status, 200);
  assert.ok(/frame-ancestors 'none'/.test(page.headers['content-security-policy']));

  const admin = (await call('POST', '/api/admin/login', null, {password:'correct horse battery'})).json.token;
  assert.ok(admin);
  assert.strictEqual((await call('GET', '/api/games', admin)).status, 401, 'an admin session is not a player');

  // ---- reading ----
  const cfg = (await call('GET', '/api/admin/config', admin)).json;
  assert.deepStrictEqual(cfg.values, cfg.defaults);
  assert.strictEqual(cfg.defaults.reinforceMin, CONFIG.reinforceMin);
  assert.ok(!('spectatorModeDelayMs' in cfg.defaults), 'display-only settings are not offered');

  // ---- every value is checked ----
  for(const [values, error, key] of [
    [{reinforceMin:'9'}, 'bad_value', 'reinforceMin'],
    [{reinforceMin:999}, 'bad_value', 'reinforceMin'],
    [{reinforceMin:NaN}, 'bad_value', 'reinforceMin'],
    [{aiHardThreshold:0.2}, 'bad_value', 'aiHardThreshold'],
    [{cardAwardEvent:'always'}, 'bad_value', 'cardAwardEvent'],
    [{tradeValues:[]}, 'bad_value', 'tradeValues'],
    [{tradeValues:[4,'6']}, 'bad_value', 'tradeValues'],
    [{tradeValues:[4,-1]}, 'bad_value', 'tradeValues'],
    [{tradeValues:Array(50).fill(5)}, 'bad_value', 'tradeValues'],
    [{spectatorModeDelayMs:1}, 'unknown_setting', 'spectatorModeDelayMs'],
    [{__proto__x:1}, 'unknown_setting', '__proto__x'],
    [{constructor:1}, 'unknown_setting', 'constructor'],
  ]){
    const r = await call('PUT', '/api/admin/config', admin, {values});
    assert.strictEqual(r.status, 422, JSON.stringify(values));
    assert.strictEqual(r.json.error, error); assert.strictEqual(r.json.key, key);
  }
  assert.strictEqual((await call('PUT', '/api/admin/config', admin, {values:[1]})).status, 400);
  assert.deepStrictEqual((await call('GET', '/api/admin/config', admin)).json.values, cfg.defaults, 'refused changes change nothing');

  // ---- a saved change reaches new games, not existing ones ----
  const before = (await call('POST', '/api/games', guest, OPTIONS)).json;
  const saved = await call('PUT', '/api/admin/config', admin, {values:{...cfg.defaults, reinforceMin:9, cardAwardEvent:'on_turn_end'}});
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.json.values.reinforceMin, 9);
  assert.deepStrictEqual(await store.getSetting('game_config'), {reinforceMin:9, cardAwardEvent:'on_turn_end'}, 'only the differences are stored');
  const after = (await call('POST', '/api/games', guest, OPTIONS)).json;
  assert.strictEqual((await store.getGame(before.id)).config.reinforceMin, CONFIG.reinforceMin);
  assert.strictEqual((await store.getGame(after.id)).config.reinforceMin, 9);
  // 2 players on ~39 territories: the base income is well under 9, so the new minimum is what shows
  assert.ok(before.state.reinforceRemaining<9, 'old default in the earlier game');
  assert.ok(after.state.reinforceRemaining>=9, 'new minimum in the later game');
  // the earlier game keeps playing under its own settings
  const mine = Number(Object.keys(before.state.owner).find(t=> before.state.owner[t]===0));
  assert.strictEqual((await call('POST', '/api/games/'+before.id+'/actions', guest, {version:0, action:{type:'place', terrId:mine}})).status, 200);

  // ---- back to defaults ----
  const reset = await call('PUT', '/api/admin/config', admin, {values:{}});
  assert.deepStrictEqual(reset.json.values, cfg.defaults);
  assert.deepStrictEqual(await store.getSetting('game_config'), {});

  // ---- logout ends the session; login attempts are rate limited ----
  assert.strictEqual((await call('POST', '/api/admin/logout', admin)).status, 200);
  assert.strictEqual((await call('GET', '/api/admin/config', admin)).status, 401);
  let limited = false;
  for(let i=0;i<8;i++){ if((await call('POST', '/api/admin/login', null, {password:'guess'+i})).status===429){ limited = true; break; } }
  assert.ok(limited, 'password guessing should be rate limited');

  await app.close();
  console.log('Admin: off without a password, locked without a session, values validated, changes reach new games only.');
}
main().catch(e=>{ console.error(e); process.exit(1); });
