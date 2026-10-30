/* The job match, counted as the resume editor counts it (window.TPMatch). Built by editor-build/build.py
   from ats-check.html and editor-build/src/match.js - do not edit by hand. */
(function(){
var BUL = '•●▪◦‣∙·*–—\\-➢➤►✓✔◆■□○';
var BUL_RX = new RegExp('^\\s*[' + BUL + ']\\s*');

function readPDF(buf){
  return pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){
    var jobs = [];
    for(var i=1;i<=pdf.numPages;i++) jobs.push(pdf.getPage(i).then(readPage));
    return Promise.all(jobs).then(function(pages){ return {pdf:pdf, pages:pages}; });
  });
}
function readPage(page){
  var vp = page.getViewport({scale:1});
  return Promise.all([page.getTextContent(), page.getOperatorList()]).then(function(r){
    var tc = r[0], ops = r[1], O = pdfjsLib.OPS, big = 0, small = 0;
    ops.fnArray.forEach(function(f, i){
      if(f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageXObjectRepeat){
        var a = ops.argsArray[i] || [], w = +a[1] || 0, h = +a[2] || 0;
        if(f === O.paintInlineImageXObject && a[0]){ w = a[0].width || 0; h = a[0].height || 0; }
        if(w >= 90 && h >= 90) big++; else small++;
      }
    });
    var items = tc.items.filter(function(it){ return typeof it.str === 'string' && it.str.length; }).map(function(it){
      var t = pdfjsLib.Util.transform(vp.transform, it.transform);
      var fh = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 10;
      return {str:it.str, x:t[4], y:t[5] - fh*0.82, w:Math.abs(it.width) || it.str.length*fh*0.5, h:fh};
    });
    return {page:page, w:vp.width, h:vp.height, items:items, big:big, small:small, lines:buildLines(items, vp.width)};
  });
}
/* group text into visual lines, then split each line where there is a wide horizontal gap */
function buildLines(items, W){
  var its = items.filter(function(i){ return i.str.trim(); }).sort(function(a,b){ return (a.y + a.h/2) - (b.y + b.h/2) || a.x - b.x; });
  var lines = [];
  its.forEach(function(it){
    var cy = it.y + it.h/2, hit = null;
    for(var k=lines.length-1;k>=0 && k>=lines.length-3;k--){ if(Math.abs(lines[k].cy - cy) < Math.max(lines[k].h, it.h)*0.5){ hit = lines[k]; break; } }
    if(hit){ hit.items.push(it); hit.cy = (hit.cy*hit.n + cy)/(hit.n+1); hit.n++; hit.h = Math.max(hit.h, it.h); }
    else lines.push({items:[it], cy:cy, n:1, h:it.h});
  });
  lines.forEach(function(L){
    L.items.sort(function(a,b){ return a.x - b.x; });
    var s = '', segs = [], seg = null;
    L.items.forEach(function(it, i){
      var gap = i ? it.x - (L.items[i-1].x + L.items[i-1].w) : 0;
      if(i && gap > W*0.06){ seg = null; }
      if(i && gap > Math.max(1.2, it.h*0.12) && !/\s$/.test(s) && !/^\s/.test(it.str)) s += gap > W*0.06 ? '   ' : ' ';
      it.o = s.length; s += it.str;
      if(!seg){ seg = {x0:it.x, x1:it.x + it.w, items:[it]}; segs.push(seg); } else { seg.items.push(it); seg.x1 = it.x + it.w; }
    });
    L.text = s; L.segs = segs; L.y = Math.min.apply(null, L.items.map(function(i){ return i.y; }));
    L.x0 = L.items[0].x; L.size = L.h;
    segs.forEach(function(g){ g.text = g.items.map(function(i){ return i.str; }).join(' ').replace(/\s+/g,' ').trim(); });
  });
  return lines;
}
var DATEISH = /^(?:\(?\s*)?(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?(?:\d{1,2}[\/.\-])?(?:19|20)\d{2}|present|current|remote|[A-Z][a-z]+,\s*[A-Z]{2}\b/i;
/* two-column layouts: an empty vertical "gutter" with real text on both sides, down most of the page */
function detectColumns(pg){
  var W = pg.w, H = pg.h, its = pg.items.filter(function(i){ return i.str.trim() && i.y > H*0.12; });
  if(its.length < 20) return null;
  var bins = []; for(var b=0;b<100;b++) bins.push(0);
  its.forEach(function(it){ var a = Math.max(0, Math.floor(it.x/W*100)), z = Math.min(99, Math.floor((it.x + it.w)/W*100)); for(var k=a;k<=z;k++) bins[k]++; });
  var best = null, run = null;
  for(var k=20;k<=78;k++){
    if(bins[k] === 0){ if(!run) run = {a:k, b:k}; else run.b = k; }
    else { if(run && (!best || run.b - run.a > best.b - best.a)) best = run; run = null; }
  }
  if(run && (!best || run.b - run.a > best.b - best.a)) best = run;
  if(!best) return null;
  var split = (best.a + best.b + 1)/200*W;
  var left = its.filter(function(i){ return i.x + i.w <= split; }), right = its.filter(function(i){ return i.x >= split; });
  var chars = function(arr){ return arr.filter(function(i){ return !DATEISH.test(i.str.trim()); }).reduce(function(n, i){ return n + i.str.trim().length; }, 0); };
  var span = function(arr){ if(!arr.length) return 0; var ys = arr.map(function(i){ return i.y; }); return (Math.max.apply(null, ys) - Math.min.apply(null, ys))/H; };
  if(chars(left) < 150 || chars(right) < 150 || span(left) < 0.3 || span(right) < 0.3) return null;
  return split;
}
function sideText(items){ var s = ''; items.forEach(function(it, i){ if(i){ var p = items[i-1], gap = it.x - (p.x + p.w); if(gap > Math.max(1.2, it.h*0.12) && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' '; } s += it.str; }); return s.replace(/\s+/g,' ').trim(); }
function readDOCX(buf){
  return mammoth.convertToHtml({arrayBuffer:buf}).then(function(r){
    var doc = new DOMParser().parseFromString('<div>' + r.value + '</div>', 'text/html');
    var lines = [], tables = doc.querySelectorAll('table').length, images = doc.querySelectorAll('img').length;
    var walk = function(node, inTable){
      [].forEach.call(node.children, function(el){
        var tag = el.tagName;
        if(tag === 'TABLE'){ lines.push({t:'', tblStart:true}); walk(el, true); lines.push({t:'', tblEnd:true}); return; }
        if(/^(P|H[1-6]|LI)$/.test(tag)){
          var t = el.textContent.replace(/\s+/g,' ').trim();
          if(t) lines.push({t:t, bullet:tag === 'LI', head:/^H/.test(tag), tbl:inTable, bold:!!el.querySelector('strong') && el.querySelector('strong').textContent.trim() === t});
          if(tag === 'LI'){ [].forEach.call(el.children, function(c){ if(/^(UL|OL)$/.test(c.tagName)) walk(c, inTable); }); }
          return;
        }
        walk(el, inTable);
      });
    };
    walk(doc.body.firstChild, false);
    return {lines:lines.filter(function(l){ return l.t; }), rawLines:lines, tables:tables, images:images};
  });
}

/* =====================================================================
   2. LANGUAGE DATA
   ===================================================================== */
var HEADS = [
  ['summary', /^((professional|career|executive|personal) )?(summary|profile)$|^about( me)?$|^(career )?objective$|^overview$|^summary of qualifications$|^professional overview$/i],
  ['experience', /^((work|professional|employment|relevant|industry) )?(experience|history)$|^employment( history)?$|^career history$|^work history$|^experience$/i],
  ['education', /^education( (&|and) (training|certifications?))?$|^academic (background|qualifications?|details)$|^academics$|^educational qualifications?$|^qualifications$/i],
  ['skills', /^((technical|core|key|professional|relevant) )?(skills|competenc(ies|e))( (&|and) (tools|technologies|interests|expertise))?$|^technologies$|^tech(nical)? stack$|^tools( (&|and) technologies)?$|^areas of expertise$|^expertise$|^technical proficienc(y|ies)$/i],
  ['projects', /^((academic|personal|key|selected|notable) )?projects$/i],
  ['certifications', /^(certifications?|licen[cs]es( (&|and) certifications?)?|courses|training|certificates|certifications (&|and) (training|courses))$/i],
  ['awards', /^(awards( (&|and) (honou?rs|achievements))?|honou?rs( (&|and) awards)?|achievements|accomplishments)$/i],
  ['personal', /^personal (details|information|profile|data)$|^personal$/i],
  ['declaration', /^declaration$/i],
  ['other', /^(contact( (details|information|info|me))?|get in touch|volunteer(ing)?( experience| work)?|publications|languages|interests|hobbies( (&|and) interests)?|extra[- ]?curricular( activities)?|activities|leadership( experience)?|references)$/i]
];
function headKind(t){
  var s = String(t).replace(/[:|•\-–—_]+\s*$/,'').trim();
  if(!s || s.length > 42 || s.split(/\s+/).length > 5 || !/^[A-Z0-9]/.test(s)) return null;
  for(var i=0;i<HEADS.length;i++) if(HEADS[i][1].test(s)) return HEADS[i][0];
  return null;
}
var VERBS = ('accelerated achieved acquired adapted administered advised advocated analysed analyzed architected arranged assembled assessed audited authored automated balanced benchmarked boosted briefed budgeted built calculated campaigned captured centralized centralised championed changed chaired clarified closed coached collaborated compiled completed composed computed conceived conceptualized condensed conducted configured consolidated constructed consulted contracted contributed controlled converted convinced coordinated corrected counseled created cultivated curated customized cut debugged decreased defined delegated delivered demonstrated deployed designed detected determined developed devised diagnosed directed discovered documented doubled drafted drove earned edited educated eliminated enabled encouraged engineered enhanced established estimated evaluated examined exceeded executed expanded expedited experimented facilitated finalized forecasted formalized formed formulated founded gained generated grew guided halved handled headed hired identified implemented improved incorporated increased influenced initiated innovated inspected installed instituted instructed integrated interpreted interviewed introduced invented investigated launched led leveraged lifted lowered maintained managed mapped marketed maximized measured mediated mentored merged migrated minimized mobilized modeled modelled modernized monitored motivated negotiated onboarded operated optimized optimised orchestrated organized organised originated outperformed overhauled oversaw owned partnered performed persuaded piloted pioneered planned predicted prepared presented prioritized processed produced programmed projected promoted proposed prototyped proved provided published purchased raised ran rebuilt recommended reconciled recruited redesigned reduced refactored refined reorganized replaced reported represented researched resolved restructured revamped reviewed revised revitalized saved scaled scheduled scoped screened secured segmented selected served shaped shipped simplified sold solved spearheaded standardized started steered streamlined strengthened structured supervised surpassed synthesized systematized tested trained transformed translated tripled troubleshot tuned uncovered unified upgraded validated verified visualized won wrote').split(' ');
var VERBSET = {}; VERBS.forEach(function(v){ VERBSET[v] = 1; });
var WEAK = [
  ['responsible for', 'Owned'], ['duties included', 'Handled'], ['duties include', 'Handled'], ['worked on', 'Built'], ['working on', 'Built'],
  ['helped with', 'Supported'], ['helped to', 'Supported'], ['helped', 'Supported'], ['assisted in', 'Supported'], ['assisted with', 'Supported'], ['assisted', 'Supported'],
  ['tasked with', 'Owned'], ['involved in', 'Contributed to'], ['participated in', 'Contributed to'], ['in charge of', 'Led'], ['handled', 'Managed'],
  ['was part of', 'Contributed to'], ['part of a team', 'Worked with a team'], ['exposure to', 'Used'], ['familiar with', 'Used'], ['knowledge of', 'Applied']
];
var GERUND = {managing:'Managed',developing:'Developed',creating:'Created',leading:'Led',handling:'Handled',maintaining:'Maintained',building:'Built',designing:'Designed',coordinating:'Coordinated',analyzing:'Analyzed',analysing:'Analysed',preparing:'Prepared',ensuring:'Ensured',supporting:'Supported',monitoring:'Monitored',testing:'Tested',writing:'Wrote',running:'Ran',overseeing:'Oversaw',conducting:'Conducted',implementing:'Implemented',providing:'Provided',tracking:'Tracked',reviewing:'Reviewed',training:'Trained',planning:'Planned',executing:'Executed',generating:'Generated',improving:'Improved',reducing:'Reduced',collaborating:'Collaborated',automating:'Automated',delivering:'Delivered',organizing:'Organized',organising:'Organised',reporting:'Reported',resolving:'Resolved',optimizing:'Optimized',drafting:'Drafted',researching:'Researched',onboarding:'Onboarded',mentoring:'Mentored',deploying:'Deployed',migrating:'Migrated',launching:'Launched',negotiating:'Negotiated',selling:'Sold',recruiting:'Recruited',scheduling:'Scheduled',updating:'Updated',cleaning:'Cleaned',processing:'Processed',creating:'Created',making:'Made',setting:'Set up',documenting:'Documented',identifying:'Identified',integrating:'Integrated',debugging:'Debugged',configuring:'Configured',administering:'Administered'};
var FAMILY = [
  [/^(built|developed|designed|created|engineered|implemented|launched|shipped|automated|architected|prototyped|programmed|deployed|configured|integrated|rebuilt|redesigned|refactored|wrote|authored|produced|established|founded|instituted|introduced|invented|set)/, ' — used by [__ users / teams]', ' — saving [__ hours a week]'],
  [/^(improved|increased|reduced|optimi[sz]ed|streamlined|accelerated|cut|grew|boosted|lowered|lifted|doubled|tripled|halved|enhanced|maximi[sz]ed|minimi[sz]ed|upgraded|modernized|revamped|simplified|strengthened|expanded)/, ' by [__%]', ' from [__] to [__]'],
  [/^(led|managed|directed|mentored|coordinated|supervised|oversaw|headed|chaired|trained|coached|guided|hired|recruited|onboarded|orchestrated|ran|owned|steered|spearheaded)/, ' — a team of [__]', ' across [__ projects / markets]'],
  [/^(analy[sz]ed|evaluated|researched|modell?ed|forecasted|audited|identified|assessed|investigated|measured|examined|tested|validated|benchmarked|reviewed|mapped|uncovered|discovered|diagnosed)/, ', leading to [the decision / saving it drove]', ' covering [__ records / accounts]'],
  [/^(sold|negotiated|closed|generated|won|secured|acquired|raised|earned|exceeded|surpassed|marketed|promoted|campaigned|partnered)/, ' worth [$__]', ' — [__%] of target']
];
var BUZZ = ['team player','hard-working','hardworking','hard working','detail-oriented','detail oriented','results-driven','results driven','results-oriented','go-getter','self-starter','self starter','think outside the box','out of the box','synergy','dynamic individual','passionate about','highly motivated','self-motivated','excellent communication skills','good communication skills','proven track record','fast learner','quick learner','multitasker','multi-tasking','goal-oriented','goal oriented','strategic thinker','go-to person','rockstar','ninja','guru','wheelhouse','best of breed','value add','dedicated professional','sincere','punctual','honest and hardworking'];
var PERSONAL = [
  ['Date of birth', /\b(date of birth|d\.?\s?o\.?\s?b\.?|born on)\b/i],
  ['Age', /\bage\s*[:\-]\s*\d{2}\b/i],
  ['Marital status', /\bmarital status\b|\b(married|unmarried)\b/i],
  ['Gender', /\b(gender|sex)\s*[:\-]/i],
  ['Nationality', /\bnationality\b/i],
  ['Religion', /\breligion\b/i],
  ['Caste', /\bcaste\b/i],
  ["Parent's name", /\b(father'?s|mother'?s|husband'?s|spouse'?s)\s+name\b/i],
  ['Passport number', /\bpassport\s*(no|number|#)\b/i],
  ['Languages known (as a personal detail)', /\blanguages known\b/i]
];
var DECL = /\b(i\s+hereby\s+declare|hereby declare|declaration\s*:?|the above (information|details) (is|are) (true|correct))/i;
var REFS = /\breferences (are )?(available )?(up)?on request\b/i;
var BRIT = ['organise','organisation','optimise','optimisation','analyse','prioritise','utilise','standardise','customise','minimise','maximise','realise','specialise','recognise','colour','behaviour','centre','programme','modelling','labelled','travelled','licence','favour','honour','catalogue','cancelled','enrol','judgement','fulfil'];
var SKILLS = [
 ['Python','python'],['Java','java'],['JavaScript','javascript','js'],['TypeScript','typescript'],['C++','c++'],['C#','c#'],['Go','golang'],['Rust','rust'],
 ['Ruby','ruby'],['PHP','php'],['Scala','scala'],['Kotlin','kotlin'],['Swift','swift'],['SQL','sql'],['NoSQL','nosql'],['Bash','bash','shell scripting'],
 ['React','react','react.js','reactjs'],['Angular','angular'],['Vue','vue','vue.js'],['Next.js','next.js','nextjs'],['Node.js','node.js','nodejs'],
 ['Django','django'],['Flask','flask'],['FastAPI','fastapi'],['Spring','spring boot','spring'],['Rails','rails','ruby on rails'],['GraphQL','graphql'],
 ['REST APIs','rest api','restful','rest apis'],['HTML','html'],['CSS','css'],['iOS','ios'],['Android','android'],['React Native','react native'],['Flutter','flutter'],
 ['AWS','aws','amazon web services'],['GCP','gcp','google cloud'],['Azure','azure'],['Kubernetes','kubernetes','k8s'],['Docker','docker'],['Terraform','terraform'],
 ['Linux','linux'],['CI/CD','ci/cd','continuous integration'],['Microservices','microservices'],['Distributed systems','distributed systems'],
 ['Snowflake','snowflake'],['dbt','dbt'],['Airflow','airflow'],['Dagster','dagster'],['Spark','spark','pyspark'],['Kafka','kafka'],['Databricks','databricks'],
 ['BigQuery','bigquery'],['Redshift','redshift'],['PostgreSQL','postgres','postgresql'],['MySQL','mysql'],['MongoDB','mongodb'],['Redis','redis'],
 ['Elasticsearch','elasticsearch'],['ETL','etl','elt'],['Reverse ETL','reverse etl'],['Data modeling','data modeling','data modelling'],['Data pipelines','data pipelines','data pipeline'],
 ['Pandas','pandas'],['NumPy','numpy'],['scikit-learn','scikit-learn','sklearn'],['Tableau','tableau'],['Looker','looker'],['Power BI','power bi'],['Excel','excel'],
 ['Statistics','statistics','statistical'],['A/B testing','a/b test','a/b testing','experimentation'],['R','r programming'],
 ['Machine learning','machine learning'],['Deep learning','deep learning'],['PyTorch','pytorch'],['TensorFlow','tensorflow'],['NLP','nlp','natural language processing'],
 ['Computer vision','computer vision'],['LLMs','llm','llms','large language model'],['Generative AI','generative ai','genai'],['RAG','retrieval augmented','rag'],['MLOps','mlops'],
 ['Product strategy','product strategy'],['User research','user research'],['Figma','figma'],['Prototyping','prototyping'],['Design systems','design systems','design system'],
 ['Jira','jira'],['Agile','agile'],['Scrum','scrum'],['OKRs','okrs','okr'],['Roadmapping','roadmapping','product roadmap'],
 ['Salesforce','salesforce'],['HubSpot','hubspot'],['CRM','crm'],['SaaS','saas'],['B2B','b2b'],['Enterprise sales','enterprise sales'],['Prospecting','prospecting'],
 ['Pipeline management','pipeline management'],['Negotiation','negotiation'],['SEO','seo'],['SEM','sem','paid search'],['Google Analytics','google analytics'],
 ['Content marketing','content marketing'],['Email marketing','email marketing','lifecycle marketing'],['Marketo','marketo'],['Demand generation','demand generation','demand gen'],
 ['Go-to-market','go-to-market','gtm'],['Financial modeling','financial modeling','financial modelling'],['Forecasting','forecasting'],['Budgeting','budgeting'],
 ['FP&A','fp&a'],['GAAP','gaap'],['SOX','sox'],['NetSuite','netsuite'],['SAP','sap'],['ERP','erp'],['Supply chain','supply chain'],['Procurement','procurement'],
 ['IAM','iam','identity and access'],['SOC 2','soc 2','soc2'],['Penetration testing','penetration testing','pentest'],['SIEM','siem'],['Incident response','incident response'],
 ['Threat modeling','threat modeling'],['Cryptography','cryptography'],['Workday','workday'],['Recruiting','recruiting','talent acquisition'],['Stakeholder management','stakeholder management']
];
var SKRX = SKILLS.map(function(s){ return {name:s[0], rx:s.slice(1).map(function(t){ return new RegExp('(^|[^a-z0-9+#])' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?=$|[^a-z0-9+#])', 'i'); })}; });
function skillsIn(text){ return SKRX.filter(function(s){ return s.rx.some(function(r){ return r.test(text); }); }).map(function(s){ return s.name; }); }
var STOP = {}; ('a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why with would you your will shall may might must able across among etc per via role job jobs work working position candidate candidates company team teams within strong excellent good great ability including include includes required requires requirement requirements responsibilities responsibility preferred plus years year experience skill skills knowledge understanding familiarity proficient proficiency demonstrated proven ideal successful opportunity environment business new well also help support ensure provide deliver drive build manage develop create us we our looking seeking join you’ll you’re we’re what we’d love bonus nice have has using use used day days like make more other best based help hire hiring based remote office hybrid full time part benefits salary pay range equal employer applicants status regard race color religion sex gender identity national origin disability veteran protected law data growth product products decisions leaders findings actions field fast growing turn recommend present design analyze analyse closely partner partners across cross-functional world class mission values culture people customers users').split(/\s+/).forEach(function(w){ STOP[w] = 1; });

/* =====================================================================
   3. ANALYSIS
   ===================================================================== */
var EMAIL = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
var LINKEDIN = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+\/?/gi;
var WEB = /\b(https?:\/\/[^\s|,]+|(www\.)?github\.com\/[\w\-]+|[a-z0-9\-]+\.(dev|io|me|site|tech|design|portfolio)(\/[\w\-]*)?)\b/gi;
var PHONE = /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)[\s.\-]?)?\d[\d\s.\-]{5,14}\d/g;
var US_ST = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
var LOC = new RegExp('\\b([A-Z][a-zA-Z.]+(?:[ \\-][A-Z][a-zA-Z.]+){0,2}),\\s*(' + US_ST + '|ON|BC|QC|AB|NSW|VIC|QLD|WA|India|USA|U\\.S\\.A?\\.?|United States|Canada|UK|U\\.K\\.|United Kingdom|England|Australia|Ireland|Germany|Singapore|UAE)\\b');
var RANGE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*|\d{1,2}[\/.\-]\s*)?((?:19|20)\d{2})\s*(?:–|—|-|to|until|till)\s*(?:((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*|\d{1,2}[\/.\-]\s*)?((?:19|20)\d{2})|(present|current|now|today|date|ongoing))/gi;
var METRIC = /(?:[$£€₹]\s?\d[\d,.]*\s?(?:k|m|mm|bn|b|million|billion|lakh|crore|cr)?\b|\b\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:x|k|m|bn|million|billion|lakh|crore|hours?|hrs?|days?|weeks?|months?|minutes?|mins?|users?|customers?|clients?|people|members|engineers|accounts|records|rows|reports|dashboards|projects|stores|countries|markets|languages|apps?|models|teams?|stakeholders|tickets|transactions|leads|deals|sites|servers|pipelines)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|fifty|hundred|thousands|hundreds|dozens|millions)\b\s+(?:\w+\s+){0,2}?(?:users?|customers?|clients?|people|members|engineers|accounts|projects|teams?|countries|markets|stakeholders|reports|stores)|\b\d{2,}\b)/gi;
function stripYears(t){ return t.replace(RANGE, ' ').replace(/\b(19|20)\d{2}\b/g, ' '); }
function hasMetric(t){ METRIC.lastIndex = 0; return METRIC.test(stripYears(t)); }
var MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
function ranges(text){
  var out = [], m, now = new Date(), cy = now.getFullYear() + now.getMonth()/12;
  RANGE.lastIndex = 0;
  while((m = RANGE.exec(text))){
    var mon = function(s){ if(!s) return null; s = s.toLowerCase().trim(); var a = /^([a-z]+)/.exec(s); if(a){ var k = a[1].slice(0, a[1] === 'sept' ? 4 : 3); return MON[k] != null ? MON[k] : null; } var n = parseInt(s, 10); return n >= 1 && n <= 12 ? n-1 : null; };
    var m1 = mon(m[1]), y1 = +m[2], m2 = mon(m[3]), y2 = m[4] ? +m[4] : null;
    var a = y1 + (m1 != null ? m1/12 : 0), b = y2 != null ? y2 + (m2 != null ? m2/12 : (m1 != null ? 11/12 : 0)) : cy;
    if(y2 != null && m2 == null && m1 == null) b = y2;   // "2019 – 2021": whole years
    if(b >= a && a > cy - 50 && b <= cy + 0.1) out.push({a:a, b:b, raw:m[0], fmt: m[1] ? (/^\d/.test(m[1]) ? 'MM/YYYY' : (m[1].trim().length > 4 ? 'Month YYYY' : 'Mon YYYY')) : 'YYYY'});
  }
  return out;
}
function totalYears(rs){
  if(!rs.length) return null;
  var s = rs.map(function(r){ return [r.a, r.b]; }).sort(function(x,y){ return x[0]-y[0]; }), merged = [];
  s.forEach(function(r){ var L = merged[merged.length-1]; if(L && r[0] <= L[1]) L[1] = Math.max(L[1], r[1]); else merged.push(r.slice()); });
  var t = merged.reduce(function(n, r){ return n + (r[1]-r[0]); }, 0);
  return Math.round(t*2)/2;
}
var ROLEWORD = /\b(engineer|developer|analyst|manager|designer|scientist|consultant|specialist|associate|intern|lead|architect|administrator|coordinator|officer|executive|director|accountant|recruiter|marketer|strategist|programmer|technician|advisor|representative|assistant|head|vp|president|founder|product owner|researcher|writer|editor|teacher|nurse|tester|qa|sre|devops)\b/i;
var DEGREE = [[5, /\b(ph\.?\s?d|doctorate|doctor of)\b/i],[4, /\b(master'?s?|m\.?\s?s\.?c?\b|m\.?\s?tech|m\.?\s?e\.?\b|mba|m\.?b\.?a|m\.?\s?a\.?\b|mca|m\.?com|pgdm|post\s?graduate)\b/i],[3, /\b(bachelor'?s?|b\.?\s?s\.?c?\b|b\.?\s?tech|b\.?\s?e\.?\b|b\.?\s?a\.?\b|bca|b\.?\s?com|bba|b\.?\s?eng|undergraduate degree)\b/i],[2, /\b(associate'?s? degree|diploma)\b/i],[1, /\b(high school|secondary school|hsc|ssc|12th|10th)\b/i]];
var DEGNAME = {5:'Doctorate',4:"Master's",3:"Bachelor's",2:'Associate / Diploma',1:'High school'};

function sectionsOf(lines){
  var secs = [], cur = null;
  lines.forEach(function(L, i){
    var k = headKind(L.t) || (L.head && i > 1 ? 'other' : null);
    if(k && !L.bullet){ cur = {k:k, title:L.t, start:i, end:lines.length}; if(secs.length) secs[secs.length-1].end = i; secs.push(cur); L.isHead = k; }
  });
  return secs;
}
function linesIn(lines, secs, keys){
  var out = []; secs.forEach(function(s){ if(keys.indexOf(s.k) > -1) for(var i=s.start+1;i<s.end;i++) out.push(lines[i]); }); return out;
}
function findBullets(lines, secs){
  var scope = linesIn(lines, secs, ['experience','projects']);
  if(!scope.length) scope = lines.filter(function(L){ return !L.isHead; }).slice(3);
  var hasMarks = scope.some(function(L){ return L.bullet || BUL_RX.test(L.t); });
  var out = [], cur = null;
  scope.forEach(function(L){
    var t = L.t.trim(); if(!t || L.isHead) return;
    var marked = L.bullet || BUL_RX.test(t);
    var roleish = ranges(t).length || (t.length < 90 && ROLEWORD.test(t) && !/[.;]$/.test(t) && t.split(' ').length <= 12) || DATEISH.test(t.split('   ').pop()) && t.length < 80;
    if(marked){ cur = {t:t.replace(BUL_RX, '').trim(), line:L}; out.push(cur); return; }
    if(!hasMarks){ if(!roleish && t.split(/\s+/).length >= 7){ cur = {t:t, line:L}; out.push(cur); } else cur = null; return; }
    if(cur && !roleish && (/^[a-z(,&]/.test(t) || !/[.!?]$/.test(cur.t)) && t.split(/\s+/).length < 30) cur.t += ' ' + t;
    else cur = null;
  });
  return out.filter(function(b){ return b.t.split(/\s+/).length >= 4; });
}
function gradeBullet(b){
  var s = b.t.replace(/\s+/g,' ').trim(), low = s.toLowerCase();
  var words = s.split(' '), wc = words.length, first = (words[0]||'').toLowerCase().replace(/[^a-z]/g,'');
  var weak = null; WEAK.some(function(w){ if(low.indexOf(w[0]) === 0 || (low.indexOf(' ' + w[0] + ' ') > -1 && low.indexOf(' ' + w[0] + ' ') < 25)){ weak = w; return true; } return false; });
  var strong = !!VERBSET[first];
  var okVerb = !strong && /ed$/.test(first) && first.length > 4;
  var metric = hasMetric(s);
  var pron = /\b(i|my|me)\b/i.test(s.replace(/\bi\.e\./ig,''));
  var buzz = BUZZ.filter(function(z){ return low.indexOf(z) > -1; });
  var sc = 20, iss = [];
  if(strong){ sc += 30; iss.push(['g','Strong opening verb']); }
  else if(okVerb){ sc += 18; }
  else if(!weak){ iss.push(['a','Doesn’t open with an action verb']); }
  if(weak){ sc -= 12; iss.push(['r','Weak opener: “' + weak[0] + '”']); }
  if(metric){ sc += 35; iss.push(['g','Shows a number']); } else iss.push(['r','No result or number']);
  if(wc >= 10 && wc <= 30) sc += 15; else if(wc > 30 && wc <= 40){ sc += 5; iss.push(['a', wc + ' words — trim it']); } else if(wc > 40){ sc -= 10; iss.push(['r', wc + ' words — too long']); } else { sc -= 8; iss.push(['a','Very short — add context']); }
  if(pron){ sc -= 8; iss.push(['a','Uses “I/my”']); }
  if(buzz.length){ sc -= 6; iss.push(['a','Cliché: “' + buzz[0] + '”']); }
  sc = Math.max(0, Math.min(100, sc));
  var grade = sc >= 85 ? 'A' : sc >= 65 ? 'B' : sc >= 45 ? 'C' : 'D';
  return {t:s, score:sc, grade:grade, issues:iss, weak:weak, strong:strong, metric:metric, verb:strong ? first : null, rewrite: rewrite(s, weak, metric, strong || okVerb), wc:wc};
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function rewrite(s, weak, metric, verbOk){
  if(metric && verbOk && !weak) return null;
  var r = s.replace(/[.;]\s*$/,'');
  if(weak){
    var re = new RegExp('^(.*?)\\b' + weak[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b\\s*', 'i');
    var rest = r.replace(re, '');
    var g = /^(\w+ing)\b\s*/.exec(rest);
    if(g && GERUND[g[1].toLowerCase()]) r = GERUND[g[1].toLowerCase()] + ' ' + rest.slice(g[0].length);
    else r = weak[1] + ' ' + rest.replace(/^the\b/i, 'the');
  } else if(!verbOk){
    r = '[Action verb] ' + r.charAt(0).toLowerCase() + r.slice(1);
  }
  r = cap(r.trim());
  if(!metric){
    var v = r.split(' ')[0].toLowerCase(), add = ', [add the result: by __%, $__ or __ users]';
    FAMILY.some(function(f){ if(f[0].test(v)){ add = f[1]; return true; } return false; });
    r += add;
  }
  return r + '.';
}

function jdParts(jd){
  var lines = jd.split(/\n+/).map(function(l){ return l.trim(); }).filter(Boolean), req = [], nice = [], mode = 'req';
  lines.forEach(function(l){
    var h = l.replace(/[:：]\s*$/,'');
    if(h.length < 60 && /(preferred|nice[- ]to[- ]have|bonus|plus|desired|good to have|would be great|extra credit)/i.test(h) && !/[.]$/.test(h)){ mode = 'nice'; return; }
    if(h.length < 60 && /(requirement|qualification|must[- ]have|what you('|’)?ll (bring|need)|you have|who you are|what we('|’)?re looking for|about you|minimum|basic)/i.test(h) && !/[.]$/.test(h)){ mode = 'req'; return; }
    (mode === 'nice' ? nice : req).push(l);
  });
  return {req:req.join('\n'), nice:nice.join('\n'), title: (lines[0] || '').replace(/^(job\s*title|position|role)\s*[:\-]\s*/i,'').split(/\s[—–|]\s|\s-\s|\s\(/)[0].trim().slice(0, 90)};
}
function kwFrom(text){
  var ws = (text.toLowerCase().match(/[a-z][a-z0-9+#.\-/]{1,}/g) || []).map(function(w){ return w.replace(/^[.\-/]+|[.\-/]+$/g,''); }).filter(function(w){ return w.length >= 3; });
  var f = {};
  ws.forEach(function(w){ if(STOP[w] || /^\d/.test(w)) return; f[w] = (f[w]||0) + 1; });
  for(var i=0;i<ws.length-1;i++){ var a = ws[i], b = ws[i+1]; if(STOP[a] || STOP[b]) continue; f[a+' '+b] = (f[a+' '+b]||0) + 1.5; }
  return Object.keys(f).map(function(k){ return {k:k, n:f[k]}; }).filter(function(o){ return o.n >= (o.k.indexOf(' ') > -1 ? 2.5 : 2); })
    .sort(function(a,b){ return b.n - a.n; })
    .filter(function(o, i, arr){ if(o.k.indexOf(' ') > -1) return true; return !arr.some(function(p){ return p.k.indexOf(' ') > -1 && p.n >= o.n && p.k.split(' ').indexOf(o.k) > -1; }); })
    .slice(0, 16).map(function(o){ return o.k; });
}
function inText(term, low){
  var t = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(^|[^a-z0-9+#])' + t + '(s|es)?(?=$|[^a-z0-9+#])', 'i').test(low);
}
function jdYears(t){
  var m = /(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,70}?(?:experience|industry|professional|relevant|working|hands-on|in (?:a|an|the)\b|of)/i.exec(t) || /(?:experience)\b[^.\n]{0,30}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i.exec(t);
  var n = m ? +m[1] : null; return n && n <= 20 ? n : null;
}
var TSTOP = /\b(senior|sr|junior|jr|staff|principal|lead|head|of|and|the|ii|iii|iv|i|new|grad|associate|intern|remote|us|usa|hybrid|onsite|full|time|contract|f|m|x)\b/gi;
function tTok(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(TSTOP,' ').split(/\s+/).filter(function(w){ return w.length > 1; }); }


/* =====================================================================
   The job match: one formula for the editor (the Check tab, Optimise)
   and the team portal's Jobs list. The job's skills and the phrases it
   repeats (up to 30, read by the X-ray's shared helpers), and how many
   of them a resume shows. build.py puts this in editor.html and also
   writes site-live/match.js from the same text, so they always agree.
   ===================================================================== */
function jobTerms(t) { const s = {}; t = String(t || ''); return skillsIn(t).concat(kwFrom(t)).filter((x) => { const k = String(x).toLowerCase(); if (s[k]) return false; s[k] = 1; return true; }).slice(0, 30); }
function jobCover(text, terms) { const low = String(text || '').toLowerCase(), hit = terms.filter((k) => inText(k, low)); return { pct: terms.length ? Math.round(hit.length / terms.length * 100) : null, hit, miss: terms.filter((k) => !hit.includes(k)) }; }

window.TPMatch = {terms: jobTerms, cover: jobCover};
})();
