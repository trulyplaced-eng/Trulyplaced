/* TrulyPlaced — shared code for login.html, team.html (team portal) and portal.html (client dashboard).
   Uses the same Supabase project and sign-in as the job board (app.html) and the resume editor, so one sign-in works
   everywhere. Keys here are the public "publishable" ones; the secret keys live only in Supabase. */
(function(){
"use strict";

var CONFIG = {
  SUPABASE_URL: 'https://yubgrhxdhofnynfocpef.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_1CHFJ4-tBN42ThTgDqgvpg_xcVjzpg5',
  BUCKET: 'client-files',                 // private storage for resume files and confirmation screenshots
  WHATSAPP: 'https://wa.me/918142442139',
  SUPPORT_EMAIL: 'hello@trulyplaced.com',
  PLANS: [250, 500, 1000]
};
var VERSION = '2026-10-30.1';
var SBLIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

/* ---------- small helpers ---------- */
var $ = function(s, r){ return (r || document).querySelector(s); };
var $$ = function(s, r){ return [].slice.call((r || document).querySelectorAll(s)); };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function debounce(fn, ms){ var t; return function(){ var a = arguments, me = this; clearTimeout(t); t = setTimeout(function(){ fn.apply(me, a); }, ms); }; }
function lsGet(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
// sessionStorage belongs to one browser tab, so two tabs working on two clients never share it
function ssGet(k, d){ try{ var v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function ssSet(k, v){ try{ sessionStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function uid(){ return Math.random().toString(36).slice(2, 10); }
// a short message at the bottom; with {undo:fn} it carries an Undo button for 8 seconds (Ctrl+Z works too)
var UNDO = null;
function toast(m, o){
  var t = $('#toast'); if(!t){ t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
  o = o || {}; clearTimeout(toast._t); UNDO = null;
  t.textContent = m;
  if(o.undo){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tbtn'; b.textContent = o.label || 'Undo';
    UNDO = function(){ UNDO = null; clearTimeout(toast._t); t.classList.remove('on', 'act'); o.undo(); };
    b.onclick = function(){ if(UNDO) UNDO(); };
    t.appendChild(b);
  }
  t.classList.toggle('act', !!o.undo); t.classList.add('on');
  toast._t = setTimeout(function(){ UNDO = null; t.classList.remove('on', 'act'); }, o.ms || (o.undo ? 8000 : 3000));
}
document.addEventListener('keydown', function(e){
  if(!UNDO || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  var a = document.activeElement; if(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;   // there Ctrl+Z undoes typing
  e.preventDefault(); UNDO();
});
// a button that saves: disabled with a spinner until it's done, so a double click never does it twice
function busy(btn, p){
  if(btn){ btn.disabled = true; btn.classList.add('busy'); }
  var end = function(){ if(btn){ btn.disabled = false; btn.classList.remove('busy'); } };
  return Promise.resolve(p).then(function(v){ end(); return v; }, function(e){ end(); throw e; });
}
function copy(text, what){
  var done = function(){ toast((what || 'Text') + ' copied'); };
  if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text || '')).then(done, function(){ fallback(); });
  fallback(); return Promise.resolve();
  function fallback(){ var a = document.createElement('textarea'); a.value = String(text || ''); a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select();
    try{ document.execCommand('copy'); done(); }catch(e){ toast('Select the text and copy it'); } a.remove(); }
}
function fmtDate(ts){ if(!ts) return ''; try{ return new Date(ts).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}); }catch(e){ return ''; } }
function fmtDateTime(ts){ if(!ts) return ''; try{ var d = new Date(ts); return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) + ', ' + d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}); }catch(e){ return ''; } }
function ago(ts){
  if(!ts) return '';
  var s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if(s < 60) return 'just now';
  if(s < 3600) return Math.floor(s / 60) + ' min ago';
  if(s < 86400) return Math.floor(s / 3600) + ' h ago';
  var d = Math.floor(s / 86400); if(d === 1) return 'yesterday';
  if(d < 30) return d + ' days ago';
  return fmtDate(ts);
}
function initials(name, email){
  var p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(p.length) return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  return String(email || '?').charAt(0).toUpperCase();
}
var PAL = ['#0938d5','#0a7f46','#7c3aed','#c2410c','#0e7490','#be185d','#4338ca','#15803d','#b45309','#1d4ed8'];
function hue(s){ s = String(s || ''); var h = 0; for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PAL[h % PAL.length]; }
function logo(company, domain){
  var img = domain ? '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&amp;sz=128" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
  return '<span class="logo" style="background:' + hue(company) + '" aria-hidden="true">' + esc(String(company || '?').charAt(0).toUpperCase()) + img + '</span>';
}
var STATUS = [['draft','Draft'],['applied','Applied'],['interview','Interview'],['offer','Offer'],['rejected','Not selected'],['closed','Closed']];
function statusLabel(s){ for(var i = 0; i < STATUS.length; i++) if(STATUS[i][0] === s) return STATUS[i][1]; return s || ''; }
function statusChip(s){ return '<span class="st ' + esc(s) + '">' + esc(statusLabel(s)) + '</span>'; }
// the address of a job without tracking bits, so the same job pasted twice is spotted
function cleanUrl(u){
  try{
    var x = new URL(String(u).trim());
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gh_src','source','src','ref','refId','trk','trackingId','lever-source','lever-origin'].forEach(function(k){ x.searchParams.delete(k); });
    x.hash = '';
    return x.toString().replace(/\?$/, '');
  }catch(e){ return String(u || '').trim(); }
}
function safeHref(u){ return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#'; }   // job links: web addresses only
function safeNext(n){   // only our own pages, never another site
  n = String(n || '');
  return /^\/(team|portal|editor|app)\.html(?:[?#][^\s]*)?$/.test(n) ? n : '';
}

var I = {
  logo:'<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#0938d5"/><path d="M256 410C168 314 138 278 138 206 138 142 191 94 256 94s118 48 118 112c0 72-30 108-118 204z" fill="#fff"/><path d="M205 200l37 36 76-88" fill="none" stroke="#0938d5" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  ext:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  img:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5-5 5 5"/><path d="M12 5v12"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
  team:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
  wa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1-.4-2.4-1.8-2.8-2.8l.9-1-1-2z"/></svg>',
  g:'<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'
};

/* ---------- Supabase ---------- */
var SCRIPTS = {};
function loadScript(src){
  return SCRIPTS[src] || (SCRIPTS[src] = new Promise(function(res, rej){
    var s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = function(){ res(); }; s.onerror = function(){ delete SCRIPTS[src]; rej(new Error('load')); };
    document.head.appendChild(s);
  }));
}
/* Supabase normally coordinates sign-in across tabs with the browser's lock API; in some in-app browsers that lock is
   never released, so (like the job board) we queue within the page instead. */
var lockQ = Promise.resolve();
function pageLock(name, timeout, fn){ var run = lockQ.then(function(){ return fn(); }); lockQ = run.then(function(){}, function(){}); return run; }
var sb = null, sbP = null;
function client(){
  if(sbP) return sbP;
  sbP = loadScript(SBLIB).then(function(){
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
      {auth:{flowType:'pkce', persistSession:true, detectSessionInUrl:false, lock:pageLock}});
    return sb;
  }, function(e){ sbP = null; throw e; });
  return sbP;
}
function session(){ return client().then(function(c){ return c.auth.getSession(); }).then(function(r){ return (r && r.data && r.data.session) || null; }); }
// unwrap a Supabase answer: give back the data, or throw its error (an expired sign-in also shows the banner)
function q(p){ return Promise.resolve(p).then(function(r){ if(r && r.error){ if(authGone(r.error)) net('auth'); throw r.error; } return r ? r.data : null; }); }
function authGone(e){ var s = (e && (e.message || e.code)) + ' ' + ((e && e.code) || ''); return /JWT expired|invalid JWT|jwt|PGRST30[0-3]|sign_in/i.test(s) || (e && e.status === 401); }
function whoami(){ return client().then(function(c){ return q(c.rpc('portal_whoami')); }); }
function loginUrl(){ return '/login.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash); }
function toLogin(){ location.replace(loginUrl()); }

/* ---------- leaving with work in progress: pages register what would be lost; signing out and closing the tab ask first ---------- */
var LEAVE = [];
function onLeave(fn){ LEAVE.push(fn); }
function leaveWhy(){ for(var i = 0; i < LEAVE.length; i++){ var w = LEAVE[i](); if(w) return w; } return ''; }
window.addEventListener('beforeunload', function(e){ if(leaveWhy()){ e.preventDefault(); e.returnValue = ''; } });
function signOut(){
  var why = leaveWhy();
  return (why ? confirmBox('Sign out?', why, 'Sign out anyway', true) : Promise.resolve(true)).then(function(ok){
    if(!ok) return;
    LEAVE = [];
    try{ Object.keys(sessionStorage).forEach(function(k){ if(/^tp_cache_/.test(k)) sessionStorage.removeItem(k); }); }catch(e){}   // copies of client data kept for speed
    return client().then(function(c){ return c.auth.signOut(); }).catch(function(){}).then(function(){ location.replace('/login.html?out=1'); });
  });
}

/* ---------- connection: a bar at the top while offline, or when the sign-in has expired (the page keeps its work) ---------- */
var NET = null;
function net(state){
  if(state === 'auth' && NET === 'auth') return;
  NET = state;
  var b = $('#netBar');
  if(!state){ if(b) b.remove(); return; }
  if(!b){ b = document.createElement('div'); b.id = 'netBar'; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
  b.className = 'netbar ' + state;
  b.innerHTML = state === 'offline'
    ? '<b>You’re offline.</b> Keep working — changes are saved when the connection is back.'
    : '<b>Your sign-in has expired.</b> <a href="' + esc(loginUrl()) + '" target="_blank" rel="noopener">Sign in again</a> in a new tab, then come back — this page keeps your work.';
}
// something in the page's own code went wrong: say so plainly (work in progress is kept and saved as usual) instead of
// leaving a button that silently does nothing
function oops(){
  if($('#oopsBar') || NET) return;
  var b = document.createElement('div'); b.id = 'oopsBar'; b.className = 'netbar oops'; b.setAttribute('role', 'alert');
  b.innerHTML = '<b>Something on this page didn’t work.</b> Your work is kept. <a href="#" data-oops="reload">Reload the page</a> · <a href="#" data-oops="hide">Hide</a>';
  b.addEventListener('click', function(e){ var a = e.target.closest('[data-oops]'); if(!a) return; e.preventDefault(); if(a.getAttribute('data-oops') === 'reload') location.reload(); else b.remove(); });
  document.body.appendChild(b);
}
window.addEventListener('error', function(e){ if(e && e.filename && e.filename.indexOf(location.origin) === 0) oops(); });
window.addEventListener('unhandledrejection', function(e){ var r = e && e.reason; if(r instanceof Error && !/Failed to fetch|NetworkError|AbortError|Load failed/i.test(r.message)) oops(); });
window.addEventListener('offline', function(){ net('offline'); });
window.addEventListener('online', function(){ if(NET === 'offline') net(null); document.dispatchEvent(new Event('tp-online')); });
// back from signing in again in another tab: the sign-in is picked up when this tab is seen again
document.addEventListener('visibilitychange', function(){
  if(NET !== 'auth' || document.visibilityState !== 'visible') return;
  session().then(function(s){ if(s && s.expires_at * 1000 > Date.now()){ net(null); document.dispatchEvent(new Event('tp-online')); } }, function(){});
});
// call one of our server functions (client-accounts, job-info, resume-ai) as the signed-in person
function fn(name, body, ms){
  return session().then(function(s){
    if(!s){ net('auth'); throw {code:'sign_in', message:'Please sign in again'}; }
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function(){ if(ctl) ctl.abort(); }, ms || 25000);
    return fetch(CONFIG.SUPABASE_URL + '/functions/v1/' + name, {method:'POST', signal:ctl ? ctl.signal : undefined,
      headers:{'Content-Type':'application/json', apikey:CONFIG.SUPABASE_ANON_KEY, Authorization:'Bearer ' + s.access_token}, body:JSON.stringify(body || {})})
      .then(function(r){ clearTimeout(tm); return r.json().catch(function(){ return {}; }).then(function(j){
        if(r.status === 401) net('auth');
        if(!r.ok) throw {code:(j && j.error) || ('http_' + r.status), status:r.status, message:(j && j.error) || ('HTTP ' + r.status)};
        return j; }); }, function(e){ clearTimeout(tm); throw {code:'network', message:'Couldn’t reach the server — check your connection'}; });
  });
}
function errText(e){
  var s = (e && (e.message || e.code)) || String(e || '');
  if(/PGRST205|42P01|does not exist|schema cache|Could not find the (table|function)/i.test(s + ' ' + ((e && e.code) || '')))
    return 'The team portal isn’t set up in Supabase yet — run sql/supabase-team-portal.sql once.';
  if(e && (e.status === 404 || e.code === 'http_404')) return 'That server function isn’t deployed yet (Supabase → Edge Functions).';
  if(e && e.code === 'team_only') return 'Only the TrulyPlaced team can do that.';
  if(e && e.code === 'owner_only') return 'Only the owner can do that.';
  if(/JWT|sign_in|not authenticated|401/i.test(s)) return 'Your sign-in has expired — sign in again.';
  if(/row-level security|permission denied|42501/i.test(s)) return 'You don’t have access to that.';
  if(/Failed to fetch|NetworkError|network/i.test(s)) return 'Couldn’t reach the server — check your connection and try again.';
  return s.replace(/^.*?:\s*/, '').slice(0, 180) || 'Something went wrong — try again.';
}

/* ---------- private files (resume PDFs, confirmation screenshots) ---------- */
function upload(path, blob, type){
  return client().then(function(c){
    return c.storage.from(CONFIG.BUCKET).upload(path, blob, {contentType:type || blob.type || 'application/octet-stream', upsert:false, cacheControl:'3600'});
  }).then(function(r){ if(r.error) throw r.error; return path; });
}
var URLS = {};
function fileUrl(path){
  if(!path) return Promise.resolve('');
  var hit = URLS[path]; if(hit && hit.at > Date.now() - 45 * 60000) return Promise.resolve(hit.url);
  return client().then(function(c){ return c.storage.from(CONFIG.BUCKET).createSignedUrl(path, 3600); })
    .then(function(r){ if(r.error) throw r.error; var u = r.data.signedUrl; URLS[path] = {url:u, at:Date.now()}; return u; });
}
// fill <img data-file="path"> and <a data-file="path"> with short-lived private links
function fillFiles(root){
  $$('[data-file]', root).forEach(function(el){
    var p = el.getAttribute('data-file'); if(!p || el.getAttribute('data-filled')) return;
    el.setAttribute('data-filled', '1');
    fileUrl(p).then(function(u){ if(el.tagName === 'IMG') el.src = u; else el.href = u; }, function(){ el.classList.add('missing'); if(el.tagName === 'IMG') el.alt = 'Couldn’t load this file'; });
  });
}
// big phone screenshots are made smaller before upload (still easy to read)
function shrinkImage(file, maxW, maxBytes){
  maxW = maxW || 2000; maxBytes = maxBytes || 1500000;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size <= maxBytes) return Promise.resolve(file);
  return new Promise(function(res){
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function(){
      var s = Math.min(1, maxW / img.naturalWidth), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function(b){ res(b && b.size < file.size ? new File([b], (file.name || 'screenshot').replace(/\.\w+$/, '') + '.jpg', {type:'image/jpeg'}) : file); }, 'image/jpeg', 0.86);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}

/* ---------- modal ----------
   modal(html, wide, {keep, onClose}): keep is for forms — a click beside it doesn't close it, and once something was
   typed, × / Esc / Cancel ask before throwing it away. onClose runs when the person closes it (not after a save). */
var MOD = null;
function modal(html, wide, o){
  var root = $('#modalRoot'); if(!root){ root = document.createElement('div'); root.id = 'modalRoot'; document.body.appendChild(root); }
  if(MOD && MOD.onClose){ var was = MOD.onClose; MOD = null; was(); }   // a dialog replaced by another counts as cancelled
  root.innerHTML = '<div class="mod-wrap" data-mclose="1"><div class="mod ' + (wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' +
    '<button class="x" type="button" data-mclose="1" aria-label="Close">' + I.x + '</button>' + html + '</div></div>';
  var m = $('#modalRoot .mod');
  MOD = {el:m, keep:!!(o && o.keep), onClose:(o && o.onClose) || null, dirty:false};
  if(MOD.keep){ var me = MOD; m.addEventListener('input', function(e){ if(!e.target.closest('.mod-discard')) me.dirty = true; }); }
  // the first field gets the cursor — unless the person already clicked into the form (never pull typing elsewhere)
  var f = $('input:not([type=hidden]):not([type=checkbox]), textarea, select', m); if(f) setTimeout(function(){ if(f.isConnected && !m.contains(document.activeElement)) f.focus(); }, 30);
  return m;
}
function closeModal(){ var r = $('#modalRoot'); MOD = null; if(r) r.innerHTML = ''; }
// the person closes it: × / Esc / Cancel / a click beside it
function tryClose(byBackdrop){
  var me = MOD; if(!me){ closeModal(); return; }
  if(byBackdrop && me.keep) return;
  if(me.dirty && me.keep){
    if($('.mod-discard', me.el)) return;
    var bar = document.createElement('div'); bar.className = 'mod-discard';
    bar.innerHTML = '<span>Discard what you typed?</span><button class="btn sm" type="button" data-keep="1">Keep editing</button><button class="btn sm bad" type="button" data-toss="1">Discard</button>';
    me.el.appendChild(bar); bar.scrollIntoView({block:'nearest'}); $('[data-keep]', bar).focus();
    bar.addEventListener('click', function(e){
      if(e.target.closest('[data-keep]')) bar.remove();
      else if(e.target.closest('[data-toss]')){ me.dirty = false; tryClose(); }
    });
    return;
  }
  var cb = me.onClose; closeModal(); if(cb) cb();
}
/* confirmBox(title, text, ok, danger, {items, html, type, cancel, careful, wide}) → true / false
   items: what will happen, as lines (['warn', '…'] or ['ok', '…'] for a coloured mark); html: a body built by the page;
   type: the text to type before the button works (for what can't be taken back). A dangerous one (or careful) starts on Cancel. */
function confirmBox(title, text, okLabel, danger, o){
  o = o || {};
  return new Promise(function(res){
    var done = false, fin = function(v){ if(done) return; done = true; if(MOD && MOD.el === m) closeModal(); res(v); };
    var mark = {ok:I.check, warn:'!', bad:'!', info:'•'};
    var items = (o.items || []).filter(Boolean).map(function(x){ var k = Array.isArray(x) ? x[0] : 'info', t = Array.isArray(x) ? x[1] : x;
      return '<li class="' + k + '"><i>' + (mark[k] || '•') + '</i><span>' + t + '</span></li>'; }).join('');
    var m = modal('<h2>' + esc(title) + '</h2>' + (text ? '<p>' + esc(text) + '</p>' : '') + (o.html || '') + (items ? '<ul class="cfl">' + items + '</ul>' : '') +
      (o.type ? '<div class="field cft"><label for="cfT">Type <b>' + esc(o.type) + '</b> to confirm</label><input id="cfT" autocomplete="off" spellcheck="false" autocapitalize="off"></div>' : '') +
      '<div class="acts"><button class="btn" type="button" data-no="1">' + esc(o.cancel || 'Cancel') + '</button>' +
      '<button class="btn ' + (danger ? 'bad' : 'pri') + '" type="button" data-yes="1"' + (o.type ? ' disabled' : '') + '>' + esc(okLabel || 'OK') + '</button></div>', o.wide,
      {onClose:function(){ fin(false); }});
    var yes = $('[data-yes]', m), norm = function(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
    if(o.type){
      var t = $('#cfT', m);
      t.addEventListener('input', function(){ yes.disabled = norm(t.value) !== norm(o.type); });
      t.addEventListener('keydown', function(e){ if(e.key === 'Enter' && !yes.disabled){ e.preventDefault(); fin(true); } });
    } else setTimeout(function(){ var b = danger || o.careful ? $('[data-no]', m) : yes; if(b && b.isConnected && !m.contains(document.activeElement)) b.focus(); }, 40);   // Enter never confirms a dangerous one by accident
    m.addEventListener('click', function(e){ if(e.target.closest('[data-yes]')) fin(true); else if(e.target.closest('[data-no]')) fin(false); });
  });
}
document.addEventListener('click', function(e){
  var c = e.target.closest && e.target.closest('[data-mclose]');
  if(c && c.getAttribute('data-mclose') !== '0' && (c.classList.contains('x') || e.target === c || c.tagName === 'BUTTON')) tryClose(e.target === c && c.classList.contains('mod-wrap'));
  var cp = e.target.closest && e.target.closest('[data-copy]');
  if(cp){ e.preventDefault(); copy(cp.getAttribute('data-copy'), cp.getAttribute('data-what') || 'Text'); }
});
document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && MOD){ e.preventDefault(); tryClose(); } });

/* ---------- help filling in a client's profile: the same suggestions on the team's Profile tab and the client's own ----------
   Quick picks under a field (a tap fills it in; on a list, like target roles, it adds one), and the common form questions,
   each with its answer suggested from what the profile already says. */
var COMMON_Q = ['Are you legally authorized to work in the United States?', 'Will you now or in the future require visa sponsorship (e.g. H-1B)?',
  'Are you willing to relocate?', 'What are your salary expectations?', 'When can you start?', 'LinkedIn profile', 'How did you hear about this job?',
  'Gender (voluntary)', 'Race / ethnicity (voluntary)', 'Veteran status (voluntary)', 'Disability status (voluntary)'];
var PICKS = {
  work_auth:['US citizen', 'Green card holder', 'F-1 OPT', 'F-1 STEM OPT — needs H-1B later', 'H-1B — needs a transfer', 'H-4 EAD'],
  notice:['Immediately', '2 weeks’ notice', '1 month’s notice'],
  salary:['Open to discuss']
};
// a few roles close to the ones named, for a quick tap
var ROLE_NEAR = [[/data analy|analytics|\bbi\b/i, ['Data Analyst', 'BI Analyst', 'Business Analyst', 'Reporting Analyst', 'Analytics Engineer']],
  [/data scien|machine learning|\bml\b/i, ['Data Scientist', 'Machine Learning Engineer', 'Applied Scientist']], [/data engineer/i, ['Data Engineer', 'Analytics Engineer', 'ETL Developer']],
  [/software|developer|backend|front.?end|full.?stack/i, ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Frontend Engineer']],
  [/product manager|product owner/i, ['Product Manager', 'Product Owner', 'Technical Product Manager']], [/business analyst/i, ['Business Analyst', 'Systems Analyst', 'Product Analyst']],
  [/devops|cloud|platform|reliability|\bsre\b/i, ['DevOps Engineer', 'Cloud Engineer', 'Site Reliability Engineer']], [/project manager|program manager|scrum/i, ['Project Manager', 'Program Manager', 'Scrum Master']],
  [/designer|\bux\b|\bui\b/i, ['Product Designer', 'UX Designer', 'UI Designer']], [/\bqa\b|quality|test/i, ['QA Engineer', 'Test Automation Engineer', 'SDET']]];
function listOf(s){ return String(s || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean); }
function hasIn(list, v){ return list.some(function(x){ return x.toLowerCase() === String(v).toLowerCase(); }); }
function roleIdeas(roles){
  var have = listOf(roles), src = have.join(' '), out = [];
  ROLE_NEAR.forEach(function(r){ if(r[0].test(src)) r[1].forEach(function(x){ if(!hasIn(out, x) && !hasIn(have, x)) out.push(x); }); });
  return out.slice(0, 6);
}
function placeIdeas(places, livesIn){
  var have = listOf(places), city = String(livesIn || '').trim();
  return ['US remote', city, city ? 'Hybrid near ' + city.split(',')[0] : '', 'Anywhere in the US'].filter(function(x){ return x && !hasIn(have, x); });
}
// the answer the profile already gives to a common question ('' when it doesn't say)
function suggestAnswer(q, p){
  p = p || {}; var wa = String(p.work_auth || ''), t = String(q || '');
  var free = /citizen|green card|permanent resident/i.test(wa), visa = /\bopt\b|\bstem\b|\bf-?1\b|h-?1b|h-?4|\bead\b|\bcpt\b|\btn\b|\bl-?1\b|\bo-?1\b|sponsor/i.test(wa);
  if(/authori[sz]ed to work/i.test(t)) return free || visa ? 'Yes' : '';
  if(/sponsorship/i.test(t)) return free ? 'No' : visa ? 'Yes' : '';
  if(/salary/i.test(t)) return p.salary || '';
  if(/when can you start|start date/i.test(t)) return p.notice || '';
  if(/linkedin/i.test(t)) return p.linkedin || '';
  if(/hear about/i.test(t)) return 'LinkedIn';
  if(/gender|race|ethnicity|veteran|disability/i.test(t)) return 'I don’t wish to answer';
  return '';
}
// the quick picks under a field: data-picks names the field; data-list adds to a comma list instead of replacing
function picksHTML(id, picks, isList){
  return picks && picks.length ? '<div class="picks" data-picks="' + esc(id) + '"' + (isList ? ' data-list="1"' : '') + '>' +
    picks.map(function(v){ return '<button type="button" data-pick="' + esc(v) + '">' + (isList ? '+ ' : '') + esc(v) + '</button>'; }).join('') + '</div>' : '';
}
document.addEventListener('click', function(e){
  var b = e.target.closest && e.target.closest('[data-pick]'); if(!b) return;
  var box = b.closest('[data-picks]'), f = box && document.getElementById(box.getAttribute('data-picks')); if(!f || f.readOnly || f.disabled) return;
  var v = b.getAttribute('data-pick');
  if(box.hasAttribute('data-list')){ var have = listOf(f.value); if(!hasIn(have, v)) have.push(v); f.value = have.join(', '); b.remove(); }
  else f.value = v;
  f.dispatchEvent(new Event('input', {bubbles:true}));
});

window.TP = {
  CONFIG:CONFIG, VERSION:VERSION, I:I, $:$, $$:$$, esc:esc, debounce:debounce, lsGet:lsGet, lsSet:lsSet, ssGet:ssGet, ssSet:ssSet, uid:uid,
  toast:toast, busy:busy, copy:copy, fmtDate:fmtDate, fmtDateTime:fmtDateTime, ago:ago, initials:initials, hue:hue, logo:logo,
  STATUS:STATUS, statusLabel:statusLabel, statusChip:statusChip, cleanUrl:cleanUrl, safeHref:safeHref, safeNext:safeNext,
  client:client, session:session, q:q, whoami:whoami, toLogin:toLogin, signOut:signOut, fn:fn, errText:errText, authGone:authGone, net:net,
  onLeave:onLeave, leaveWhy:leaveWhy,
  upload:upload, fileUrl:fileUrl, fillFiles:fillFiles, shrinkImage:shrinkImage, modal:modal, closeModal:closeModal, tryClose:tryClose, confirmBox:confirmBox,
  isModal:function(){ return !!MOD; },
  COMMON_Q:COMMON_Q, PICKS:PICKS, roleIdeas:roleIdeas, placeIdeas:placeIdeas, suggestAnswer:suggestAnswer, picksHTML:picksHTML
};
})();
