/* =========================================================================
   ONLINE GAMES — the game runs on the server, this only shows it
   ---------------------------------------------------------------------
   In an online game the rules, dice and AI all run on the server (server/).
   The browser sends each move as an action and gets back what happened: a
   list of events — the same things the core would have asked the UI to show
   in an offline game (render, log line, dice, turn banner, attack animation,
   a pause where the AI "thinks") — each carrying the part of the game that
   changed. Playing them back in order through the usual UI functions makes
   an online game look exactly like an offline one.

   `game` here is only the player's view (no dice state, no other players'
   cards). Changing it in the console changes the picture, not the game.
   ========================================================================= */
const GUEST_TOKEN_KEY = 'riskDominationGuest';
let onlineAvailable = false; // a game server answered at this page's own origin
let onlineGame = null;       // {id, version, busy} while the game on screen is an online one
let setupForOnline = false;  // the setup screen is configuring an online game

function isOnlineGame(){ return !!onlineGame; }
function leaveOnlineGame(){ onlineGame = null; }

async function apiCall(method, url, body){
  const headers = {};
  const token = localStorage.getItem(GUEST_TOKEN_KEY);
  if(token) headers.Authorization = 'Bearer '+token;
  if(body!==undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body!==undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try{ json = await res.json(); }catch(e){}
  return { status: res.status, json };
}
// Like apiCall(), but makes sure there is a guest identity first (and gets a new one if the
// server no longer knows ours).
async function apiCallAsGuest(method, url, body){
  if(!localStorage.getItem(GUEST_TOKEN_KEY)) await newGuestToken();
  let res = await apiCall(method, url, body);
  if(res.status===401){ await newGuestToken(); res = await apiCall(method, url, body); }
  return res;
}
async function newGuestToken(){
  localStorage.removeItem(GUEST_TOKEN_KEY);
  const res = await apiCall('POST', '/api/guest');
  if(res.status!==200 || !res.json || !res.json.token) throw new Error('guest');
  localStorage.setItem(GUEST_TOKEN_KEY, res.json.token);
}

const ONLINE_ERROR_TEXT = {
  bad_player_name: 'Tên người chơi không hợp lệ (tối đa 24 ký tự, không dùng < > & " \' `).',
  bad_player_color: 'Mỗi người chơi phải có một màu khác nhau.',
  too_many_requests: 'Bạn thao tác quá nhanh, đợi một chút rồi thử lại.',
  game_not_active: 'Ván này đã kết thúc hoặc đã bị thay bằng ván mới hơn.',
};
function onlineErrorText(code){ return ONLINE_ERROR_TEXT[code] || 'Không thực hiện được, thử lại sau.'; }

// Applies the part of the view an event says changed.
function applyViewPatch(patch){
  if(!patch) return;
  for(const k of Object.keys(patch)){
    if(k==='owner' || k==='armies') Object.assign(game[k], patch[k]);
    else game[k] = patch[k];
  }
}

// Plays events in order. Everything is immediate except the two things an offline game also
// waits for: the AI's pauses (through aiSchedule(), so ⏸️ still works) and attack animations.
// onSync runs once the immediate part of the list is done — i.e. at the point an offline
// applyAction() would have returned; onDone when the whole list has played.
function playOnlineEvents(events, onSync, onDone){
  let i = 0, syncDone = false;
  const reachedSync = ()=>{ if(!syncDone){ syncDone = true; if(onSync) onSync(); } };
  function next(){
    while(i<events.length){
      const ev = events[i++];
      applyViewPatch(ev.patch);
      switch(ev.t){
        case 'render': renderGame(); break;
        case 'log': game.log.push(ev.entry); renderCombatLog(); break;
        case 'hint': setActionHint(ev.msg); break;
        case 'dice': showDice(ev.ad, ev.dd, ev.results); break;
        case 'turn': showTurnIntro(game.players[ev.pid]); break;
        case 'cards': openCardsModal(ev.forced); break;
        case 'over': showGameOver(ev.winnerId!=null ? game.players[ev.winnerId] : undefined); break;
        case 'anim': reachedSync(); startAttackAnim(ev.info, next); renderGame(); return;
        case 'wait': reachedSync(); aiSchedule(next, ev.ms); return;
      }
    }
    reachedSync();
    if(onDone) onDone();
  }
  next();
}

// Puts a game from the server on screen. `state` is the player's view of it.
function showOnlineGame(id, version, map, state, log){
  mapData = mapFromPlainObject(map);
  spectatorMode = false;
  aiPaused = false; pendingAIResume = null;
  host.onGameInit();
  game = state;
  game.log = log || [];
  onlineGame = { id, version, busy:false };
  showScreen('screen-game');
  maybeRotateMapForPortrait();
  renderGame();
  renderCombatLog();
}

async function startOnlineGame(playerConfigs, difficulty, alliance, tradeRule, globalMap){
  let res;
  try{
    res = await apiCallAsGuest('POST', '/api/games', {
      players: playerConfigs.map(c=>({name:c.name, color:c.color, personality:c.personality})),
      difficulty, tradeRule, alliance, globalMap,
    });
  }catch(e){ alert('Không kết nối được tới máy chủ.'); return; }
  if(res.status!==201){ alert(onlineErrorText(res.json && res.json.error)); return; }
  const g = res.json;
  // Start from an empty board of the right shape, then let the opening events fill it in the
  // way an offline game's first moments would (AIs ahead of the player take their turns).
  showOnlineGame(g.id, g.version, g.map, g.state, []);
  onlineGame.busy = true;
  playOnlineEvents(g.events, null, ()=> finishOnlineStep(g.state, g.version));
}

// Offers to pick up the most recent unfinished online game. Resolves true if one was loaded.
async function resumeOnlineGame(){
  let list;
  try{ list = await apiCallAsGuest('GET', '/api/games'); }catch(e){ return false; }
  const active = list.status===200 ? list.json.games.find(g=> g.status==='active') : null;
  if(!active) return false;
  if(!confirm('Bạn có một ván online đang chơi dở. Chơi tiếp ván đó?')) return false;
  const res = await apiCallAsGuest('GET', '/api/games/'+active.id);
  if(res.status!==200) return false;
  const g = res.json;
  showOnlineGame(g.id, g.version, g.map, g.state, g.log);
  afterOnlineStateLoaded();
  return true;
}
// The server always stops with the player to move (or the game over) — pick up whatever dialog
// that state calls for.
function afterOnlineStateLoaded(){
  if(game.over){ const w = game.players.find(p=> p.alive); showGameOver(w); return; }
  const me = game.players[0];
  if(game.phase==='reinforce' && currentPlayerId()===me.id && me.cards.length>=5) openCardsModal(true);
}

// The authoritative view replaces whatever the events added up to (they should already match).
function finishOnlineStep(state, version, phaseBefore){
  const log = game.log;
  const selFrom = game.selectedFrom, selTo = game.selectedTo;
  game = state; game.log = log;
  // Which territories are highlighted is the player's own business for as long as they stay in
  // the same phase of their move (the server knows nothing of it); a new phase starts clean.
  if(currentPlayer().isHuman && !game.over && game.phase===phaseBefore){ game.selectedFrom = selFrom; game.selectedTo = selTo; }
  onlineGame.version = version;
  onlineGame.busy = false;
  renderGame();
}

// dispatch() for an online game: ask the server, then play back what it says happened.
// Returns straight away; onResult is called once the immediate effects have been shown.
function dispatchOnline(action, onResult){
  const og = onlineGame;
  if(og.busy) return {ok:false, error:'busy'};
  og.busy = true;
  const phaseBefore = game.phase;
  const fail = (error, text)=>{
    og.busy = false;
    if(text) setActionHint(text);
    if(onResult) onResult({ok:false, error});
    renderGame();
  };
  apiCallAsGuest('POST', '/api/games/'+og.id+'/actions', {version:og.version, action}).then(res=>{
    if(onlineGame!==og) return; // the player left this game in the meantime
    const j = res.json || {};
    if(res.status===200){
      playOnlineEvents(j.events, null, ()=>{
        finishOnlineStep(j.state, j.version, phaseBefore);
        if(onResult) onResult({ok:true, result:j.result});
      });
      return;
    }
    if(res.status===409 && j.state){ // we were out of date — take the server's view and carry on
      const log = game.log; game = j.state; game.log = log; og.version = j.version;
      fail(j.error, 'Đã đồng bộ lại với máy chủ, hãy thao tác lại.');
      return;
    }
    if(res.status===422){ fail(j.error); return; } // refused by the rules
    fail(j.error || 'server_error', onlineErrorText(j.error));
  }).catch(()=>{ if(onlineGame===og) fail('network', 'Mất kết nối tới máy chủ. Hãy thử lại.'); });
  return {ok:true, pending:true};
}

// Is there a game server behind this page? (Not when opened as a file or from a static host.)
function detectOnlineServer(){
  if(!/^https?:$/.test(location.protocol)) return;
  fetch('/api/health').then(r=> r.ok ? r.json() : null).then(j=>{
    if(!j || !j.ok) return;
    onlineAvailable = true;
    $('btnPlayOnline').hidden = false;
  }).catch(()=>{});
}
