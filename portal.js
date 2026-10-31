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
var VERSION = '2026-10-31.2';
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

/* ==== suggestions as you type: the engine (app.trulyplaced.com's SuggestInput, for these pages) ====
   A field says what it is with data-sg; sg(kind) writes that, with the keyboard that suits it. Tapped, it offers what
   suits it at once: a short list's choices, or the page's own answers (picks). Typed, it offers the best matches from a
   long list (cities, roles, skills: suggest-lists.js, loaded the first time a field needs it), and what was typed, tidied
   up (a phone number, a LinkedIn address, a salary, an email address).
   Arrows and Enter pick one, Esc closes the list, a tap fills it in. A list field (roles, places) completes the item being
   typed and stays open for the next. The list sits in the page under the field, so it never covers the next field or a
   button.
   A page adds its own kinds with kind(name, spec), and says what its profile holds with .profile. From here to "end of the
   suggest engine", the code is copied into the resume editor by editor-build/build.py, so it uses nothing else from this
   file: rebuild the editor when it changes. */
var SUGGEST = (function(){
"use strict";
var LISTS_V = '2026-10-31.2', LISTS = null, LISTS_P = null;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function all(sel, root){ return [].slice.call((root || document).querySelectorAll(sel)); }
function loadLists(){   // null when it couldn't load (offline): tried again half a minute later, not on every key
  if(LISTS) return Promise.resolve(LISTS);
  return LISTS_P || (LISTS_P = new Promise(function(res, rej){
    var s = document.createElement('script'); s.src = '/suggest-lists.js?v=' + LISTS_V; s.async = true;
    s.onload = function(){ res(LISTS = window.TP_LISTS || {}); }; s.onerror = rej;
    document.head.appendChild(s);
  }).catch(function(){ setTimeout(function(){ LISTS_P = null; }, 30000); return null; }));
}
// compared without case or accents, with dashes and slashes as spaces ("ui/ux" finds "UI/UX Designer"); one character for one
var ACCENTS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
function fold(s){ return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(ACCENTS, '').replace(/[-–—_\/]/g, ' '); }
// best matches first: the value starts with what's typed, then a word in it does, then it's anywhere in it (spaces aside)
function rank(opts, typed, max, skip){
  var q = fold(typed).trim(); if(!q) return [];
  var qc = q.replace(/\s+/g, ''), no = {}, found = [], seen = {}, out = [];
  (skip || []).forEach(function(x){ no[fold(x).trim()] = 1; });
  opts.forEach(function(o, i){
    var f = fold(o), at = f.indexOf(q), r;
    if(f === q || no[f]) return;
    if(at === 0) r = 0; else if(at > 0) r = /[\s(,.&]/.test(f.charAt(at - 1)) ? 1 : 2;
    else if(qc.length > 1 && f.replace(/\s+/g, '').indexOf(qc) > -1) r = 3; else return;
    found.push([r, i, o]);
  });
  found.sort(function(a, b){ return a[0] - b[0] || a[1] - b[1]; });
  for(var j = 0; j < found.length && out.length < (max || 6); j++){ var k = fold(found[j][2]); if(!seen[k]){ seen[k] = 1; out.push(found[j][2]); } }
  return out;
}
function marked(text, typed){   // the part that matches what's typed, in bold
  var q = fold(typed).trim(), at = q ? fold(text).indexOf(q) : -1;
  return at < 0 ? esc(text) : esc(text.slice(0, at)) + '<b>' + esc(text.slice(at, at + q.length)) + '</b>' + esc(text.slice(at + q.length));
}
// a list as typed in one field: "; " between items when it has any (places carry their own comma), commas otherwise
function listOf(s){ s = String(s || ''); return s.split(s.indexOf(';') > -1 ? ';' : ',').map(function(x){ return x.trim(); }).filter(Boolean); }
function hasIn(list, v){ return list.some(function(x){ return x.toLowerCase() === String(v).toLowerCase(); }); }
// the places in a list, kept with "; " between them since a place has its own comma ("Austin, TX"). A list written with
// commas only keeps a state or a country with its city.
var STATE2 = /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|PR|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|ON|BC|QC|AB|MB|NS)$/,
  LAND = /^(usa?|united states|canada|india|uk|united kingdom|ireland|germany|australia|singapore|uae|united arab emirates|netherlands|france|new zealand)$/i;
function placeParts(s){
  s = String(s || '');
  if(s.indexOf(';') > -1) return s.split(';').map(function(x){ return x.trim(); });
  var out = [];
  s.split(',').forEach(function(x){ var t = x.trim(), n = out.length; if(n && out[n - 1] && (STATE2.test(t) || LAND.test(t))) out[n - 1] += ', ' + t; else out.push(t); });
  return out;
}
function placeIdeas(places, livesIn){
  var have = placeParts(places).filter(Boolean), city = String(livesIn || '').trim();
  return ['US remote', city, city ? 'Hybrid near ' + city.split(',')[0] : '', 'Anywhere in the US'].filter(function(x){ return x && !hasIn(have, x); });
}
// a few roles close to the ones named
var ROLE_NEAR = [[/data analy|analytics|\bbi\b/i, ['Data Analyst', 'BI Analyst', 'Business Analyst', 'Reporting Analyst', 'Analytics Engineer']],
  [/data scien|machine learning|\bml\b/i, ['Data Scientist', 'Machine Learning Engineer', 'Applied Scientist']], [/data engineer/i, ['Data Engineer', 'Analytics Engineer', 'ETL Developer']],
  [/software|developer|backend|front.?end|full.?stack/i, ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Frontend Engineer']],
  [/product manager|product owner/i, ['Product Manager', 'Product Owner', 'Technical Product Manager']], [/business analyst/i, ['Business Analyst', 'Systems Analyst', 'Product Analyst']],
  [/devops|cloud|platform|reliability|\bsre\b/i, ['DevOps Engineer', 'Cloud Engineer', 'Site Reliability Engineer']], [/project manager|program manager|scrum/i, ['Project Manager', 'Program Manager', 'Scrum Master']],
  [/designer|\bux\b|\bui\b/i, ['Product Designer', 'UX Designer', 'UI Designer']], [/\bqa\b|quality|test/i, ['QA Engineer', 'Test Automation Engineer', 'SDET']],
  [/secur|cyber|\bsoc\b/i, ['Cybersecurity Analyst', 'SOC Analyst', 'Security Engineer']], [/salesforce/i, ['Salesforce Developer', 'Salesforce Administrator']]];
function roleIdeas(roles){
  var have = listOf(roles), src = have.join(' '), out = [];
  ROLE_NEAR.forEach(function(r){ if(r[0].test(src)) r[1].forEach(function(x){ if(!hasIn(out, x) && !hasIn(have, x)) out.push(x); }); });
  return out.slice(0, 6);
}
// what was typed, tidied up
var LI = 'https://www.linkedin.com/in/';
function linkedinIdeas(t){
  t = String(t || '').trim();
  if(!t || (t.length < LI.length && LI.indexOf(t.toLowerCase()) === 0)) return [LI];   // the start of the address: they type the rest
  var m = t.match(/linkedin\.com\/(?:mwlite\/)?in\/([^\/?#\s]+)/i);
  if(m) return LI + m[1] === t.replace(/\/$/, '') ? [] : [LI + m[1]];
  return /^@?[a-z0-9][a-z0-9\-_%]{2,99}$/i.test(t) ? [LI + t.replace(/^@/, '')] : [];   // just the name: the whole address
}
function phoneIdeas(t){
  t = String(t || '').trim(); var d = t.replace(/\D/g, ''), out = [];
  var us = function(x){ return '+1 ' + x.slice(0, 3) + ' ' + x.slice(3, 6) + ' ' + x.slice(6); }, ind = function(x){ return '+91 ' + x.slice(0, 5) + ' ' + x.slice(5); };
  if(d.length === 10){ out.push(us(d)); if(/^[6-9]/.test(d)) out.push(ind(d)); }
  else if(d.length === 11 && d.charAt(0) === '1') out.push(us(d.slice(1)));
  else if(d.length === 12 && d.slice(0, 2) === '91') out.push(ind(d.slice(2)));
  return out.filter(function(x){ return x !== t; });
}
function kfmt(n){ return '$' + (n % 1000 ? (n / 1000).toFixed(1) : n / 1000) + 'K'; }
function usd(n){ return '$' + Math.round(n).toLocaleString('en-US'); }
function salaryIdeas(t){
  var s = String(t || '').toLowerCase().replace(/usd|per (year|annum)|a year|annually|\/\s*(yr|year)/g, '').replace(/[$,\s]/g, '');
  var m = s.match(/^(\d+(?:\.\d+)?)(k)?(?:(?:-|–|—|to)(\d+(?:\.\d+)?)(k)?)?$/); if(!m) return [];
  var big = function(n, k){ n = +n; return k || n < 1000 ? n * 1000 : n; };
  var a = big(m[1], m[2] || m[4]), b = m[3] ? big(m[3], m[4]) : 0;
  if(a < 10000 || a > 2000000) return [];
  if(b > a) return [kfmt(a) + '–' + kfmt(b) + ' a year', usd(a) + '–' + usd(b) + ' a year'];
  var out = [usd(a) + ' a year', kfmt(a) + '–' + kfmt(Math.round(a * 1.15 / 5000) * 5000) + ' a year'];
  if(!m[2] && !m[3] && +m[1] >= 15 && +m[1] <= 200) out.push('$' + m[1] + ' an hour');
  return out;
}
var MAILS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'protonmail.com'];
var MAIL_TYPO = {'gmial.com':'gmail.com', 'gmai.com':'gmail.com', 'gamil.com':'gmail.com', 'gmal.com':'gmail.com', 'gnail.com':'gmail.com', 'gmaill.com':'gmail.com',
  'gmail.co':'gmail.com', 'gmail.con':'gmail.com', 'gmail.cm':'gmail.com', 'gmail.om':'gmail.com', 'hotmial.com':'hotmail.com', 'hotmai.com':'hotmail.com',
  'hotmail.co':'hotmail.com', 'yahooo.com':'yahoo.com', 'yaho.com':'yahoo.com', 'yahoo.co':'yahoo.com', 'yahoo.con':'yahoo.com', 'outlok.com':'outlook.com',
  'outllok.com':'outlook.com', 'outlook.co':'outlook.com', 'iclod.com':'icloud.com', 'icloud.co':'icloud.com'};
function mailIdeas(t, first){
  t = String(t || '').trim().toLowerCase(); var at = t.indexOf('@'), doms = (first || []).concat(MAILS);
  if(at < 1 || t.indexOf('@', at + 1) > -1) return [];
  var who = t.slice(0, at), dom = t.slice(at + 1);
  if(MAIL_TYPO[dom]){ var fix = [who + '@' + MAIL_TYPO[dom]]; fix.head = 'Did you mean'; return fix; }   // a login email can't be changed later
  return doms.filter(function(d){ return d.indexOf(dom) === 0 && d !== dom; }).slice(0, 5).map(function(d){ return who + '@' + d; });
}
// a US ZIP code typed where a city goes: the city it belongs to (looked up as the app does)
var ZIPS = {};
function zipPlace(z){
  if(typeof ZIPS[z] === 'string') return ZIPS[z];
  if(ZIPS[z] === undefined && window.fetch){
    ZIPS[z] = null;
    fetch('https://api.zippopotam.us/us/' + z).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
      var p = d && d.places && d.places[0]; ZIPS[z] = p ? p['place name'] + ', ' + p['state abbreviation'] : '';
      if(SGS.f && SGS.f.value.trim() === z) sgRefresh();
    }).catch(function(){ ZIPS[z] = ''; });
  }
  return '';
}
// another name for a place or a school ("nyc", "bangalore", "njit"): typed in full, or its start from three letters on
function aliasOf(ft, key){
  var A = LISTS && LISTS[key]; if(!A || !ft) return null;
  if(A[ft]) return {v:A[ft], exact:true};
  if(ft.length < 3) return null;
  for(var k in A) if(k.indexOf(ft) === 0) return {v:A[k], exact:false};
  return null;
}
/* The kinds of field. list: a long list to search; options: a short one; all: every option shown when tapped; picks: the
   page's own answers (head: what they're called); make: what was typed, tidied; alias: the list's other names; sep: a list
   field, and what goes between its items; after: once one is picked; dyn: a kind worked out from the field itself. */
var SG = {
  place:{list:'places', alias:'placeAliases', icon:'pin', zip:true},
  job_place:{list:'places', alias:'placeAliases', icon:'pin', options:['Remote', 'Hybrid', 'On-site']},
  places:{list:'places', alias:'placeAliases', icon:'pin', sep:'; ', picks:function(f, p){ return placeIdeas(f.value, p.location); }},
  role:{list:'titles', icon:'role'},
  roles:{list:'titles', icon:'role', sep:', ', picks:function(f){ return roleIdeas(f.value); }},
  resume_name:{list:'titles', icon:'role', picks:function(f, p){ return listOf(p.target_roles); }},
  salary:{options:['Open to discuss', 'Negotiable'], all:true, make:salaryIdeas},
  linkedin:{make:linkedinIdeas},
  phone:{make:phoneIdeas},
  email:{make:function(t){ return mailIdeas(t); }},
  team_email:{make:function(t){ return mailIdeas(t, ['trulyplaced.com']); }},
  skill:{list:'skills'},
  skills:{list:'skills', sep:', '}
};
var SG_KB = {phone:' type="tel" inputmode="tel"', linkedin:' inputmode="url" autocapitalize="none"', email:' type="email" autocapitalize="none"', team_email:' type="email" autocapitalize="none"'};
// the attributes for a field that suggests: area for a textarea; ac to let the browser fill it in too (the client's own phone)
function sg(kind, area, ac){
  return ' data-sg="' + kind + '" autocomplete="' + (ac || 'off') + '" aria-autocomplete="list" aria-controls="sgList"' + (area ? '' : ' role="combobox" aria-expanded="false"') +
    (kind === 'answer' || kind === 'question' ? '' : ' autocorrect="off" spellcheck="false"') + (SG_KB[kind] || '');
}
var SGI = {pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  role:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'};
var api = {sg:sg, kind:function(name, spec){ SG[name] = spec; }, profile:null, fire:fire, rank:rank, hasIn:hasIn, listOf:listOf, placeParts:placeParts,
  placeIdeas:placeIdeas, roleIdeas:roleIdeas, salaryIdeas:salaryIdeas, linkedinIdeas:linkedinIdeas, phoneIdeas:phoneIdeas, mailIdeas:mailIdeas,
  list:function(name){ if(!LISTS) loadLists(); return (LISTS && LISTS[name]) || []; }};
function sgProfile(){ try{ return (api.profile && api.profile()) || {}; }catch(e){ return {}; } }
var SGS = {f:null, el:null, at:null, items:[], act:-1, typed:false, base:'', quiet:false, t:0, press:0};
function sgSpec(f){ var s = SG[f.getAttribute('data-sg')]; return s && s.dyn ? s.dyn(f) : s || null; }
// a list field: the items already in it, and the one being typed (none when it was only tapped: a pick adds one)
function sgParts(v, s, fresh){
  if(!s.sep) return {typed:String(v || '').trim(), chosen:[]};
  var parts = s.sep === '; ' ? placeParts(v) : String(v || '').split(/[,;]/), typed = fresh ? '' : String(parts.pop() || '').trim();
  return {typed:typed, chosen:parts.map(function(x){ return x.trim(); }).filter(Boolean)};
}
// as above for the field now. Typed into a list since it was tapped, with no comma ("New York" then "Aus", or wherever the
// cursor landed), it's taken as the next item: a pick adds it as one, and nothing typed changes unless one is picked.
function sgNow(f, s){
  var v = f.value, b = SGS.base;
  if(s.sep && SGS.typed && b && v.length > b.length){
    var i = 0, j = 0, n = b.length;
    while(i < n && v.charAt(i) === b.charAt(i)) i++;
    while(j < n - i && v.charAt(v.length - 1 - j) === b.charAt(n - 1 - j)) j++;
    var add = v.slice(i, v.length - j);
    if(i + j === n && add.trim() && !/[,;]/.test(add)) return {typed:add.trim(), chosen:sgParts(b, s, true).chosen};
  }
  return sgParts(v, s, !SGS.typed);
}
function fire(f){ SGS.quiet = true; try{ f.dispatchEvent(new Event('input', {bubbles:true})); f.dispatchEvent(new Event('change', {bubbles:true})); }finally{ SGS.quiet = false; } }
function sgEl(){
  if(SGS.el) return SGS.el;
  var d = document.createElement('div'); d.className = 'sgl'; d.id = 'sgList'; d.setAttribute('role', 'listbox'); d.setAttribute('aria-label', 'Suggestions');
  d.addEventListener('mousedown', function(e){ e.preventDefault(); });   // pressing a suggestion keeps the field focused
  d.addEventListener('pointerdown', function(){ SGS.press = Date.now(); });
  d.addEventListener('click', function(e){ SGS.press = 0; var o = e.target.closest('[data-i]'); if(o){ e.preventDefault(); sgChoose(+o.getAttribute('data-i')); } });
  return (SGS.el = d);
}
// under the field, in the page: below it in its own box; across the whole row in a row of fields laid out as a grid (a
// question and its answer, the skills); under a field set in a line with its buttons
function sgMount(f){
  var el = sgEl(), p = f.parentNode, cs = p && p.nodeType === 1 ? getComputedStyle(p) : null, d = cs ? cs.display : '';
  SGS.at = f; el.style.gridColumn = '';
  if(/grid/.test(d)){ el.style.gridColumn = '1 / -1'; p.appendChild(el); }
  else if(/flex/.test(d) && !/column/.test(cs.flexDirection)) p.insertAdjacentElement('afterend', el);
  else f.insertAdjacentElement('afterend', el);
}
function sgClose(){
  var el = SGS.el, f = SGS.f;
  if(el && el.parentNode) el.parentNode.removeChild(el);
  SGS.items = []; SGS.act = -1; SGS.at = null;
  if(f){ if(f.tagName === 'INPUT') f.setAttribute('aria-expanded', 'false'); f.removeAttribute('aria-activedescendant'); }
}
function sgRefresh(){
  var f = SGS.f; if(!f || !f.isConnected || f.readOnly || f.disabled){ sgClose(); return; }
  var s = sgSpec(f); if(!s){ sgClose(); return; }
  if(s.list && !LISTS) loadLists().then(function(l){ if(l && SGS.f === f) sgRefresh(); });
  // tapped, nothing typed yet: what suits the field (a short list's every choice, the page's own answers); typed: what matches
  var fresh = !SGS.typed, p = sgProfile(), pt = sgNow(f, s), typed = pt.typed, ft = fold(typed).trim(), all = s.all && fresh, cur = fold(f.value).trim();
  var groups = [], used = pt.chosen.slice();
  var add = function(head, arr, icon){
    var out = [];
    (arr || []).forEach(function(x){ x = String(x || '').trim(); if(x && !hasIn(used, x) && !hasIn(out, x) && (all || fold(x).trim() !== cur)) out.push(x); });
    if(out.length){ groups.push({head:head, items:out, icon:icon}); used = used.concat(out); }
  };
  var picks = s.picks ? s.picks(f, p) : [];
  if(!fresh) picks = ft ? picks.filter(function(x){ var fx = fold(x).trim(); return fx !== ft && fx.indexOf(ft) > -1; }).slice(0, 3) : picks;
  add(s.head || 'Suggested', picks.slice(0, 6), s.icon);
  if(s.make && (!fresh || !typed)){ var made = s.make(typed, f, p) || []; add(made.head || '', made.filter(function(x){ return x !== typed; })); }
  if(s.zip && !fresh && /^\d{5}$/.test(typed)){ var z = zipPlace(typed); if(z) add('ZIP code ' + typed, [z], 'pin'); }
  var opts = typeof s.options === 'function' ? s.options(f, p) : (s.options || []), long = s.list && LISTS ? LISTS[s.list] || [] : [];
  if(all) add(s.optsHead || '', opts.length ? opts : long, s.icon);
  else if(!fresh && ft){
    var hits = rank(opts.concat(long), typed, s.max || 6, used), al = s.alias ? aliasOf(ft, s.alias) : null;
    if(al && !hasIn(used, al.v)){   // its other name in full goes first; just its start, after what matches already (if there's room)
      var at = hits.indexOf(al.v);
      if(al.exact){ if(at > -1) hits.splice(at, 1); hits.unshift(al.v); } else if(at < 0) hits.push(al.v);
      hits = hits.slice(0, s.max || 6);
    }
    add('', hits, s.icon);
  }
  sgDraw(groups, all ? '' : typed, all ? cur : '');
}
function sgDraw(groups, typed, cur){
  var f = SGS.f, items = [], html = '';
  groups.forEach(function(g, gi){
    if(gi) html += '<div class="sgd" aria-hidden="true"></div>';
    if(g.head) html += '<div class="sgh" aria-hidden="true">' + esc(g.head) + '</div>';
    g.items.forEach(function(x){
      var n = items.length, on = cur && fold(x).trim() === cur;
      html += '<div class="sgo' + (on ? ' cur' : '') + '" role="option" id="sgo' + n + '" data-i="' + n + '" aria-selected="false">' + (g.icon ? SGI[g.icon] : '') +
        '<span>' + (typed ? marked(x, typed) : esc(x)) + '</span>' + (on ? '<i class="sgk">' + SGI.check + '</i>' : '') + '</div>';
      items.push(x);
    });
  });
  SGS.items = items; SGS.act = -1;
  if(!items.length){ sgClose(); return; }
  var el = sgEl(); if(SGS.at !== f || !el.isConnected) sgMount(f);
  el.innerHTML = html;
  if(f.tagName === 'INPUT') f.setAttribute('aria-expanded', 'true');
  f.removeAttribute('aria-activedescendant');
  sgInView();
}
// the box the field scrolls in (a dialog, the editor's panel), or none when the page itself scrolls
function scroller(el){
  for(var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement){
    var o = getComputedStyle(p).overflowY; if((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}
// the list stays in sight: above a phone's keyboard and the save bar at the bottom, inside the box it scrolls in
function sgInView(){
  var el = SGS.el, f = SGS.f; if(!el || !f || !el.isConnected) return;
  var vv = window.visualViewport, top = vv ? vv.offsetTop : 0, bot = vv ? vv.offsetTop + vv.height : window.innerHeight, box = scroller(f);
  if(box){ var b = box.getBoundingClientRect(); top = Math.max(top, b.top); bot = Math.min(bot, b.bottom); }
  all('.savebar, .sticky-save').forEach(function(x){ var r = x.getBoundingClientRect(); if(r.height && r.top > top + 120 && r.top < bot) bot = r.top; });
  var over = el.getBoundingClientRect().bottom + 8 - bot, room = f.getBoundingClientRect().top - top - (box ? 16 : 76);
  if(over > 0 && room > 0){   // at once, even where the page scrolls smoothly: a click a moment later lands where it was aimed
    var sc = box || document.scrollingElement || document.documentElement, was = sc.style.scrollBehavior;
    sc.style.scrollBehavior = 'auto'; sc.scrollTop += Math.min(over, room); sc.style.scrollBehavior = was;
  }
}
function sgActive(){
  var f = SGS.f;
  all('[role=option]', SGS.el).forEach(function(o, i){
    var on = i === SGS.act; o.setAttribute('aria-selected', on ? 'true' : 'false');
    if(on){ f.setAttribute('aria-activedescendant', o.id); o.scrollIntoView({block:'nearest'}); }
  });
}
function sgChoose(i){
  var f = SGS.f, v = SGS.items[i]; if(!f || v == null) return;
  var s = sgSpec(f) || {};
  if(s.sep){ var pt = sgNow(f, s); pt.chosen.push(v); f.value = pt.chosen.join(s.sep) + s.sep; SGS.base = ''; }   // and on to the next
  else f.value = v;
  SGS.typed = false; fire(f);
  if(s.after) s.after(v, f);
  // more to type: the next in a list, or the rest of an address ("…/in/")
  if(s.sep || /\/$/.test(v)){ if(document.activeElement !== f) f.focus(); var L = f.value.length; try{ f.setSelectionRange(L, L); }catch(x){} sgRefresh(); }
  else sgClose();
}
// a list field left: no separator dangling at its end
function sgTidy(f){ var s = f.isConnected && sgSpec(f); if(s && s.sep && /[\s,;]+$/.test(f.value)){ f.value = f.value.replace(/[\s,;]+$/, ''); fire(f); } }
document.addEventListener('focusin', function(e){
  var f = e.target; if(!f || !f.hasAttribute || !f.hasAttribute('data-sg')) return;
  clearTimeout(SGS.t);
  if(SGS.f !== f){ var was = SGS.f; sgClose(); if(was) sgTidy(was); SGS.f = f; SGS.typed = false; SGS.base = f.value; }   // straight from another field
  sgRefresh();
});
document.addEventListener('focusout', function(e){
  var f = e.target; if(f !== SGS.f) return;
  clearTimeout(SGS.t);
  // late enough that a tap on a suggestion lands first
  SGS.t = setTimeout(function leave(){
    if(Date.now() - SGS.press < 800){ SGS.t = setTimeout(leave, 200); return; }
    if(document.activeElement === f || SGS.f !== f) return;
    sgClose(); SGS.f = null; sgTidy(f);
  }, 200);
});
document.addEventListener('input', function(e){ if(SGS.quiet || !SGS.f || e.target !== SGS.f) return; SGS.typed = true; sgRefresh(); });
// a second tap on a field whose list was closed (a choice made, or Esc) opens it again, like a dropdown
document.addEventListener('click', function(e){ if(SGS.f && e.target === SGS.f && !SGS.items.length){ SGS.typed = false; sgRefresh(); } });
document.addEventListener('keydown', function(e){
  var f = SGS.f; if(!f || e.target !== f || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  var n = SGS.items.length;
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    if(!n){ if(e.key === 'ArrowDown' && f.tagName === 'INPUT'){ SGS.typed = false; sgRefresh(); if(SGS.items.length) e.preventDefault(); } return; }
    e.preventDefault(); SGS.act = e.key === 'ArrowDown' ? (SGS.act + 1) % n : (SGS.act <= 0 ? n - 1 : SGS.act - 1); sgActive(); return;
  }
  if(!n) return;
  if(e.key === 'Enter' && SGS.act >= 0){ e.preventDefault(); e.stopPropagation(); sgChoose(SGS.act); }
  else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); sgClose(); }   // closes the list, not the dialog around it
  else if(e.key === 'Tab' && !e.shiftKey && SGS.act >= 0) sgChoose(SGS.act);
}, true);
return api;
})();
/* ==== end of the suggest engine ==== */

/* ---------- help filling in a client's profile: the same on the team's Profile tab and the client's own ----------
   The common form questions, each with its answer suggested from what the profile already says (suggestAnswer), and the
   kinds of field only the profile has: work authorization, when they can start, a question and its answer. */
var listOf = SUGGEST.listOf, hasIn = SUGGEST.hasIn;
var COMMON_Q = ['Are you legally authorized to work in the United States?', 'Will you now or in the future require visa sponsorship (e.g. H-1B)?',
  'Are you willing to relocate?', 'What are your salary expectations?', 'When can you start?', 'LinkedIn profile', 'How did you hear about this job?',
  'Gender (voluntary)', 'Race / ethnicity (voluntary)', 'Veteran status (voluntary)', 'Disability status (voluntary)'];
// more of what forms ask, offered as a question is typed
var MORE_Q = ['Are you authorized to work in the US without sponsorship?', 'Are you at least 18 years old?', 'Do you have a valid driver’s license?',
  'Are you willing to work on-site or hybrid?', 'Are you willing to travel?', 'Are you open to contract roles?', 'What is your highest level of education?',
  'How many years of relevant experience do you have?', 'Current location (city, state)', 'Country of citizenship', 'Languages you speak', 'Notice period',
  'Earliest start date', 'GitHub profile', 'Website or portfolio', 'Have you worked for this company before?', 'Do you have friends or family who work here?',
  'Pronouns', 'Are you Hispanic or Latino? (voluntary)'];
var WORK_AUTH = ['US citizen', 'Green card holder', 'F-1 OPT', 'F-1 STEM OPT — needs H-1B later', 'F-1 CPT', 'H-1B — needs a transfer', 'H-4 EAD', 'L-2 EAD',
  'Green card pending — EAD', 'TN visa (Canadian or Mexican citizen)', 'E-3 (Australian citizen)', 'O-1', 'Needs H-1B sponsorship'];
var STARTS = ['Immediately', '1 week’s notice', '2 weeks’ notice', '3 weeks’ notice', '1 month’s notice', '2 months’ notice', '3 months’ notice',
  'Once my OPT EAD arrives', 'Flexible — open to discuss'];
// what a form question asks about; the first that fits wins, so the more particular come first
var QK = [['auth_nosp', /(authori[sz]ed|eligible|legally able).*without.*sponsor/i], ['sponsor', /sponsor/i],
  ['auth', /authori[sz]ed to work|eligible to work|legally (able|eligible|permitted) to work|right to work|work authori[sz]ation/i], ['relocate', /relocat/i],
  ['salary', /salary|compensation|desired pay|pay (expectation|requirement)|expected pay/i],
  ['start', /start date|when can you (start|join)|available to start|notice period|earliest (start|available)|when are you available/i],
  ['linkedin', /linked ?in/i], ['github', /git ?hub/i], ['website', /website|portfolio/i],
  ['heard', /hear about|how did you (hear|learn|find)|where did you (hear|find|see)|referral source/i], ['hispanic', /hispanic|latin[oa]/i],
  ['gender', /gender|\bsex\b/i], ['pronouns', /pronoun/i], ['race', /\brace\b|ethnic/i], ['veteran', /veteran/i], ['disability', /disabilit/i],
  ['age', /18 years|age of 18|at least 18|over 18/i], ['license', /driver.?s? licen[cs]e/i], ['onsite', /on-?site|hybrid|in (the )?office|commut/i],
  ['travel', /travel/i], ['education', /highest (level of )?education|degree|qualification/i], ['citizenship', /citizenship|nationality|country of (birth|origin|residence)/i],
  ['languages', /languages?\b/i], ['location', /current location|where (are|do) you (currently )?(live|reside|located|based)|city of residence|\bcity\b|located in/i],
  ['before', /(worked|employed) (for|at|with) .*before|previously (worked|been employed)|former employee/i], ['family', /relatives?\b|\bfamily\b|\bfriends?\b/i],
  ['contract', /contract|c2c|corp.?to.?corp|\bw-?2\b|1099/i]];
function qKind(q){ q = String(q || ''); for(var i = 0; i < QK.length; i++) if(QK[i][1].test(q)) return QK[i][0]; return ''; }
var NOPE = 'I don’t wish to answer', YN = ['Yes', 'No'];
// the usual answers to each kind of question: choices, or a list to search ({list, all: every one shown when tapped})
var QOPTS = {auth:YN, auth_nosp:YN, sponsor:YN, age:YN, license:YN, before:['No', 'Yes'], family:['No', 'Yes'],
  relocate:['Yes', 'No', 'Yes, anywhere in the US', 'Open to discuss'], onsite:['Yes', 'No', 'Hybrid only', 'Remote only'], travel:['Yes', 'No', 'Up to 25%', 'Up to 50%'],
  contract:['Yes', 'No', 'Full-time only', 'Yes, W-2 only'], gender:['Male', 'Female', 'Non-binary', NOPE], pronouns:['He/him', 'She/her', 'They/them', NOPE],
  hispanic:['No', 'Yes', NOPE], race:['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino',
    'Native Hawaiian or Other Pacific Islander', 'White', 'Two or more races', NOPE],
  veteran:['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', NOPE],
  disability:['No, I do not have a disability and have not had one in the past', 'Yes, I have a disability (or previously had a disability)', 'I do not want to answer'],
  start:STARTS, salary:['Open to discuss'], github:['https://github.com/'], heard:{list:'heard', all:true}, education:{list:'degrees', all:true},
  citizenship:{list:'countries'}, languages:{list:'languages'}, location:{list:'places'}};
// what a work authorization says: free to work anywhere (citizen, green card), on a visa, and able to work now
function authOf(wa){
  wa = String(wa || '');
  var free = /citizen|green card|permanent resident/i.test(wa), visa = !free && /\bopt\b|\bstem\b|\bf-?1\b|h-?1b|h-?4|\bead\b|\bcpt\b|\btn\b|\bl-?[12]\b|\bo-?1\b|\be-?3\b|sponsor/i.test(wa);
  return {free:free, visa:visa, now:free || (visa && !/^\s*needs\b/i.test(wa))};
}
// the answer the profile already gives to a common question ('' when it doesn't say)
function suggestAnswer(q, p){
  p = p || {}; var a = authOf(p.work_auth), k = qKind(q);
  if(k === 'auth') return a.now ? 'Yes' : '';
  if(k === 'auth_nosp') return a.free ? 'Yes' : a.visa ? 'No' : '';
  if(k === 'sponsor') return a.free ? 'No' : a.visa ? 'Yes' : '';
  if(k === 'salary') return p.salary || '';
  if(k === 'start') return p.notice || '';
  if(k === 'linkedin') return p.linkedin || '';
  if(k === 'location') return p.location || '';
  if(k === 'heard') return 'LinkedIn';
  if(k === 'disability') return 'I do not want to answer';
  return /^(gender|race|hispanic|veteran|pronouns)$/.test(k) ? NOPE : '';
}
// quick picks under a field (the team's ready-made replies): data-picks names the field; data-list adds to a comma list instead
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
// the questions already in the same list of answers
function qsBeside(f){
  var row = f.closest('.qa'), box = row && row.parentNode;
  return box ? [].slice.call(box.querySelectorAll('[data-qa=q]')).filter(function(x){ return x !== f; }).map(function(x){ return x.value.trim(); }) : [];
}
// a question picked: its answer is suggested from the profile (when it has none yet), and the answer is next
function askedQ(v, f){
  var row = f.closest('.qa'), a = row && row.querySelector('[data-qa=a]'); if(!a) return;
  if(!a.value.trim()){ var s = suggestAnswer(v, sgProfile()); if(s){ a.value = s; SUGGEST.fire(a); } }
  setTimeout(function(){ if(a.isConnected){ a.focus(); try{ a.setSelectionRange(a.value.length, a.value.length); }catch(e){} } }, 0);
}
// an answer offers the usual answers to its question, with the profile's own first
function answerKind(f){
  var row = f.closest('.qa'), qf = row && row.querySelector('[data-qa=q]'), q = qf ? qf.value : '', k = qKind(q), o = QOPTS[k];
  if(!k) return null;
  var s = {head:'From the profile', picks:function(f2, p){ var a = suggestAnswer(q, p); return a ? [a] : []; }};
  if(o && o.list){ s.list = o.list; s.all = !!o.all; if(o.list === 'places'){ s.icon = 'pin'; s.alias = 'placeAliases'; } }
  else { s.options = o || []; s.all = true; }
  if(k === 'salary') s.make = SUGGEST.salaryIdeas;
  if(k === 'linkedin') s.make = SUGGEST.linkedinIdeas;
  return s;
}
SUGGEST.kind('work_auth', {options:WORK_AUTH, all:true});
SUGGEST.kind('notice', {options:STARTS, all:true});
SUGGEST.kind('question', {options:function(f){ var have = qsBeside(f); return COMMON_Q.concat(MORE_Q).filter(function(x){ return !hasIn(have, x); }); }, all:true, optsHead:'Questions forms ask', after:askedQ});
SUGGEST.kind('answer', {dyn:answerKind});
// the profile's fields, as the page shows them now (both portals use pf_<field>); a page can say better with TP.sgProfile
var PF_SG = {phone:'phone', linkedin:'linkedin', location:'place', work_auth:'work_auth', salary:'salary', notice:'notice', target_roles:'roles', target_locations:'places'};
function sgProfile(){
  var p = null; try{ p = window.TP && window.TP.sgProfile ? window.TP.sgProfile() : null; }catch(e){}
  if(p) return p;
  p = {}; ['full_name', 'phone', 'linkedin', 'location', 'work_auth', 'salary', 'notice', 'target_roles', 'target_locations'].forEach(function(k){ var x = document.getElementById('pf_' + k); if(x) p[k] = x.value.trim(); });
  return p;
}
SUGGEST.profile = sgProfile;

window.TP = {
  CONFIG:CONFIG, VERSION:VERSION, I:I, $:$, $$:$$, esc:esc, debounce:debounce, lsGet:lsGet, lsSet:lsSet, ssGet:ssGet, ssSet:ssSet, uid:uid,
  toast:toast, busy:busy, copy:copy, fmtDate:fmtDate, fmtDateTime:fmtDateTime, ago:ago, initials:initials, hue:hue, logo:logo,
  STATUS:STATUS, statusLabel:statusLabel, statusChip:statusChip, cleanUrl:cleanUrl, safeHref:safeHref, safeNext:safeNext,
  client:client, session:session, q:q, whoami:whoami, toLogin:toLogin, signOut:signOut, fn:fn, errText:errText, authGone:authGone, net:net,
  onLeave:onLeave, leaveWhy:leaveWhy,
  upload:upload, fileUrl:fileUrl, fillFiles:fillFiles, shrinkImage:shrinkImage, modal:modal, closeModal:closeModal, tryClose:tryClose, confirmBox:confirmBox,
  isModal:function(){ return !!MOD; },
  COMMON_Q:COMMON_Q, roleIdeas:SUGGEST.roleIdeas, placeIdeas:SUGGEST.placeIdeas, placeParts:SUGGEST.placeParts, suggestAnswer:suggestAnswer, qKind:qKind,
  picksHTML:picksHTML, sg:SUGGEST.sg, PF_SG:PF_SG, sgKind:SUGGEST.kind
};
})();
