"""Builds jobs.json for the TrulyPlaced job board.

Runs on GitHub every few hours (see .github/workflows/update-jobs.yml). It reads the
company list straight from app.html, fetches each company's official public job board
(Greenhouse, Ashby or Lever) and writes one compact file the board loads in a second.
Only the Python standard library is used.
"""
import json, re, sys, time, urllib.request, concurrent.futures as cf
from datetime import datetime

ROOT = __file__.rsplit('/.github/', 1)[0] if '/.github/' in __file__ else '.'
HTML = open(ROOT + '/app.html', encoding='utf-8').read()
COMPANIES = [dict(src=m[0], board=m[1], name=m[2], domain=m[3]) for m in
             re.findall(r"\{src:'(\w+)',\s*board:'([^']+)',\s*name:'([^']+)',\s*domain:'([^']+)'\}", HTML)]
if len(COMPANIES) < 5:
    sys.exit('Could not read the company list from app.html')

URLS = {
    'gh': 'https://boards-api.greenhouse.io/v1/boards/{}/jobs',
    'ashby': 'https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true',
    'lever': 'https://api.lever.co/v0/postings/{}?mode=json',
}
CUR = {'USD': '$', 'CAD': 'CA$', 'AUD': 'A$', 'GBP': '£', 'EUR': '€'}

def money(v, cur):
    s = CUR.get(cur or '', (cur + ' ') if cur else '$')
    return s + (f'{round(v / 1000)}K' if v >= 1000 else str(round(v)))

def ms(iso):
    if not iso:
        return 0
    try:
        return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return 0

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'TrulyPlaced job board (trulyplaced.com)'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

# row: [src, board, id, title, company, location, posted, url, dept, remote, type, mode, salary, domain, extraLoc, country]
def rows_for(c):
    d = get(URLS[c['src']].format(c['board']))
    out = []
    if c['src'] == 'gh':
        for x in d.get('jobs', []):
            loc = x.get('location')
            loc = loc if isinstance(loc, str) else (loc or {}).get('name', '')
            out.append(['gh', c['board'], str(x['id']), (x.get('title') or '').strip(), c['name'], loc,
                        ms(x.get('first_published') or x.get('updated_at')), x.get('absolute_url', ''), '', 0, '', '', '', c['domain'], '', ''])
    elif c['src'] == 'ashby':
        T = {'FullTime': 'Full Time', 'PartTime': 'Part Time', 'Intern': 'Internship', 'Contract': 'Contract', 'Temporary': 'Temporary'}
        M = {'Remote': 'Remote', 'Hybrid': 'Hybrid', 'OnSite': 'On-site', 'Onsite': 'On-site'}
        for x in d.get('jobs', []):
            if x.get('isListed') is False:
                continue
            sec = ' · '.join(s if isinstance(s, str) else (s or {}).get('location', '') for s in (x.get('secondaryLocations') or []))
            comp = ((x.get('compensation') or {}).get('compensationTierSummary') or (x.get('compensation') or {}).get('scrapeableCompensationSalarySummary') or '')
            addr = x.get('address')
            xl = json.dumps(addr.get('postalAddress')) if isinstance(addr, dict) and addr.get('postalAddress') else ''
            out.append(['ashby', c['board'], str(x['id']), (x.get('title') or '').strip(), c['name'],
                        (x.get('location') or '') + (' · ' + sec if sec else ''), ms(x.get('publishedAt')), x.get('jobUrl', ''),
                        x.get('department') or '', 1 if x.get('isRemote') else 0, T.get(x.get('employmentType'), ''),
                        M.get(x.get('workplaceType')) or ('Remote' if x.get('isRemote') else ''), str(comp).split('•')[0].strip(), c['domain'], xl, ''])
    else:
        M = {'remote': 'Remote', 'hybrid': 'Hybrid', 'onsite': 'On-site', 'on-site': 'On-site'}
        for x in d if isinstance(d, list) else []:
            cat = x.get('categories') or {}
            loc = ' · '.join(cat.get('allLocations') or []) or cat.get('location') or ''
            cm = str(cat.get('commitment') or '')
            typ = 'Full Time' if re.search('full', cm, re.I) else 'Part Time' if re.search('part', cm, re.I) else 'Internship' if re.search('intern', cm, re.I) else 'Contract' if re.search('contract|temp', cm, re.I) else cm
            sr, sal = x.get('salaryRange') or {}, ''
            if sr.get('min') and sr.get('max') and 'hour' not in str(sr.get('interval', '')):
                sal = f"{money(sr['min'], sr.get('currency'))} – {money(sr['max'], sr.get('currency'))}" + (f" {sr['currency']}" if sr.get('currency') else '')
            out.append(['lever', c['board'], str(x['id']), (x.get('text') or '').strip(), c['name'], loc, int(x.get('createdAt') or 0),
                        x.get('hostedUrl', ''), cat.get('department') or cat.get('team') or '', 1 if x.get('workplaceType') == 'remote' else 0,
                        typ, M.get(str(x.get('workplaceType') or '').lower(), ''), sal, c['domain'], '', x.get('country') or ''])
    return out

def main():
    rows, ok, failed = [], 0, []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(rows_for, c): c for c in COMPANIES}
        for f in cf.as_completed(futs):
            c = futs[f]
            try:
                rows += f.result(); ok += 1
            except Exception as e:  # one company being down must not stop the rest
                failed.append(f"{c['name']}: {e}")
    if ok < len(COMPANIES) // 2:
        sys.exit(f'Only {ok} of {len(COMPANIES)} boards loaded — keeping the previous jobs.json. ' + '; '.join(failed))
    rows.sort(key=lambda r: r[6], reverse=True)
    out = {'at': int(time.time() * 1000), 'n': ok, 'f': len(failed), 'rows': rows}
    with open(ROOT + '/jobs.json', 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'jobs.json: {len(rows)} roles from {ok} companies' + (f' ({len(failed)} unavailable: ' + '; '.join(failed) + ')' if failed else ''))

if __name__ == '__main__':
    main()
