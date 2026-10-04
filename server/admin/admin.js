"use strict";
// Admin page: edits the game settings used for new online games (see ../admin-config.js for
// what is editable; the server validates everything again on save).
(function(){
  const TOKEN_KEY = 'riskDominationAdmin';
  const $ = id=> document.getElementById(id);
  let data = null; // {groups, defaults, values} as last loaded from the server

  async function api(method, url, body){
    const headers = {};
    const token = sessionStorage.getItem(TOKEN_KEY);
    if(token) headers.Authorization = 'Bearer '+token;
    if(body!==undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {method, headers, body: body!==undefined ? JSON.stringify(body) : undefined});
    let json = null; try{ json = await res.json(); }catch(e){}
    return {status:res.status, json};
  }
  function showLogin(text){
    sessionStorage.removeItem(TOKEN_KEY);
    $('adminView').hidden = true; $('loginView').hidden = false;
    $('loginMsg').textContent = text||'';
    $('password').value = ''; $('password').focus();
  }
  function setMsg(text, ok){ const m = $('msg'); m.textContent = text; m.className = ok ? 'ok' : 'bad'; }
  const same = (a,b)=> JSON.stringify(a)===JSON.stringify(b);
  const show = v=> Array.isArray(v) ? v.join(', ') : String(v);

  // The value an input currently holds, or undefined if it isn't a usable value.
  function readInput(inp, field){
    if(field.kind==='enum') return inp.value;
    if(field.kind==='list'){
      const parts = inp.value.split(/[,\s]+/).filter(Boolean).map(Number);
      return parts.length && parts.every(n=> Number.isInteger(n)) ? parts : undefined;
    }
    const n = Number(inp.value);
    return inp.value.trim()!=='' && Number.isFinite(n) ? n : undefined;
  }
  function collect(){
    const values = {}; let bad = null;
    data.groups.forEach(g=> Object.keys(g.fields).forEach(key=>{
      const v = readInput($('f_'+key), g.fields[key]);
      if(v===undefined) bad = bad || g.fields[key].label; else values[key] = v;
    }));
    return {values, bad};
  }
  function refreshMarks(){
    let dirty = false;
    data.groups.forEach(g=> Object.keys(g.fields).forEach(key=>{
      const inp = $('f_'+key), v = readInput(inp, g.fields[key]);
      inp.classList.toggle('changed', !same(v, data.defaults[key]));
      if(!same(v, data.values[key])) dirty = true;
    }));
    $('btnSave').disabled = !dirty;
  }
  function render(){
    const root = $('groups'); root.textContent = '';
    data.groups.forEach(g=>{
      const sec = document.createElement('section');
      const h = document.createElement('h2'); h.textContent = g.title; sec.appendChild(h);
      Object.keys(g.fields).forEach(key=>{
        const f = g.fields[key], row = document.createElement('div'); row.className = 'row';
        const label = document.createElement('label'); label.textContent = f.label; label.htmlFor = 'f_'+key;
        if(f.hint) label.title = f.hint;
        let inp;
        if(f.kind==='enum'){
          inp = document.createElement('select');
          f.options.forEach(([value, text])=>{ const o = document.createElement('option'); o.value = value; o.textContent = text; inp.appendChild(o); });
          inp.value = data.values[key];
        } else {
          inp = document.createElement('input');
          if(f.kind==='number'){ inp.type = 'number'; inp.min = f.min; inp.max = f.max; inp.step = f.step; inp.value = data.values[key]; }
          else { inp.type = 'text'; inp.className = 'list'; inp.value = show(data.values[key]); }
        }
        inp.id = 'f_'+key;
        if(f.hint) inp.title = f.hint;
        inp.addEventListener('input', ()=>{ setMsg('', true); refreshMarks(); });
        const def = document.createElement('span'); def.className = 'def'; def.textContent = 'mặc định '+show(data.defaults[key]);
        if(f.kind==='list'){ row.style.flexWrap = 'wrap'; }
        row.appendChild(label); row.appendChild(inp); row.appendChild(def);
        sec.appendChild(row);
      });
      root.appendChild(sec);
    });
    refreshMarks();
  }
  async function load(){
    const res = await api('GET', '/api/admin/config');
    if(res.status===401) return showLogin('');
    if(res.status!==200) return showLogin('Không tải được cấu hình.');
    data = res.json;
    $('loginView').hidden = true; $('adminView').hidden = false;
    render();
  }
  async function save(values){
    $('btnSave').disabled = true;
    const res = await api('PUT', '/api/admin/config', {values});
    if(res.status===401) return showLogin('Phiên đăng nhập đã hết hạn.');
    if(res.status!==200){
      const f = res.json && res.json.key && data.groups.map(g=> g.fields[res.json.key]).find(Boolean);
      setMsg(f ? 'Giá trị không hợp lệ: '+f.label : 'Không lưu được.', false);
      refreshMarks();
      return;
    }
    data = res.json; render(); setMsg('Đã lưu. Áp dụng cho ván online tạo từ bây giờ.', true);
  }

  $('loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const res = await api('POST', '/api/admin/login', {password: $('password').value});
    if(res.status===200){ sessionStorage.setItem(TOKEN_KEY, res.json.token); load(); }
    else showLogin(res.status===429 ? 'Thử quá nhiều lần, đợi một phút.' : 'Sai mật khẩu.');
  });
  $('btnSave').addEventListener('click', ()=>{
    const {values, bad} = collect();
    if(bad){ setMsg('Chưa hợp lệ: '+bad, false); return; }
    save(values);
  });
  $('btnReset').addEventListener('click', ()=>{
    if(confirm('Đưa toàn bộ cấu hình ván online về mặc định?')) save({});
  });
  $('btnLogout').addEventListener('click', async ()=>{ await api('POST', '/api/admin/logout'); showLogin(''); });

  if(sessionStorage.getItem(TOKEN_KEY)) load(); else showLogin('');
})();
