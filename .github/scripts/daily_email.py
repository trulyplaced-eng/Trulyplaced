"""TrulyPlaced — free daily job picks.

Every morning (see .github/workflows/daily-email.yml) this picks each subscriber's newest matching
roles from jobs.json (plus the roles your team added) and emails them through Brevo.

  * Only people who signed up for daily picks in the app get it (profiles.daily_email).
  * Matching uses their answers from the sign-up form (profiles.job_prefs): roles, remote/hybrid/on-site,
    location, experience level, US work authorization and minimum salary. Roles your team added on the
    "Add jobs" page get a boost; if they need visa sponsorship, roles marked "No sponsorship" are skipped
    and roles marked "Sponsors visas" go to the top.
  * Every email ends with one next step (free call · free ATS check · let us apply), rotating daily.
  * Nobody gets the same role twice (email_sends table). No new matches = no email that day.
  * Every email has a one-click unsubscribe link and your company address.

Modes (MODE env): preview  = build the emails into ./email-previews, send nothing
                  test     = send one sample to TEST_TO, record nothing
                  send     = the real daily run
Secrets: SUPABASE_SERVICE_KEY, BREVO_API_KEY (GitHub → Settings → Secrets and variables → Actions).
Only the Python standard library is used.
"""
import html, json, os, re, sys, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone, timedelta

ROOT = __file__.rsplit('/.github/', 1)[0] if '/.github/' in __file__ else '.'
APP = open(ROOT + '/app.html', encoding='utf-8').read()

def cfg(name, default=''):
    m = re.search(name + r":\s*'([^']*)'", APP)
    return m.group(1) if m else default

SUPABASE_URL = os.environ.get('SUPABASE_URL') or cfg('SUPABASE_URL')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
BREVO_KEY = os.environ.get('BREVO_API_KEY', '').strip()
BREVO_URL = os.environ.get('BREVO_URL', 'https://api.brevo.com/v3/smtp/email')
SENDER = os.environ.get('SENDER_EMAIL') or 'hello@trulyplaced.com'
SENDER_NAME = os.environ.get('SENDER_NAME') or 'TrulyPlaced Jobs'
SITE = (os.environ.get('SITE') or 'https://trulyplaced.com').rstrip('/')
BOOK_CALL = cfg('BOOK_CALL', 'https://calendly.com/hello-trulyplaced/career-hunt-2026')
MODE = (os.environ.get('MODE') or 'send').strip().lower()
TEST_TO = (os.environ.get('TEST_TO') or '').strip()
MAX_SENDS = int(os.environ.get('MAX_SENDS') or 290)          # Brevo free plan: 300 a day
PER_EMAIL = int(os.environ.get('PER_EMAIL') or 8)
WINDOW_DAYS = float(os.environ.get('WINDOW_DAYS') or 3)       # roles posted in the last N days
ADDRESS = 'RepoReserve Technologies Private Limited · H.No 3-10-320, Vivekananda Nagar, Nizamabad – 503001, Telangana, India'
NOW_MS = int(time.time() * 1000)
summary = []

def log(*a):
    line = ' '.join(str(x) for x in a); print(line); summary.append(line)

# ---------------------------------------------------------------- Supabase (service key: bypasses row security, never in the website)
def sb(method, path, body=None, headers=None):
    h = {'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', 'User-Agent': 'TrulyPlaced daily email'}
    h.update(headers or {})
    req = urllib.request.Request(SUPABASE_URL + '/rest/v1/' + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

def get_all(path, page=1000):
    out, start = [], 0
    while True:
        rows = sb('GET', path, headers={'Range-Unit': 'items', 'Range': f'{start}-{start + page - 1}'})
        out += rows or []
        if not rows or len(rows) < page: return out
        start += page

# ---------------------------------------------------------------- jobs
def load_jobs():
    d = json.load(open(ROOT + '/jobs.json', encoding='utf-8'))
    jobs = []
    for r in d.get('rows', []):
        jobs.append({'key': f'{r[0]}:{r[1]}:{r[2]}', 'title': r[3], 'company': r[4], 'location': r[5] or '', 'posted': r[6] or 0,
                     'mode': r[11] if len(r) > 11 else '', 'remote': bool(r[9]) if len(r) > 9 else False,
                     'salary': r[12] if len(r) > 12 else '', 'domain': r[13] if len(r) > 13 else '', 'country': r[15] if len(r) > 15 else '', 'team': False})
    try:   # roles your team added by hand on the "Add jobs" page
        seen = {j['key'] for j in jobs}
        for r in sb('GET', 'custom_jobs?select=*&active=eq.true&kind=eq.job&limit=1000') or []:
            src = r.get('src') if r.get('src') in ('gh', 'ashby', 'lever') else 'custom'
            key = f"custom:team:{r['id']}" if src == 'custom' else f"{src}:{r.get('board')}:{r.get('ext_id')}"
            posted = int(datetime.fromisoformat(str(r.get('posted_at') or r.get('created_at')).replace('Z', '+00:00')).timestamp() * 1000) if (r.get('posted_at') or r.get('created_at')) else NOW_MS
            job = {'key': key, 'title': r.get('title') or '', 'company': r.get('company') or '', 'location': r.get('location') or '', 'posted': posted,
                   'mode': r.get('work_mode') or '', 'remote': (r.get('work_mode') == 'Remote'), 'salary': r.get('salary') or '', 'domain': r.get('domain') or '', 'country': '', 'team': True,
                   'sponsors': r.get('sponsors') or sponsor_guess(r.get('description'))}
            if key in seen:
                for j in jobs:
                    if j['key'] == key: j['team'] = True; j['sponsors'] = job['sponsors']
            else: jobs.append(job)
    except Exception as e:
        log('Team jobs skipped:', e)
    return jobs

# ---------------------------------------------------------------- matching
STOP = set('senior sr junior jr staff principal lead head of and the ii iii iv i new grad associate intern internship remote us usa hybrid onsite on site full time part contract f m x a an for in at to with'.split())
SYN = {
    'analyst': ['analyst', 'analytics', 'analysis'], 'analytics': ['analytics', 'analyst'],
    'engineer': ['engineer', 'engineering', 'developer', 'swe', 'sde'], 'developer': ['developer', 'engineer', 'engineering', 'swe', 'sde'],
    'software': ['software', 'swe', 'sde', 'backend', 'frontend', 'fullstack', 'full-stack', 'stack', 'platform', 'web', 'mobile', 'ios', 'android'],
    'manager': ['manager', 'management'], 'scientist': ['scientist', 'science'], 'science': ['science', 'scientist'],
    'designer': ['designer', 'design'], 'marketing': ['marketing', 'marketer', 'growth'], 'sales': ['sales', 'account', 'business development', 'bdr', 'sdr'],
    'ml': ['ml', 'machine learning', 'ai'], 'ai': ['ai', 'ml', 'machine learning'], 'product': ['product'], 'data': ['data'],
    'operations': ['operations', 'ops'], 'recruiter': ['recruiter', 'recruiting', 'talent'], 'accountant': ['accountant', 'accounting'],
}
SENIOR = re.compile(r'\b(senior|sr\.?|staff|principal|lead)\b', re.I)
TOO_SENIOR = re.compile(r'\b(director|vp|vice president|head of|chief|svp|evp|cto|cfo|ceo|partner)\b', re.I)
JUNIOR_WANT = re.compile(r'\b(junior|jr|entry|new grad|graduate|intern|associate|early career)\b', re.I)
US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split()
US_RX = re.compile(r'(united states|\busa?\b|\bu\.s\.|, ?(' + '|'.join(US_STATES) + r')\b|remote ?[-–(]? ?us\b|americas|north america)', re.I)

SPONSOR_AUTH = {'opt', 'h1b', 'sponsor', 'outside'}   # answers that mean "will need a visa sponsor"
AUTH_LABEL = {'citizen': 'US citizen or green card', 'ead': 'Work permit (EAD)', 'opt': 'F-1 OPT / STEM OPT', 'h1b': 'H-1B', 'sponsor': 'Needs sponsorship', 'outside': 'Outside the US'}
LEVEL_LABEL = {'entry': 'Entry level', 'mid': 'Mid level', 'senior': 'Senior', 'lead': 'Lead & above'}
MODE_LABEL = {'remote': 'Remote', 'hybrid': 'Hybrid', 'onsite': 'On-site'}
YEARS_LABEL = {'0-1': '<1 yr', '1-3': '1–3 yrs', '3-5': '3–5 yrs', '5-8': '5–8 yrs', '8-12': '8–12 yrs', '12+': '12+ yrs'}
NO_SPONSOR = re.compile(r"\b(not|unable to|cannot|can[\'’]?t|won[\'’]?t|will not|do not|does not|don[\'’]?t)\s+(currently\s+)?(be\s+able\s+to\s+)?(offer|provide|sponsor|support)\b[^.]{0,40}\b(sponsor\w*|visas?|h-?1b)"
                        r"|without\s+(the\s+need\s+for\s+)?(current\s+or\s+future\s+)?(visa\s+|employer\s+)?sponsorship|\bno\s+(visa\s+)?sponsorship|sponsorship\s+(is\s+)?not\s+(available|offered|provided)", re.I)
YES_SPONSOR = re.compile(r"\b(visa|h-?1b)\s+sponsorship\s+(is\s+)?(available|offered|provided)|\bwill\s+sponsor\b|\b(we|company)\s+(can|do|does|will)\s+sponsor\b|\bsponsorship\s+(is\s+)?available|\bopen\s+to\s+sponsor", re.I)
JUNIOR_RX = re.compile(r'\b(junior|jr\.?|entry|new grad|graduate|intern|internship|associate|early career|apprentice)\b', re.I)
LEAD_RX = re.compile(r'\b(lead|principal|staff|manager|head of|director)\b', re.I)

def sponsor_guess(text):
    t = text or ''
    return 'no' if NO_SPONSOR.search(t) else 'yes' if YES_SPONSOR.search(t) else ''

def salary_max_k(text):
    """Highest yearly pay a listing mentions, in $K — None when it lists none we can read."""
    t = (text or '').lower().replace(',', '')
    if not t or not re.search(r'\d', t): return None
    hourly = bool(re.search(r'/\s*h(ou)?r|per hour|hourly|an hour', t))
    nums = []
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*(k\b)?', t):
        v = float(m.group(1))
        if m.group(2): v *= 1000
        nums.append(v)
    if not nums: return None
    top = max(nums)
    if hourly and top < 500: top *= 2080
    if top < 1000: return None          # not a yearly figure we understand
    return top / 1000

def level_fit(level, title):
    """Score nudge for a role's seniority, or None to skip it."""
    t = title or ''
    top, senior, junior, lead = TOO_SENIOR.search(t), SENIOR.search(t), JUNIOR_RX.search(t), LEAD_RX.search(t)
    if level == 'entry':
        if top or senior or lead: return None
        return 0.15 if junior else 0
    if level == 'mid':
        if top or re.search(r'\bintern', t, re.I): return None
        return -0.15 if (senior or lead) else 0
    if level == 'senior':
        if junior or (top and not re.search(r'\bmanager\b', t, re.I)): return None
        return 0.15 if senior else 0
    if level == 'lead':
        if junior: return None
        return 0.2 if (lead or top or senior) else -0.1
    return 0

def where_ok(pr, job):
    """Remote / hybrid / on-site + city, from their answers. No city = anywhere in the US."""
    modes = [m for m in (pr.get('modes') or []) if m in MODE_LABEL]
    where = (pr.get('where') or '').strip()
    loc = (job['location'] or '') + ' ' + (job['mode'] or '')
    is_remote = job['remote'] or job['mode'] == 'Remote' or bool(re.search(r'\bremote\b', loc, re.I))
    is_hybrid = job['mode'] == 'Hybrid' or bool(re.search(r'\bhybrid\b', loc, re.I))
    in_us = bool(US_RX.search(loc)) or job.get('country') == 'US'
    if not modes: return place_ok(where, job) and (in_us or bool(where) or pr.get('auth') == 'outside')
    if 'remote' in modes and is_remote and (in_us or re.fullmatch(r'\s*(fully\s+)?remote\s*', loc, re.I) or pr.get('auth') == 'outside'): return True
    if is_remote and not is_hybrid: return False
    office = ('hybrid' in modes) if is_hybrid else ('onsite' in modes) if job['mode'] == 'On-site' else ('hybrid' in modes or 'onsite' in modes)
    if not office: return False
    return place_ok(where, job) if where else (in_us or pr.get('auth') == 'outside')

def words(s):
    return [w for w in re.sub(r'[^a-z0-9+#]+', ' ', (s or '').lower()).split() if len(w) > 1 and w not in STOP]

def title_score(role, title):
    want = words(role)
    if not want: return 0
    t = ' ' + re.sub(r'[^a-z0-9+#]+', ' ', title.lower()) + ' '
    hit = 0
    for w in want:
        alts = SYN.get(w, [w])
        if any((' ' + a) in t for a in alts): hit += 1
    need = len(want) if len(want) <= 2 else max(2, round(len(want) * 0.67))
    return hit / len(want) if hit >= need else 0

def place_ok(where, job):
    where = (where or '').strip()
    if not where or re.search(r'\b(anywhere|any|worldwide|global|open)\b', where, re.I): return True
    loc = job['location'] + ' ' + (job['mode'] or '') + (' remote' if job['remote'] else '')
    for part in re.split(r'\s*(?:,|/|;|\||\bor\b|&)\s*', where, flags=re.I):
        p = part.strip().lower()
        if not p: continue
        if p in ('remote', 'remote us', 'remote - us', 'wfh', 'work from home'):
            if re.search(r'\bremote\b', loc, re.I) and (p == 'remote' or US_RX.search(loc) or 'remote' == loc.strip().lower()): return True
            continue
        if p in ('us', 'usa', 'united states', 'america', 'u.s.'):
            if US_RX.search(loc) or job.get('country') == 'US': return True
            continue
        if re.search(r'(^|[^a-z])' + re.escape(p) + r'($|[^a-z])', loc.lower()): return True
    return False

def pick(profile, jobs, already):
    pr = profile.get('job_prefs') or {}
    if pr.get('role'): return pick_prefs(profile, pr, jobs, already)
    roles = [r for r in re.split(r'\s*(?:,|/|;|\bor\b)\s*', profile.get('target_role') or '', flags=re.I) if r.strip()]
    if not roles: return []
    want_senior = any(SENIOR.search(r) or TOO_SENIOR.search(r) for r in roles)
    want_junior = any(JUNIOR_WANT.search(r) for r in roles)
    since = NOW_MS - WINDOW_DAYS * 864e5
    scored = []
    for j in jobs:
        if j['key'] in already or not j['posted'] or j['posted'] < since: continue
        s = max(title_score(r, j['title']) for r in roles)
        if not s or not place_ok(profile.get('target_location'), j): continue
        if TOO_SENIOR.search(j['title']) and not want_senior: continue
        if SENIOR.search(j['title']) and not want_senior: s -= 0.3 if want_junior else 0.15
        if j['team']: s += 0.1
        scored.append((s, j['posted'], j))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out, per_co = [], {}
    for s, _, j in scored:   # variety: at most 3 from one company
        if per_co.get(j['company'], 0) >= 3: continue
        per_co[j['company']] = per_co.get(j['company'], 0) + 1
        out.append(j)
        if len(out) >= PER_EMAIL: break
    return out

def pick_prefs(profile, pr, jobs, already):
    """The daily picks: everything they told us in the sign-up form."""
    roles = [r for r in re.split(r'\s*(?:,|/|;|\bor\b)\s*', pr.get('role') or '', flags=re.I) if r.strip()][:3]
    if not roles: return []
    needs = pr.get('auth') in SPONSOR_AUTH
    want_k = float(pr.get('salary') or 0)
    since = NOW_MS - WINDOW_DAYS * 864e5
    scored = []
    for j in jobs:
        if j['key'] in already or not j['posted'] or j['posted'] < since: continue
        s = max(title_score(r, j['title']) for r in roles)
        if not s or not where_ok(pr, j): continue
        nudge = level_fit(pr.get('level'), j['title'])
        if nudge is None: continue
        s += nudge
        if needs and j.get('sponsors') == 'no': continue
        if needs and j.get('sponsors') == 'yes': s += 0.25
        if want_k:
            top = salary_max_k(j['salary'])
            if top is not None and top < want_k * 0.95: continue
        if j['team']: s += 0.1
        scored.append((s, j['posted'], j))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out, per_co = [], {}
    for s, _, j in scored:   # variety: at most 3 from one company
        if per_co.get(j['company'], 0) >= 3: continue
        per_co[j['company']] = per_co.get(j['company'], 0) + 1
        out.append(j)
        if len(out) >= PER_EMAIL: break
    return out

def prefs_line(pr):
    if not pr: return ''
    modes = ' / '.join(MODE_LABEL[m] for m in (pr.get('modes') or []) if m in MODE_LABEL)
    bits = [' · '.join(b for b in [modes, (pr.get('where') or '').strip()] if b), YEARS_LABEL.get(pr.get('years'), ''), LEVEL_LABEL.get(pr.get('level'), ''),
            AUTH_LABEL.get(pr.get('auth'), ''), f"${int(pr['salary'])}K+" if pr.get('salary') else '']
    return ' · '.join(b for b in bits if b)

def funnel(p):
    """Every email ends on the same offer — we apply for you, let's talk — plus the free ATS check as a small link."""
    def u(c, base): return base + ('&' if '?' in base else '?') + f'utm_source=trulyplaced&utm_medium=email&utm_campaign=daily_picks&utm_content={c}'
    talk = {'k': 'call', 'cta': 'Let’s talk', 'href': u('call', BOOK_CALL),
            'title': 'We’ll apply to 1,000 jobs for you',
            'text': 'Your resume tailored to every job description — customized the way you want, for the roles you choose. Tell us what you’re after and we’ll take it from there.'}
    ats = {'k': 'ats', 'cta': 'Run a free ATS check on your resume', 'href': u('ats', SITE + '/ats-check.html')}
    return talk, [ats]

# ---------------------------------------------------------------- the email
COLORS = ['#0938d5', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1', '#4d7c0f', '#9333ea']
def e(s): return html.escape(str(s or ''), quote=True)
def ago(ms):
    d = int((NOW_MS - ms) // 864e5)
    return 'Posted today' if d <= 0 else 'Posted yesterday' if d == 1 else f'Posted {d} days ago'
def job_link(j, uid):
    return f"{SITE}/app.html?ref=email&utm_source=daily_email&utm_medium=email&utm_campaign=matches#job={urllib.parse.quote(j['key'], safe='')}"
def first_name(p):
    n = (p.get('full_name') or '').strip().split(' ')[0]
    return n if n and len(n) < 25 else ''
def role_label(p):
    pr = p.get('job_prefs') or {}
    r = re.split(r'\s*(?:,|/|;|\bor\b)\s*', pr.get('role') or p.get('target_role') or '', flags=re.I)[0].strip()
    return r[:1].upper() + r[1:] if r else 'your'

def build(p, picks):
    n, role, fn = len(picks), role_label(p), first_name(p)
    pr = p.get('job_prefs') or {}
    needs = pr.get('auth') in SPONSOR_AUTH
    main, others = funnel(p)
    cos = []
    for j in picks:
        if j['company'] not in cos: cos.append(j['company'])
    subject = f"Your daily picks: {n} {role} role{'s' if n > 1 else ''} — " + (', '.join(cos[:2]) + (' and more' if len(cos) > 2 else '') if cos else 'fresh today')
    if len(subject) > 78: subject = f"Your daily picks: {n} new {role} roles"
    unsub = f"{SITE}/unsubscribe.html?t={p.get('unsub_token')}"
    settings = f"{SITE}/app.html?ref=email#picks"
    where = ((pr.get('where') if pr else p.get('target_location')) or '').strip()
    matched = prefs_line(pr)
    pre = f"{n} new {role} role{'s' if n > 1 else ''} posted in the last few days" + (f" — {where}" if where else '') + '. Tap one to see your match score.'
    rows = ''
    for i, j in enumerate(picks):
        bits = [e(j['company']), e(j['location'] or (j['mode'] or ''))]
        meta = ' · '.join(b for b in bits if b)
        chips = ''
        if j['salary']: chips += f'<span style="display:inline-block;background:#e6f6ee;color:#0a7f46;border-radius:999px;padding:2px 8px;font:600 12px Arial,Helvetica,sans-serif;margin:6px 6px 0 0">{e(j["salary"])}</span>'
        if j['mode']: chips += f'<span style="display:inline-block;background:#eef2ff;color:#0938d5;border-radius:999px;padding:2px 8px;font:600 12px Arial,Helvetica,sans-serif;margin:6px 6px 0 0">{e(j["mode"])}</span>'
        if j['team']: chips += '<span style="display:inline-block;background:#f3eeff;color:#6d28d9;border-radius:999px;padding:2px 8px;font:600 12px Arial,Helvetica,sans-serif;margin:6px 6px 0 0">Picked by our team</span>'
        if needs and j.get('sponsors') == 'yes': chips += '<span style="display:inline-block;background:#fff1e6;color:#9a3d00;border-radius:999px;padding:2px 8px;font:600 12px Arial,Helvetica,sans-serif;margin:6px 6px 0 0">Sponsors visas</span>'
        initial = e((j['company'] or '?')[:1].upper())
        tile = (f'<img src="https://www.google.com/s2/favicons?domain={e(j["domain"])}&sz=128" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px;background:#fff;border:1px solid #e7e9f2">'
                if j['domain'] else
                f'<div style="width:40px;height:40px;border-radius:10px;background:{COLORS[i % len(COLORS)]};color:#fff;font:700 17px/40px Arial,sans-serif;text-align:center">{initial}</div>')
        link = e(job_link(j, p['id']))
        rows += f'''
<tr><td style="padding:14px 0;border-top:1px solid #eef0f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="52" valign="top" style="padding-right:12px">{tile}</td>
    <td valign="top">
      <a href="{link}" style="font:700 16px/1.35 Arial,Helvetica,sans-serif;color:#121a33;text-decoration:none">{e(j['title'])}</a>
      <div style="font:14px/1.45 Arial,Helvetica,sans-serif;color:#4b5473;margin-top:3px">{meta}</div>
      <div style="font:12.5px/1.4 Arial,Helvetica,sans-serif;color:#737b9c;margin-top:2px">{ago(j['posted'])}</div>
      {chips}
    </td>
    <td width="110" valign="middle" align="right"><a href="{link}" style="display:inline-block;background:#0938d5;color:#ffffff;font:700 13px Arial,Helvetica,sans-serif;text-decoration:none;border-radius:9px;padding:9px 12px">View role</a></td>
  </tr></table>
</td></tr>'''
    hello = f'Hi {e(fn)},' if fn else 'Hi there,'
    body = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>{e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f4fa">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f2f4fa">{e(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4fa"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="padding:4px 4px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td><img src="{SITE}/email-logo.png" width="32" height="32" alt="" style="display:block;border-radius:8px"></td>
      <td style="padding-left:9px;font:700 18px Arial,Helvetica,sans-serif;color:#121a33">TrulyPlaced <span style="color:#737b9c;font-weight:600;font-size:13px">Jobs</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:18px;padding:26px 24px 10px;border:1px solid #e7e9f2">
    <div style="font:15px/1.5 Arial,Helvetica,sans-serif;color:#4b5473">{hello}</div>
    <div style="margin-top:10px"><span style="display:inline-block;background:#eef2ff;color:#0938d5;border-radius:999px;padding:3px 10px;font:700 11px Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase">Your daily picks</span></div>
    <h1 style="margin:8px 0 4px;font:800 23px/1.25 Arial,Helvetica,sans-serif;color:#121a33">{n} fresh {e(role)} role{"s" if n > 1 else ""} for you</h1>
    <div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#737b9c">Posted in the last few days{(" · " + e(where)) if where and not matched else ""}. Apply early — fresh roles get the most attention.</div>
    {f'<div style="font:12.5px/1.5 Arial,Helvetica,sans-serif;color:#737b9c;margin-top:8px;padding:8px 10px;background:#f6f7fb;border-radius:10px">Matched to you: {e(matched)} · <a href="{e(settings)}" style="color:#0938d5;text-decoration:none;font-weight:700">Edit</a></div>' if matched else ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">{rows}</table>
    <div style="padding:14px 0 16px;text-align:center"><a href="{e(SITE + '/app.html?ref=email&utm_source=daily_email#jobs')}" style="font:700 14px Arial,Helvetica,sans-serif;color:#0938d5;text-decoration:none">See all new roles on TrulyPlaced Jobs →</a></div>
  </td></tr>
  <tr><td style="padding-top:14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1b4d;background-image:linear-gradient(135deg,#0b1b4d,#0938d5);border-radius:16px"><tr>
      <td style="padding:20px 22px">
        <div style="font:700 17px/1.35 Arial,Helvetica,sans-serif;color:#ffffff">{e(main['title'])}</div>
        <div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#c9d4ff;margin-top:4px">{e(main['text'])}</div>
        <a href="{e(main['href'])}" style="display:inline-block;margin-top:12px;background:#ffffff;color:#0938d5;font:700 14px Arial,Helvetica,sans-serif;text-decoration:none;border-radius:10px;padding:10px 16px">{e(main['cta'])}</a>
      </td></tr></table>
    <div style="padding:12px 4px 0;font:13px/1.6 Arial,Helvetica,sans-serif;color:#4b5473;text-align:center">Also free: {' &nbsp;·&nbsp; '.join(f'<a href="{e(o["href"])}" style="color:#0938d5;font-weight:700;text-decoration:none">{e(o["cta"])}</a>' for o in others)}</div>
  </td></tr>
  <tr><td style="padding:18px 8px 8px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#8a91ad;text-align:center">
    You’re getting this because you signed up for free daily job picks on TrulyPlaced Jobs.<br>
    <a href="{e(settings)}" style="color:#4b5473">Update your preferences</a> &nbsp;·&nbsp; <a href="{e(unsub)}" style="color:#4b5473">Unsubscribe</a><br>
    {e(ADDRESS)}
  </td></tr>
</table></td></tr></table></body></html>'''
    text = (f"{'Hi ' + fn + ',' if fn else 'Hi there,'}\n\nYour daily picks: {n} fresh {role} role{'s' if n > 1 else ''}, posted in the last few days." + (f"\nMatched to you: {matched}" if matched else '') + "\n\n" +
            '\n\n'.join(f"{j['title']} — {j['company']}" + (f", {j['location']}" if j['location'] else '') + (f" ({j['salary']})" if j['salary'] else '') + f"\n{job_link(j, p['id'])}" for j in picks) +
            f"\n\n{main['title']} {main['cta']}: {main['href']}\n" + ''.join(f"{o['cta']}: {o['href']}\n" for o in others) +
            f"\nUpdate your preferences: {settings}\nUnsubscribe: {unsub}\n{ADDRESS}\n")
    return subject, body, text, unsub

# ---------------------------------------------------------------- Brevo
def send(to, name, subject, body, text, unsub):
    payload = {'sender': {'name': SENDER_NAME, 'email': SENDER}, 'to': [{'email': to, **({'name': name} if name else {})}],
               'replyTo': {'email': SENDER, 'name': 'TrulyPlaced'}, 'subject': subject, 'htmlContent': body, 'textContent': text,
               'headers': {'List-Unsubscribe': f'<{unsub}>, <mailto:{SENDER}?subject=unsubscribe>'}, 'tags': ['daily-picks']}
    for attempt in range(3):
        req = urllib.request.Request(BREVO_URL, data=json.dumps(payload).encode(), method='POST',
                                     headers={'api-key': BREVO_KEY, 'accept': 'application/json', 'content-type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as err:
            msg = err.read().decode(errors='replace')[:300]
            if err.code in (401, 403): raise SystemExit('Brevo refused the API key or sender — check BREVO_API_KEY and that ' + SENDER + ' is a verified sender. ' + msg)
            if err.code == 400: raise ValueError('Brevo rejected this email: ' + msg)
            if attempt == 2: raise
            time.sleep(2 + attempt * 3)   # 429 / 5xx: wait and retry

# ---------------------------------------------------------------- run
def main():
    if MODE not in ('preview', 'test', 'send'): sys.exit('MODE must be preview, test or send')
    if not SERVICE_KEY:
        log('Not set up yet: add the SUPABASE_SERVICE_KEY secret in GitHub. Nothing sent.'); return finish()
    if MODE != 'preview' and not BREVO_KEY:
        log('Not set up yet: add the BREVO_API_KEY secret in GitHub. Nothing sent.'); return finish()
    jobs = load_jobs()
    log(f'{len(jobs)} roles loaded; {sum(1 for j in jobs if j["posted"] >= NOW_MS - WINDOW_DAYS*864e5)} posted in the last {WINDOW_DAYS:g} days')
    base = 'profiles?select=id,email,full_name,target_role,target_location,unsub_token{}&daily_email=is.true&order=daily_email_at.asc'
    try:
        subs = get_all(base.format(',job_prefs'))
    except urllib.error.HTTPError:
        try:
            subs = get_all(base.format(''))
            log('Note: run supabase-daily-picks.sql so the emails use each person’s form answers (visa, level, salary).')
        except urllib.error.HTTPError as err:
            sys.exit('Could not read subscribers — did you run supabase-daily-email.sql? ' + err.read().decode(errors='replace')[:200])
    log(f'{len(subs)} subscriber(s)')
    if MODE == 'test':
        if not TEST_TO: sys.exit('Test mode needs an email address (TEST_TO)')
        me = next((s for s in subs if (s.get('email') or '').lower() == TEST_TO.lower()), None)
        p = me or {'id': 'test', 'email': TEST_TO, 'full_name': '', 'target_role': os.environ.get('TEST_ROLE') or 'Data Analyst', 'target_location': os.environ.get('TEST_LOCATION') or '', 'unsub_token': 'test',
                   'job_prefs': json.loads(os.environ['TEST_PREFS']) if os.environ.get('TEST_PREFS') else None}
        picks = pick(p, jobs, set())
        if not picks: log(f'No matching roles in the last {WINDOW_DAYS:g} days for "{p["target_role"]}" — try another TEST_ROLE.'); return finish()
        subject, body, text, unsub = build(p, picks)
        send(TEST_TO, p.get('full_name'), '[Test] ' + subject, body, text, unsub)
        log(f'Test email sent to {TEST_TO}: "{subject}" ({len(picks)} roles)'); return finish()
    since = (datetime.now(timezone.utc) - timedelta(days=45)).strftime('%Y-%m-%dT%H:%M:%SZ')
    sent_rows = get_all(f'email_sends?select=user_id,job_key&sent_at=gte.{since}')
    already = {}
    for r in sent_rows: already.setdefault(r['user_id'], set()).add(r['job_key'])
    os.makedirs('email-previews', exist_ok=True) if MODE == 'preview' else None
    sent = skipped = failed = 0
    for p in subs:
        if sent >= MAX_SENDS:
            log(f'Stopped at {MAX_SENDS} emails (daily limit) — the rest get theirs tomorrow.'); break
        to = (p.get('email') or '').strip()
        if not to or '@' not in to or not (p.get('target_role') or (p.get('job_prefs') or {}).get('role')):
            skipped += 1; continue
        picks = pick(p, jobs, already.get(p['id'], set()))
        if not picks:
            skipped += 1; continue
        subject, body, text, unsub = build(p, picks)
        if MODE == 'preview':
            fn = f"email-previews/{sent + 1:03d}-{re.sub(r'[^a-z0-9]+', '-', to.lower())[:40]}.html"
            open(fn, 'w', encoding='utf-8').write(body)
            log(f'  preview: {to} · {subject}'); sent += 1; continue
        try:
            send(to, p.get('full_name'), subject, body, text, unsub)
        except (ValueError, urllib.error.URLError) as err:
            failed += 1; log(f'  could not send to {to[:2]}…: {err}'); continue
        sent += 1
        try:
            sb('POST', 'email_sends', [{'user_id': p['id'], 'job_key': j['key']} for j in picks], {'Prefer': 'resolution=ignore-duplicates,return=minimal'})
            sb('PATCH', f"profiles?id=eq.{p['id']}", {'last_email_at': datetime.now(timezone.utc).isoformat()}, {'Prefer': 'return=minimal'})
        except Exception as err:
            log('  sent, but could not record it:', err)
        time.sleep(0.15)
    log(f"{'Built' if MODE == 'preview' else 'Sent'} {sent} email(s); {skipped} had no new matching roles today" + (f'; {failed} failed' if failed else ''))
    finish()

def finish():
    s = os.environ.get('GITHUB_STEP_SUMMARY')
    if s:
        with open(s, 'a', encoding='utf-8') as fh: fh.write('### Daily job email\n\n' + '\n'.join('- ' + l for l in summary) + '\n')

if __name__ == '__main__':
    main()
