
const STAGES = [
  { id: 'applied',          label: '📥 הגיש קו"ח' },
  { id: 'phone',            label: '📞 ראיון טלפוני' },
  { id: 'frontal',          label: '🤝 ראיון פרונטלי' },
  { id: 'fit_client',       label: '✅ מתאים ללקוח' },
  { id: 'cv_to_client',     label: '📧 קו"ח נשלח ללקוח' },
  { id: 'client_interview', label: '🗓️ ראיון אצל הלקוח' },
  { id: 'client_approved',  label: '👍 אושר ע"י הלקוח' },
  { id: 'contract',         label: '📄 חוזה' },
  { id: 'staffed',          label: '🎯 איוש' },
  { id: 'rejected',         label: '❌ נפסל' },
];

// The recruiter's own outcome vocabulary, taken from the HBC checklist plus the
// review meeting ("א\"מ" = אין מענה). Independent of the board stage: a candidate
// can sit in any stage with any of these outcomes.
const OUTCOME_STATUSES = [
  'בברור', 'נקבע ראיון', 'קו"ח הועבר ללקוח', 'אושר ע"י הלקוח', 'גוייס/ה',
  'צ"ש גבוהות', 'נפסל ע"י לקוח', 'לא תואמ/ת פרופיל', 'נפסל איזור ג"ג',
  'הסיר/ה מועמדות', 'נשלח מכתב שלילה', 'לקוח ביטל בקשה', 'לא מחפש/ת עבודה',
  'אין מענה', 'מועמד נטש תהליך',
];

// Outcome status is the source of truth for whether an application is still
// open. Previously every screen invented its own rule, which is how a withdrawn
// candidate could simultaneously appear as "waiting for treatment" and
// "waiting for a client decision".
const HIRED_OUTCOMES = new Set(['גוייס/ה']);
const CLOSED_OUTCOMES = new Set([
  'צ"ש גבוהות', 'נפסל ע"י לקוח', 'לא תואמ/ת פרופיל', 'נפסל איזור ג"ג',
  'הסיר/ה מועמדות', 'נשלח מכתב שלילה', 'לקוח ביטל בקשה', 'לא מחפש/ת עבודה',
  'מועמד נטש תהליך',
]);
const IN_PROCESS_OUTCOMES = new Set(['נקבע ראיון', 'קו"ח הועבר ללקוח', 'אושר ע"י הלקוח']);

const EVENT_TYPES = [
  ['cv_received', 'נקלטו קו״ח'],
  ['note', 'הערה / עדכון'],
  ['call', 'שיחה'],
  ['phone_interview', 'ראיון טלפוני'],
  ['teams_interview', 'ראיון TEAMS'],
  ['frontal_interview', 'ראיון פרונטלי'],
  ['other_role', 'הצעת משרה אחרת'],
  ['task', 'משימה'],
  ['sent_to_client', 'שליחת קו"ח ללקוח'],
  ['client_interview', 'ראיון אצל לקוח'],
  ['client_decision', 'החלטת לקוח'],
  ['status', 'שינוי סטטוס'],
  ['withdrawal', 'הסרת מועמדות'],
  ['contract', 'חוזה'],
  ['placement', 'איוש'],
  ['audit', 'שינוי בכרטיס'],
  ['baseline', 'מצב קודם שתועד'],
];
const EVENT_TYPE_LABELS = Object.fromEntries(EVENT_TYPES);

// Recruiter flow from the supplied workbook. Choices record a human decision.
const FLOW_OUTCOMES = {
  phone: ['ראיון טלפוני', { stage: 'phone', outcomeStatus: 'בברור' }],
  teams: ['מתאים — נקבע ראיון TEAMS', { stage: 'phone', outcomeStatus: 'נקבע ראיון' }],
  send: ['מתאים — קו״ח יועברו ללקוח', { stage: 'fit_client', outcomeStatus: 'בברור' }],
  task: ['מתאים — יבצע משימת הדרכה', { gotTask: true, stage: 'frontal', outcomeStatus: 'בברור' }],
  approve: ['מתאים — הלקוח אישר קליטה', { stage: 'client_approved', outcomeStatus: 'אושר ע"י הלקוח', sentToClient: true, clientApproved: true }],
  contract: ['חוזה', { stage: 'contract', outcomeStatus: 'בברור' }],
  placement: ['איוש', { stage: 'staffed', outcomeStatus: 'גוייס/ה' }],
  reject: ['נפסל', { stage: 'rejected', outcomeStatus: 'לא תואמ/ת פרופיל', rejectedBy: 'us' }],
  client_reject: ['נפסל על ידי הלקוח', { stage: 'rejected', outcomeStatus: 'נפסל ע"י לקוח', rejectedBy: 'client', sentToClient: true }],
  withdraw: ['הסיר/ה מועמדות', { stage: 'rejected', outcomeStatus: 'הסיר/ה מועמדות' }],
};
const EVENT_FLOW = {
  cv_received: ['phone', 'reject'], phone_interview: ['teams', 'send', 'reject', 'withdraw'],
  teams_interview: ['send', 'task', 'reject', 'withdraw'],
  frontal_interview: ['send', 'task', 'reject', 'withdraw'],
  task: ['send', 'reject', 'withdraw'], sent_to_client: ['approve', 'client_reject', 'withdraw'],
  client_interview: ['approve', 'client_reject', 'withdraw'],
  client_decision: ['contract', 'client_reject', 'withdraw'], contract: ['placement', 'withdraw'],
};
const PHYSICAL_REQUIREMENTS_REASON = 'אי־עמידה בדרישות הפיזיות החיוניות לתפקיד';
const NEXT_EVENT = {phone:'phone_interview', teams:'teams_interview', send:'sent_to_client',
  task:'task', approve:'client_decision', contract:'contract', placement:'placement'};
const EVENT_REASONS = {
  cv_received: ['קו״ח לא רלוונטיים לדרישות התפקיד', 'אין לקוח להציע כרגע', 'ללא ניסיון נדרש', PHYSICAL_REQUIREMENTS_REASON],
  phone_interview: ['היקף משרה', 'ציפיות שכר גבוהות', 'אזור גיאוגרפי', 'אי־התאמה לפרופיל התפקיד', PHYSICAL_REQUIREMENTS_REASON],
};

// Where candidates come from — a closed list so the sources chart is meaningful.
const SOURCE_CHANNELS = [
  'JobMaster (JM)', 'דרושים', 'פייסבוק/ ווצאפ', 'לינקדאין', 'מאגר קו"ח',
  'הפניה פנימית', 'אתר החברה', 'אחר',
];

const REGIONS = ['צפון', 'חיפה', 'מרכז', 'שפלה', 'שפלה / דרום', 'דרום', 'ירושלים', 'איו"ש'];

// Client request lifecycle (was open/closed).
const JOB_STATUSES = [
  { id: 'awaiting',   label: 'ממתין לאיוש' },
  { id: 'filled',     label: 'אויש' },
  { id: 'not_filled', label: 'לא אויש' },
  { id: 'frozen',     label: 'בהקפאה' },
];

// The professional requirements matrix the client fills in per request. Each is
// marked חובה / יתרון, and drives both candidate matching and the job form.
const REQUIREMENT_FIELDS = [
  'בנייה ענפית', 'מדריך גובה', 'הכנת תוכנית בטיחות', 'הדרכה טובה', 'אש',
  'איכות הסביבה', 'כימיה', 'ארגונומיה', 'קרינה בלתי מייננת', 'עזרה ראשונה', 'חשמל',
];
const REQUIREMENT_LEVELS = ['', 'חובה', 'יתרון'];

// Common rejection reasons offered as quick presets in the candidate modal.
const REJECT_REASONS = [
  'קו״ח לא רלוונטיים לדרישות התפקיד', 'אין לקוח להציע כרגע', 'ללא ניסיון נדרש', 'היקף משרה',
  PHYSICAL_REQUIREMENTS_REASON,
  'ציפיות שכר גבוהות',
  'אזור גיאוגרפי',
  'מחפש משרה אחרת',
  'חוסר ניסיון / לא מתאים',
  'לא אושר ע"י הלקוח',
  'נפסל ע"י הלקוח בראיון',
];

const DEFAULT_SETTINGS = {
  query: 'קורות חיים, קו"ח, resume, CV, מועמדות, מועמד למשרת',
  days: 60,
  gmail: false,
  outlook: true,
  attachOnly: false,
  outlookMailbox: '',
  gmailTo: '',
  criteria: [
    { name: 'ניסיון בתחום', keywords: 'ניסיון, שנות ניסיון, experience' },
    { name: 'השכלה / הסמכות', keywords: 'תואר, הסמכה, תעודה, הנדסאי, מהנדס, B.A, B.Sc' },
    { name: 'מילות מפתח לתפקיד', keywords: '' },
    { name: 'מיקום / זמינות', keywords: 'זמין מיידית, זמינות מיידית, מגורים, אזור' },
  ],
};

let candidates = [];
let jobs = [];
let clients = [];
let settings = Object.assign({}, DEFAULT_SETTINGS);
let editingId = null;
let editingJobId = null;
let editingClientId = null;
let aiConfigured = false;

/* ---------- API + auth ---------- */
const API_BASE = window.API_BASE ?? '';

// Authentication is held in an HttpOnly cookie, never in browser storage.
localStorage.removeItem('hr_token'); localStorage.removeItem('hr_user');
let sessionUser = null;
function getUser() { return sessionUser; }
function setUser(u) { sessionUser = u; }

async function api(path, options = {}) {
  const match=path.match(/^\/api\/candidates\/(\d+)$/);
  if(match && options.method==='PATCH') {
    const body=JSON.parse(options.body||'{}');
    const current=candidates.find(c=>String(c.id)===match[1]);
    if(body.expectedVersion===undefined) body.expectedVersion=current?.version;
    if(body.expectedPersonVersion===undefined) body.expectedPersonVersion=current?.personVersion;
    options={...options,body:JSON.stringify(body)};
  }
  const res = await fetch(API_BASE + path, {
    ...options,
    credentials:'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-HBC-Request':'1',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setUser(null); showLogin();
    throw new Error('פג תוקף החיבור — יש להתחבר מחדש');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('שגיאה ' + res.status));
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  const u = getUser();
  document.getElementById('whoami').textContent = u ? '👤 ' + u.username : '';
}

async function doLogin(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.textContent = '';
  if (!username || !password) { msg.textContent = 'נא להזין שם משתמש וסיסמה'; return; }
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setUser(data.user);
    showApp();
    await loadData();
  } catch (err) {
    msg.textContent = err.message;
  }
}

function logout() {
  fetch(API_BASE+'/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'X-HBC-Request':'1'}}).catch(()=>{});
  setUser(null);
  document.getElementById('loginPass').value = '';
  showLogin();
}

function setStatus(msg, isErr) {
  const el = document.getElementById('statusLine');
  el.textContent = msg || '';
  el.className = 'status-line' + (isErr ? ' err' : '');
}

/* ---------- Data loading ---------- */
async function loadData() {
  setStatus('טוען נתונים...');
  try {
    const [cands, sett, jbs, clts] = await Promise.all([
      api('/api/candidates'), api('/api/settings'), api('/api/jobs'), api('/api/clients')
    ]);
    candidates = cands || [];
    jobs = jbs || [];
    clients = clts || [];
    settings = Object.assign({}, DEFAULT_SETTINGS, sett || {});
    initLastSeen();
    scoreAll();
    renderAll();
    renderJobs();
    renderClients();
    renderSettings();
    setStatus('');
  } catch (err) {
    setStatus('שגיאה בטעינה: ' + err.message, true);
  }
}

/* ---------- Scoring (client-side, derived from criteria + text) ---------- */
function scoreAll() {
  const crits = (settings.criteria || []).filter(c => c.keywords && c.keywords.trim());
  for (const c of candidates) {
    // Criteria used to look only at the email, so a CV imported as a file — which
    // has no subject or snippet — could never score above 0 no matter how good it
    // was. Search what the AI actually read out of the CV as well.
    const a = c.ai || {};
    const noteData = readCandidateNotes(c.notes);
    const text = [
      c.subject, c.snippet, noteData.text, c.role, c.jobTitle,
      ...noteData.events.flatMap(e => [e.description, e.result, e.jobTitle]),
      a.summary, a.profession, a.location,
      (a.strengths || []).join(' '),
      (a.matchedKeywords || []).join(' '),
      (a.certifications || []).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();
    c.matched = [];
    for (const cr of crits) {
      const kws = cr.keywords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (kws.some(k => text.includes(k))) c.matched.push(cr.name);
    }
    c.score = c.matched.length;
  }
}

/* ---------- Rendering ---------- */
function renderAll() { renderStats(); renderToday(); renderBoard(); renderList(); renderDashboard(); }

/* ---------- "היום שלי" — the morning screen ---------- */
// Answers the question she asked directly in the review: "when I open the
// system in the morning, what do I see?". Everything here comes from data
// loadData() already fetched — no extra endpoint.
const LAST_SEEN_KEY = 'hr_last_seen';
let sessionSince;   // frozen for the whole session, else the list clears itself

function initLastSeen() {
  if (sessionSince !== undefined) return;
  const v = localStorage.getItem(LAST_SEEN_KEY);
  sessionSince = v ? new Date(v) : null;
  localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}

function todaySection(title, items, renderItem, emptyText) {
  return `<div class="panel">
    <h3>${title} <span style="color:var(--muted); font-weight:400">(${items.length})</span></h3>
    ${items.length
      ? `<div style="display:flex; flex-direction:column; gap:6px">${items.map(renderItem).join('')}</div>`
      : `<div class="hint">${emptyText}</div>`}
  </div>`;
}

function candidateLine(c, extra) {
  return `<div style="display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; border-bottom:1px solid var(--border)">
    <span style="min-width:140px">${candidateNameLink(c.id, c.name)}</span>
    <span style="color:var(--muted); flex:1">${esc(c.role || c.jobTitle || '')}${c.city ? ' · ' + esc(c.city) : ''}${extra ? ' · ' + extra : ''}</span>
    <button class="btn small" data-hbc-click="50" data-arg0="${esc(String(c.id))}">פתח</button>
  </div>`;
}

function renderToday() {
  const wrap = document.getElementById('todayWrap');
  if (!wrap) return;
  const people = collapseDuplicates(candidates);
  const since = sessionSince || null;

  // The same predicates the drill-down filters use, so a card and the list it
  // opens can never disagree.
  const newOnes = people.filter(LIST_PRESETS.newSince.test);
  const waiting = people.filter(LIST_PRESETS.waiting.test);
  const withClient = people.filter(LIST_PRESETS.withClient.test);

  const openJobs = jobs.filter(j => j.status === 'awaiting');

  const sinceText = since
    ? `מאז הכניסה האחרונה (${since.toLocaleDateString('he-IL')} ${since.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})`
    : 'ביקור ראשון — מהפעם הבאה יוצג כאן מה נכנס מאז';

  wrap.innerHTML = `
    <div class="stats" style="margin-bottom:12px">
      ${kpi(newOnes.length, 'מועמדים חדשים', sinceText, drillCall('drillToCandidates', 'preset', 'newSince'))}
      ${kpi(waiting.length, 'ממתינים לטיפול', 'ללא סטטוס / בבירור / אין מענה', drillCall('drillToCandidates', 'preset', 'waiting'))}
      ${kpi(withClient.length, 'אצל הלקוח', 'הועברו וטרם התקבלה החלטה', drillCall('drillToCandidates', 'preset', 'withClient'))}
      ${kpi(openJobs.length, 'משרות ממתינות לאיוש', '', drillCall('drillToJobs', 'status', 'awaiting'))}
    </div>

    ${todaySection('🆕 נכנסו מאז הכניסה האחרונה', newOnes.slice(0, 15),
      c => candidateLine(c, displayDate(c)),
      since ? 'לא נכנסו מועמדים חדשים.' : 'ייטען מהפעם הבאה שתיכנס.')}

    ${todaySection('📞 ממתינים לטיפול', waiting.slice(0, 15),
      c => candidateLine(c, c.salaryExpectation ? 'צ"ש ' + ils(c.salaryExpectation) : ''),
      'אין מועמדים שממתינים לטיפול.')}

    ${todaySection('👤 אצל הלקוח — ממתין להחלטה', withClient.slice(0, 15),
      c => candidateLine(c, esc(c.jobTitle || '')),
      'אין מועמדים שממתינים להחלטת לקוח.')}

    ${todaySection('📋 משרות ממתינות לאיוש', openJobs, j => {
      const n = candidates.filter(c => c.jobId === j.id).length;
      return `<div style="display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; border-bottom:1px solid var(--border)">
        <b style="min-width:160px">${esc(j.title)}</b>
        <span style="color:var(--muted); flex:1">${esc(j.clientName || '')}${j.location ? ' · ' + esc(j.location) : ''} · ${n} מועמדים</span>
        <button class="btn small" data-hbc-click="51" data-arg0="${esc(String(j.id))}">🎯 התאמות</button>
      </div>`;
    }, 'אין משרות פתוחות.')}
  `;
}

function renderStats() {
  const el = document.getElementById('statsBar');
  const people = collapseDuplicates(candidates);
  const n = pred => people.filter(pred).length;
  const active = n(isCandidateActive);
  const interviews = n(c => isCandidateActive(c) && ['phone', 'frontal', 'client_interview'].includes(c.stage));
  const staffed = n(c => lifecycleState(c) === 'hired');
  el.innerHTML = [
    kpi(people.length, 'סה"כ מועמדים', '', drillCall('drillToCandidates','','')),
    kpi(active, 'בתהליך פעיל', 'בוצע לפחות שלב אחד והתהליך טרם נסגר', drillCall('drillToCandidates', 'preset', 'active')),
    kpi(interviews, 'בשלבי ראיונות', '', drillCall('drillToCandidates', 'preset', 'interviews')),
    kpi(staffed, 'אויישו', '', drillCall('drillToCandidates', 'preset', 'staffed')),
  ].join('');
}

// Full per-stage breakdown for the dashboard tab ("real-time cut").
/* ---------- Dashboard (mirrors the recruiter's own KPI sheet) ---------- */
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : 0; }

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function ils(n) { return n ? '₪' + Math.round(n).toLocaleString('he-IL') : '—'; }

// Every figure on the dashboard drills through to the records behind it —
// "35 with high salary expectations" is only useful if you can see who they are.
function kpi(value, label, hint, drill) {
  const click = drill
    ? ` role="button" tabindex="0" style="min-width:150px; cursor:pointer" data-hbc-click="52" data-arg0="${esc(String(drill))}" data-hbc-keydown="53" data-arg0="${esc(String(drill))}" title="לחץ לראות מי הם"`
    : ' style="min-width:150px"';
  return `<div class="stat"${click}>
    <div class="num">${value}</div><div class="lbl">${label}</div>
    ${hint ? `<div class="lbl" style="color:var(--muted);font-size:10px">${hint}</div>` : ''}
  </div>`;
}

// Horizontal bars — no chart library, so the page stays a single static file.
function barChart(rows, opts = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const color = opts.color || 'var(--accent)';
  if (!rows.length) return '<div class="hint">אין נתונים להצגה.</div>';
  return `<div style="display:flex; flex-direction:column; gap:6px">` + rows.map(r => {
    const click = r.drill
      ? ` data-hbc-click="54" data-arg0="${esc(String(r.drill))}" style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer" title="לחץ לראות מי הם"`
      : ' style="display:flex; align-items:center; gap:8px; font-size:12px"';
    return `<div${click}>
      <div style="width:150px; flex-shrink:0; text-align:start">${esc(r.label)}</div>
      <div style="flex:1; background:var(--accent-soft); border-radius:4px; overflow:hidden; height:18px">
        <div style="width:${(r.value / max) * 100}%; background:${color}; height:100%"></div>
      </div>
      <div style="width:52px; text-align:start; color:var(--muted)">${r.value}${opts.suffix || ''}</div>
    </div>`;
  }).join('') + '</div>';
}

/** Build an onclick that survives quotes in Hebrew values like צ"ש גבוהות. */
function drillCall(fn,key,value) {return JSON.stringify([fn,key,String(value)]);}
function runDrill(raw) {
  const [fn,key,value]=JSON.parse(raw);
  const allowed={drillToCandidates,drillToJobs};
  if(Object.hasOwn(allowed,fn))allowed[fn](key,value);
}

function renderDashboard() {
  const wrap = document.getElementById('dashWrap');
  if (!wrap) return;
  // One row per person, so a candidate imported twice isn't counted twice.
  const people = collapseDuplicates(candidates);
  const total = people.length;
  const n = pred => people.filter(pred).length;

  // ---- candidate KPIs ----
  const interviewed = n(c => c.interviewedTeams);
  const toClient = n(c => c.sentToClient);
  const approved = n(c => c.clientApproved);
  const hired = n(isHired);
  const salaries = people.map(c => Number(c.salaryExpectation)).filter(v => v > 0);
  const avgSalary = salaries.length ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;

  const candidateKpis = [
    kpi(total, 'סה"כ מועמדים', '', drillCall('drillToCandidates','','')),
    kpi(pct(interviewed, total) + '%', '% רואיינו (TEAMS)', `${interviewed} מועמדים`, drillCall('drillToCandidates', 'milestone', 'interviewedTeams')),
    kpi(pct(toClient, total) + '%', '% הועברו ללקוח', `${toClient} מועמדים`, drillCall('drillToCandidates', 'milestone', 'sentToClient')),
    kpi(pct(approved, total) + '%', '% אושרו ע"י הלקוח', `${approved} מועמדים`, drillCall('drillToCandidates', 'milestone', 'clientApproved')),
    kpi(pct(hired, total) + '%', '% גויסו', `${hired} מועמדים`, drillCall('drillToCandidates', 'milestone', 'hired')),
    kpi(ils(avgSalary), 'ממוצע ציפיות שכר', `${salaries.length} עם נתון`, drillCall('drillToCandidates', 'milestone', 'hasSalary')),
    kpi(ils(median(salaries)), 'חציון ציפיות שכר', '', drillCall('drillToCandidates', 'milestone', 'hasSalary')),
  ].join('');

  // ---- job KPIs ----
  const jn = st => jobs.filter(j => j.status === st).length;
  const awaiting = jn('awaiting'), filled = jn('filled'),
        notFilled = jn('not_filled'), frozen = jn('frozen');
  const closed = filled + notFilled;
  const fillTimes = jobs.map(j => j.fillMonths).filter(v => v != null && v > 0);
  const avgFill = fillTimes.length ? fillTimes.reduce((a, b) => a + b, 0) / fillTimes.length : 0;

  const jobKpis = [
    kpi(jobs.length, 'סה"כ בקשות גיוס', '', drillCall('drillToJobs','','')),
    kpi(awaiting, 'ממתינות לאיוש', '', drillCall('drillToJobs', 'status', 'awaiting')),
    kpi(filled, 'אוישו', '', drillCall('drillToJobs', 'status', 'filled')),
    kpi(notFilled, 'לא אוישו', '', drillCall('drillToJobs', 'status', 'not_filled')),
    kpi(avgFill ? avgFill.toFixed(2) : '—', 'ממוצע זמן גיוס (חודשים)', '', drillCall('drillToJobs', 'status', 'filled')),
    kpi(frozen, 'משרות בהקפאה', '', drillCall('drillToJobs', 'status', 'frozen')),
    kpi(pct(filled, closed) + '%', '% הצלחת איוש', 'מתוך הסגורות', drillCall('drillToJobs', 'status', 'filled')),
  ].join('');

  // ---- charts ----
  const byMonth = new Map();
  for (const c of people) {
    const d = c.contactedAt || c.date || c.addedAt;
    if (!d) continue;
    const key = String(d).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + 1);
  }
  const monthRows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ label: k, value: v, drill: drillCall('drillToCandidates', 'month', k) }));

  const funnelRows = [
    { label: 'סה"כ מועמדים', value: total, drill: drillCall('drillToCandidates','','') },
    { label: 'ראיון TEAMS', value: interviewed, drill: drillCall('drillToCandidates', 'milestone', 'interviewedTeams') },
    { label: 'קיבלו משימה', value: n(c => c.gotTask), drill: drillCall('drillToCandidates', 'milestone', 'gotTask') },
    { label: 'הועברו ללקוח', value: toClient, drill: drillCall('drillToCandidates', 'milestone', 'sentToClient') },
    { label: 'אושרו ע"י הלקוח', value: approved, drill: drillCall('drillToCandidates', 'milestone', 'clientApproved') },
    { label: 'גויסו', value: hired, drill: drillCall('drillToCandidates', 'milestone', 'hired') },
  ];

  const byStatus = new Map();
  for (const c of people) {
    const s = c.outcomeStatus || '(ללא סטטוס)';
    byStatus.set(s, (byStatus.get(s) || 0) + 1);
  }
  const statusRows = [...byStatus.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v, drill: drillCall('drillToCandidates', 'outcome', k) }));

  const bySource = new Map();
  for (const c of people) {
    const s = channelOf(c);
    bySource.set(s, (bySource.get(s) || 0) + 1);
  }
  const sourceRows = [...bySource.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v, drill: drillCall('drillToCandidates', 'channel', k) }));

  const byClient = new Map();
  for (const j of jobs) {
    const k = j.clientName || '(ללא לקוח)';
    byClient.set(k, (byClient.get(k) || 0) + 1);
  }
  const clientRows = [...byClient.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v, drill: drillCall('drillToJobs', 'client', k) }));

  const jobStatusRows = JOB_STATUSES.map(s =>
    ({ label: s.label, value: jn(s.id), drill: drillCall('drillToJobs', 'status', s.id) }));

  wrap.innerHTML = `
    <div class="panel"><h3>מועמדים</h3><div class="stats" style="margin:0">${candidateKpis}</div></div>
    <div class="panel"><h3>משרות</h3><div class="stats" style="margin:0">${jobKpis}</div></div>
    <div class="panel"><h3>משפך גיוס</h3>${barChart(funnelRows, { color: 'var(--green)' })}</div>
    <div class="panel"><h3>התפלגות סטטוס מועמדים</h3>${barChart(statusRows, { color: 'var(--amber)' })}</div>
    <div class="panel"><h3>מועמדים לאורך זמן</h3>${barChart(monthRows)}</div>
    <div class="panel"><h3>מקורות הגעה</h3>${barChart(sourceRows, { color: 'var(--purple)' })}</div>
    <div class="panel"><h3>סטטוס משרות</h3>${barChart(jobStatusRows)}</div>
    <div class="panel"><h3>בקשות גיוס לפי לקוח</h3>${barChart(clientRows, { color: 'var(--purple)' })}</div>
  `;
}

function safeExternalLink(raw) {try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function candidateNameLink(id, name) {
  return `<button type="button" class="candidate-link" data-hbc-click="55" data-arg0="${esc(String(id))}" title="פתח את כרטיס המועמד">${esc(name || 'מועמד/ת')}</button>`;
}

function lifecycleState(c) {
  const outcome = String(c?.outcomeStatus || '').trim();
  if (HIRED_OUTCOMES.has(outcome)) return 'hired';
  if (CLOSED_OUTCOMES.has(outcome)) return 'closed';
  if (c?.stage === 'staffed') return 'hired';
  if (c?.stage === 'rejected') return 'closed';
  return 'active';
}

function isCandidateOpen(c) { return lifecycleState(c) === 'active'; }

function isCandidateActive(c) {
  if (!isCandidateOpen(c)) return false;
  const progressedOnBoard = c.stage && !['applied', 'rejected', 'staffed'].includes(c.stage);
  return !!(progressedOnBoard || c.interviewedTeams || c.gotTask || c.sentToClient ||
    c.clientApproved || IN_PROCESS_OUTCOMES.has(String(c.outcomeStatus || '').trim()));
}

function effectiveBoardStage(c) {
  const state = lifecycleState(c);
  if (state === 'hired') return 'staffed';
  if (state === 'closed') return 'rejected';
  return c.stage || 'applied';
}

function reachedClient(c) {
  return !!(c.sentToClient || c.clientApproved ||
    ['cv_to_client', 'client_interview', 'client_approved', 'contract', 'staffed'].includes(c.stage));
}

function isWaitingForTreatment(c) {
  const outcome = String(c.outcomeStatus || '').trim();
  return isCandidateOpen(c) && !isCandidateActive(c) && !reachedClient(c) &&
    (!outcome || ['בברור', 'אין מענה'].includes(outcome));
}

function isWaitingForClient(c) {
  return isCandidateOpen(c) && reachedClient(c) && !c.clientApproved && c.stage !== 'client_approved';
}

function processPatchForOutcome(candidate, outcomeStatus) {
  const outcome = String(outcomeStatus || '').trim();
  const patch = { outcomeStatus: outcome };
  if (HIRED_OUTCOMES.has(outcome)) {
    Object.assign(patch, { stage: 'staffed', interviewedTeams: true, sentToClient: true, clientApproved: true });
  } else if (CLOSED_OUTCOMES.has(outcome)) {
    patch.stage = 'rejected';
    if (outcome === 'נפסל ע"י לקוח') patch.sentToClient = true;
  } else if (outcome === 'קו"ח הועבר ללקוח') {
    Object.assign(patch, { stage: 'cv_to_client', sentToClient: true });
  } else if (outcome === 'אושר ע"י הלקוח') {
    Object.assign(patch, { stage: 'client_approved', sentToClient: true, clientApproved: true });
  } else if (outcome && ['staffed', 'rejected'].includes(candidate?.stage)) {
    // Re-opening a previously closed application should make it active again.
    patch.stage = 'applied';
  }
  return patch;
}

function reconcileCandidateProcess(payload, candidate) {
  const implied = processPatchForOutcome({ ...candidate, stage: payload.stage }, payload.outcomeStatus);
  Object.assign(payload, implied);
  // A manually selected final board stage must have the same precedence as an
  // outcome status. This also handles older records that have no outcome.
  if (payload.stage === 'staffed' && !payload.outcomeStatus) payload.outcomeStatus = 'גוייס/ה';
  return payload;
}

function scoreBadge(c) {
  const max = (settings.criteria || []).filter(x => x.keywords && x.keywords.trim()).length || 1;
  const cls = c.score >= Math.ceil(max * 0.6) ? 'score-hi' : c.score > 0 ? 'score-mid' : 'score-lo';
  let aiTag = '';
  if (c.ai && c.ai.relevant !== undefined) aiTag = c.ai.relevant ? ` · AI ${c.ai.fit}/3` : ' · AI ✗';
  return `<span class="badge ${cls}">התאמה ${c.score}/${max}${aiTag}</span>`;
}

// Compact AI-extracted facts (age / location / certifications) shown on the card.
function aiFacts(c) {
  if (!c.ai) return '';
  const bits = [
    c.ai.age ? 'גיל ' + esc(c.ai.age) : '',
    c.ai.location ? '📍 ' + esc(c.ai.location) : '',
    (c.ai.certifications || []).length ? '🎓 ' + esc((c.ai.certifications || []).slice(0, 3).join(', ')) : '',
  ].filter(Boolean);
  return bits.length ? `<div class="meta" style="color:var(--text-secondary)">${bits.join(' · ')}</div>` : '';
}

function cardHTML(c) {
  const src = c.source === 'gmail' ? '<span class="badge gmail">Gmail</span>'
            : c.source === 'outlook' ? '<span class="badge outlook">Outlook</span>'
            : '<span class="badge manual">ידני</span>';
  const crits = (c.matched || []).map(m => `<span class="badge crit">${esc(m)}</span>`).join('');
  const jobBadge = c.jobNumber
    ? `<span class="badge job">#${esc(c.jobNumber)} ${esc(c.jobTitle)}</span>` : '';
  const dateStr = displayDate(c);
  const rejectNote = (lifecycleState(c) === 'closed' && (c.rejectionReason || c.rejectedBy))
    ? `<div class="snippet" style="color:var(--red)">⛔ ${esc(c.rejectionReason || '')}${c.rejectedBy ? ' · ' + (c.rejectedBy === 'client' ? 'נפסל ע"י הלקוח' : 'פסילה פנימית') : ''}</div>` : '';
  return `<div class="card" draggable="true" data-id="${c.id}">
    <div class="name">${candidateNameLink(c.id, c.name)}</div>
    <div class="meta">${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}${dateStr ? ' · ' + dateStr : ''}${!c.jobNumber && c.role ? ' · ' + esc(c.role) : ''}</div>
    <div class="badges">${src}${dupBadge(c)}${jobBadge}${scoreBadge(c)}${crits}</div>
    ${aiFacts(c)}
    ${rejectNote}
    ${c.subject ? `<div class="snippet"><b>${esc(c.subject)}</b> — ${esc(c.snippet)}</div>` : ''}
    <div class="actions">
      <button data-hbc-click="56" data-arg0="${esc(String(c.id))}">✏️ ערוך</button>
      ${c.ai ? `<button data-hbc-click="57" data-arg0="${esc(String(c.id))}">📄 ניתוח</button>`
             : `<button data-hbc-click="58" data-arg0="${esc(String(c.id))}">🤖 נתח</button>`}
      ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ מייל</a>` : ''}
      ${c.link ? `<a href="${esc(safeExternalLink(c.link))}" target="_blank" rel="noopener noreferrer" title="פתח בדפדפן">🌐</a>` : ''}
      <button class="del" data-hbc-click="59" data-arg0="${esc(String(c.id))}">מחק</button>
    </div>
  </div>`;
}

// Importing the same person from several files created a separate record per
// file, so one human can appear many times. Nothing is deleted — the views just
// show one row per person and mark how many copies exist behind it.
let mergeDuplicates = true;

// Every identity a record carries. Copies of one person rarely share all of
// them — only one copy could take the email, since that column is unique — so
// records are linked on *any* shared key, not on a single chosen one.
function dupKeys(c) {
  const scope = c.jobId ? 'job:' + c.jobId : 'role:' + String(c.role || '').trim().toLowerCase();
  // Applications to different jobs are history, not duplicates. The previous
  // name-only key merged unrelated people with the same name and also hid a
  // person's later application behind an older one.
  if (c.personId) return ['person:' + c.personId + ':' + scope];
  const keys = [];
  const email = (c.email || '').trim().toLowerCase();
  if (email) keys.push('e:' + email + ':' + scope);
  const phone = (c.phone || '').replace(/\D/g, '');
  if (phone.length >= 7) keys.push('p:' + phone + ':' + scope);
  return keys.length ? keys : ['id:' + c.id];
}

// Which copy to show: the one carrying the most work — furthest in the pipeline,
// then analyzed, then with contact details.
function copyWeight(c) {
  let w = 0;
  if (lifecycleState(c) !== 'active') w += 20;
  if (c.outcomeStatus) w += 6;
  if (c.stage && c.stage !== 'applied' && c.stage !== 'rejected') w += 8;
  if (c.ai) w += 4;
  if (c.email) w += 2;
  if (c.jobNumber) w += 1;
  return w;
}

function copyFreshness(c) {
  const raw = c.contactedAt || c.date || c.addedAt || '';
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function collapseDuplicates(list) {
  if (!mergeDuplicates) return list;
  // Group only proven identities within the same job or role; never use names.
  const parent = list.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const seen = new Map();
  list.forEach((c, i) => {
    for (const k of dupKeys(c)) {
      if (seen.has(k)) union(seen.get(k), i);
      else seen.set(k, i);
    }
  });

  const groups = new Map();
  list.forEach((c, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  });
  return [...groups.values()].map(items => {
    if (items.length === 1) return items[0];
    const best = items.reduce((a, b) => {
      const freshness = copyFreshness(b) - copyFreshness(a);
      if (Math.abs(freshness) >= 864e5) return freshness > 0 ? b : a;
      return copyWeight(b) > copyWeight(a) ? b : a;
    });
    return { ...best, dupCount: items.length };
  });
}

function dupBadge(c) {
  return c.dupCount > 1
    ? `<span class="badge" style="background:var(--amber-soft); color:var(--amber)" title="אותו מועמד הועלה ${c.dupCount} פעמים — מוצג פעם אחת">×${c.dupCount}</span>`
    : '';
}

// Candidates imported as files have no email date — fall back to when they were
// added, marked with ↥ so it's clear it's an upload date, not a mail date.
function displayDate(c) {
  if (c.date) return new Date(c.date).toLocaleDateString('he-IL');
  if (c.addedAt) return '↥ ' + new Date(c.addedAt).toLocaleDateString('he-IL');
  return '';
}
function sortDate(c) { return c.date || c.addedAt || ''; }

// Ranking shown to the user. The AI's verdict leads: the criteria score is
// derived from the email text, which imported CVs simply don't have — sorting on
// it alone buried every AI-rated 3/3 candidate at the bottom of the board.
function aiRank(c) {
  if (!c.ai) return -1;                    // not analyzed yet — below anything judged
  return c.ai.relevant ? (c.ai.fit || 1) : 0;
}
function byRelevance(a, b) {
  return (aiRank(b) - aiRank(a))
    || (b.score - a.score)
    || sortDate(b).localeCompare(sortDate(a));
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = STAGES.map(st => {
    const items = collapseDuplicates(candidates.filter(c => effectiveBoardStage(c) === st.id)).sort(byRelevance);
    return `<div class="col" data-stage="${st.id}">
      <h3>${st.label} <span class="count">${items.length}</span></h3>
      ${items.map(cardHTML).join('') || ''}
    </div>`;
  }).join('');
  attachDnD();
}

// List filters. Kept in module state so re-renders (e.g. a stage change) don't
// throw the user back to the full 400-row table.
const EMPTY_LIST_FILTERS = { q: '', source: '', analyzed: '', outcome: '', milestone: '', channel: '', month: '', preset: '' };

// Named cuts behind the header counters and the morning screen, so those
// figures open the same set they counted.
const LIST_PRESETS = {
  active:     { label: 'בתהליך פעיל — טרם נסגר', test: isCandidateActive },
  interviews: { label: 'בשלבי ראיונות',          test: c => isCandidateActive(c) && ['phone', 'frontal', 'client_interview'].includes(c.stage) },
  staffed:    { label: 'אויישו',                  test: c => lifecycleState(c) === 'hired' },
  waiting:    { label: 'ממתינים לטיפול',          test: isWaitingForTreatment },
  withClient: { label: 'אצל הלקוח — ללא החלטה',   test: isWaitingForClient },
  newSince:   { label: 'נכנסו מאז הכניסה האחרונה', test: c => sessionSince && (c.addedAt || c.date) && new Date(c.addedAt || c.date) > sessionSince },
};
let listFilters = { ...EMPTY_LIST_FILTERS };

function setListFilter(key, value) {
  listFilters[key] = value;
  renderList();
}

// Drill-down labels, so a filtered table always says why it's filtered — a
// subset with no explanation reads like missing data.
const MILESTONE_FILTERS = {
  interviewedTeams: 'רואיינו ב-TEAMS',
  gotTask: 'קיבלו משימה',
  sentToClient: 'הועברו ללקוח',
  clientApproved: 'אושרו ע"י הלקוח',
  hired: 'גויסו',
  hasSalary: 'עם ציפיות שכר',
};

/** The source bucket a candidate falls into — shared by the chart and the filter. */
function channelOf(c) {
  return c.sourceChannel || c.referral ||
    (c.source === 'outlook' ? 'Outlook' : c.source === 'gmail' ? 'Gmail' : '(לא ידוע)');
}

function monthOf(c) {
  const d = c.contactedAt || c.date || c.addedAt;
  return d ? String(d).slice(0, 7) : '';
}

function isHired(c) {
  return lifecycleState(c) === 'hired';
}

/** Jump from a figure on the dashboard to the people behind it. */
function drillToCandidates(key, value) {
  listFilters = { ...EMPTY_LIST_FILTERS };
  if (key) listFilters[key] = value;
  switchTab('list');
  renderList();
}

function drillToJobs(key, value) {
  jobFilters = { q: '', status: '', client: '' };
  if (key) jobFilters[key] = value;
  switchTab('jobs');
  renderJobs();
}

function clearListDrill() {
  Object.assign(listFilters, { outcome: '', milestone: '', channel: '', month: '', preset: '' });
  renderList();
}

function drillChip() {
  const f = listFilters;
  const label =
    f.outcome ? `סטטוס: ${f.outcome}` :
    f.milestone ? MILESTONE_FILTERS[f.milestone] || f.milestone :
    f.channel ? `מקור: ${f.channel}` :
    f.month ? `חודש: ${f.month}` :
    f.preset ? (LIST_PRESETS[f.preset] || {}).label || f.preset : '';
  if (!label) return '';
  return `<span class="badge" style="background:var(--accent-soft); color:var(--accent); cursor:pointer"
     data-hbc-click="60" title="נקה סינון">🔎 ${esc(label)} ✕</span>`;
}

function setMergeDuplicates(on) {
  mergeDuplicates = on;
  renderAll();
}

const MILESTONE_LABELS = {
  interviewedTeams: 'ראיון TEAMS',
  gotTask: 'קיבל משימה',
  sentToClient: 'הועבר ללקוח',
  clientApproved: 'אושר ע"י הלקוח',
};

// Saved straight from the table. Marking progress is the bulk of her day; making
// her open a card for each tick would be the main friction in the tool.
async function patchCandidate(id, patch, revert) {
  const before = candidates.find(c => c.id === id);
  if (before) {
    const events = automaticEventsForChanges(before, { ...before, ...patch });
    const parsed = readCandidateNotes(before.notes);
    patch.notes = composeCandidateNotes(parsed.text, [...events, ...eventsWithBaseline(before, parsed.events)]);
    patch.expectedVersion=before.version;patch.expectedPersonVersion=before.personVersion;
  }
  try {
    const updated = await api('/api/candidates/' + id, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    const i = candidates.findIndex(x => x.id === id);
    if (i >= 0) candidates[i] = updated;
    scoreAll(); renderAll(); renderJobs();
    showToast('✓ העדכון נשמר');
  } catch (err) {
    setStatus('שגיאה בשמירה: ' + err.message, true);
    if (revert) revert();
  }
}

function setMilestone(id, field, value) {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  // Open the card so each interaction can carry a conversation summary.
  openEditModal(id);
  const input = { interviewedTeams: 'mInterviewedTeams', gotTask: 'mGotTask', sentToClient: 'mSentToClient', clientApproved: 'mClientApproved' }[field];
  if (input) document.getElementById(input).checked = value;
  document.getElementById('mEventType').value = {interviewedTeams:'teams_interview', gotTask:'task', sentToClient:'sent_to_client', clientApproved:'client_decision'}[field] || 'note';
  fillEventOutcomes();
  document.getElementById('mEventDescription').focus();
  if (value && field === 'sentToClient') {
    document.getElementById('mStage').value = 'cv_to_client';
    document.getElementById('mOutcomeStatus').value = 'קו"ח הועבר ללקוח';
  }
  if (value && field === 'clientApproved') {
    document.getElementById('mStage').value = 'client_approved';
    document.getElementById('mOutcomeStatus').value = 'אושר ע"י הלקוח';
    document.getElementById('mSentToClient').checked = true;
  }
}

function setOutcome(id, value) {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  openEditModal(id);
  document.getElementById('mOutcomeStatus').value = value;
  handleOutcomeChange();
}

function matchesListFilters(c) {
  const f = listFilters;
  if (f.source && c.source !== f.source) return false;
  if (f.analyzed === 'yes' && !c.ai) return false;
  if (f.analyzed === 'no' && c.ai) return false;
  if (f.outcome) {
    const s = c.outcomeStatus || '(ללא סטטוס)';
    if (s !== f.outcome) return false;
  }
  if (f.channel && channelOf(c) !== f.channel) return false;
  if (f.month && monthOf(c) !== f.month) return false;
  if (f.preset && LIST_PRESETS[f.preset] && !LIST_PRESETS[f.preset].test(c)) return false;
  if (f.milestone) {
    if (f.milestone === 'hired') { if (!isHired(c)) return false; }
    else if (f.milestone === 'hasSalary') { if (!(Number(c.salaryExpectation) > 0)) return false; }
    else if (!c[f.milestone]) return false;
  }
  if (f.q) {
    const noteData = readCandidateNotes(c.notes);
    const hay = [c.name, c.email, c.phone, c.subject, c.role, c.jobTitle,
      noteData.text, ...noteData.events.flatMap(e => [e.description, e.result, e.jobTitle])].join(' ').toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

function renderList() {
  const wrap = document.getElementById('listWrap');
  if (!candidates.length) { wrap.innerHTML = '<div class="empty">אין מועמדים עדיין. לחץ "הוסף מועמד" כדי להתחיל.</div>'; return; }
  const opts = id => STAGES.map(s => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${s.label}</option>`).join('');
  // Collapse before filtering. Filtering first allowed an obsolete duplicate
  // to reappear in "waiting" even when the preferred copy had a final status.
  const uniqueCandidates = collapseDuplicates(candidates);
  const shown = uniqueCandidates.filter(matchesListFilters);
  const hidden = candidates.length - uniqueCandidates.length;
  const sel = (v, cur) => v === cur ? 'selected' : '';
  const filterBar = `<div class="panel" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px">
    <input type="text" id="listSearch" placeholder="🔍 חיפוש שם / מייל / טלפון / תפקיד"
           value="${esc(listFilters.q)}" style="flex:1; min-width:200px; padding:7px"
           data-hbc-input="61">
    <select style="padding:7px" data-hbc-change="62">
      <option value="" ${sel('', listFilters.source)}>כל המקורות (${candidates.length})</option>
      <option value="excel" ${sel('excel', listFilters.source)}>📊 ייבוא מהאקסל (${candidates.filter(c => c.source === 'excel').length})</option>
      <option value="manual" ${sel('manual', listFilters.source)}>ידני / ייבוא קבצים (${candidates.filter(c => c.source === 'manual').length})</option>
      <option value="outlook" ${sel('outlook', listFilters.source)}>Outlook (${candidates.filter(c => c.source === 'outlook').length})</option>
      <option value="gmail" ${sel('gmail', listFilters.source)}>Gmail (${candidates.filter(c => c.source === 'gmail').length})</option>
    </select>
    <select style="padding:7px" data-hbc-change="63">
      <option value="" ${sel('', listFilters.analyzed)}>נותחו ולא נותחו</option>
      <option value="yes" ${sel('yes', listFilters.analyzed)}>🤖 נותחו ב-AI</option>
      <option value="no" ${sel('no', listFilters.analyzed)}>ללא ניתוח</option>
    </select>
    <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer">
      <input type="checkbox" ${mergeDuplicates ? 'checked' : ''} data-hbc-change="64">
      אחד כפילויות
    </label>
    <span style="color:var(--muted); font-size:12px">מוצגים ${shown.length} מתוך ${candidates.length}${hidden ? ` · ${hidden} כפילויות אוחדו` : ''}</span>
    ${drillChip()}
  </div>`;
  // Columns follow her workbook, in her order — this is the sheet she works in
  // all day, so it should read the same here.
  const tick = (c, field) =>
    `<input type="checkbox" ${c[field] ? 'checked' : ''} title="${esc(MILESTONE_LABELS[field])}"
            data-hbc-change="65" data-arg0="${esc(String(c.id))}" data-arg1="${esc(String(field))}">`;
  const statusOpts = cur => ['', ...OUTCOME_STATUSES]
    .map(s => `<option value="${esc(s)}" ${s === (cur || '') ? 'selected' : ''}>${esc(s || '—')}</option>`).join('');

  const rows = shown
    .sort(byRelevance)
    .map(c => `<tr>
      <td style="white-space:nowrap">${displayDate(c)}</td>
      <td style="min-width:130px">${candidateNameLink(c.id, c.name)} ${dupBadge(c)}
        ${c.doNotRehire ? '<span class="badge" style="background:var(--red-soft);color:var(--red)">⛔</span>' : ''}
        ${c.email ? `<br><span style="color:var(--muted);font-size:11px">${esc(c.email)}</span>` : ''}</td>
      <td style="white-space:nowrap" dir="ltr">${esc(c.phone || '')}</td>
      <td>${esc(c.region || '')}</td>
      <td>${esc(c.city || '')}</td>
      <td>${esc(c.role || '')}</td>
      <td>${esc(c.jobTitle ? `#${c.jobNumber} ${c.jobTitle}` : '')}</td>
      <td style="white-space:nowrap">${c.salaryExpectation ? ils(c.salaryExpectation) : ''}</td>
      <td>${esc(c.jobScope || '')}</td>
      <td>${esc(c.employmentType || '')}</td>
      <td style="text-align:center">${tick(c, 'interviewedTeams')}</td>
      <td style="text-align:center">${tick(c, 'gotTask')}</td>
      <td style="text-align:center">${tick(c, 'sentToClient')}</td>
      <td style="text-align:center">${tick(c, 'clientApproved')}</td>
      <td><select style="padding:4px; font-size:12px" data-hbc-change="66" data-arg0="${esc(String(c.id))}">${statusOpts(c.outcomeStatus)}</select></td>
      <td>${esc(c.sourceChannel || c.referral || '')}</td>
      <td style="max-width:260px; font-size:11px; color:var(--muted)">${esc((c.summaryText || readCandidateNotes(c.notes).text || '').slice(0, 160))}</td>
      <td style="white-space:nowrap">
        ${c.ai ? `<button class="btn small" data-hbc-click="67" data-arg0="${esc(String(c.id))}">📄</button>` : ''}
        <button class="btn small" data-hbc-click="68" data-arg0="${esc(String(c.id))}">✏️</button></td>
    </tr>`).join('');

  const table = shown.length
    ? `<div style="overflow-x:auto"><table style="min-width:1400px"><thead><tr>
        <th>תאריך</th><th>שם מועמד</th><th>טלפון</th><th>מחוז</th><th>מגורים</th><th>תפקיד</th>
        <th>משרה / לקוח</th><th>צ"ש</th><th>היקף</th><th>העסקה</th>
        <th title="ראיון TEAMS">TEAMS</th><th title="קיבל משימה">משימה</th>
        <th title="הועבר ללקוח">ללקוח</th><th title="אושר ע\"י הלקוח">אושר</th>
        <th>סטטוס</th><th>מקור הגעה</th><th>תיאור / הערות</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty">אין מועמדים התואמים לסינון.</div>';
  wrap.innerHTML = filterBar + table;
  // Typing re-renders the table, so put the caret back where the user left it.
  const box = document.getElementById('listSearch');
  if (box && document.activeElement !== box && listFilters.q) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

/* ---------- Drag & drop ---------- */
function attachDnD() {
  document.querySelectorAll('.card[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  document.querySelectorAll('.col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('dragover');
      setStage(e.dataTransfer.getData('text/plain'), col.dataset.stage);
    });
  });
}

async function setStage(id, stage) {
  const c = candidates.find(x => x.id === id);
  if (!c || effectiveBoardStage(c) === stage) return;
  // Keep the same card/reason/summary workflow for drag-and-drop changes.
  openEditModal(id);
  document.getElementById('mStage').value = stage;
  document.getElementById('mOutcomeStatus').value = stage === 'staffed' ? 'גוייס/ה' : stage === 'rejected' ? 'לא תואמ/ת פרופיל' : 'בברור';
  toggleRejectFields();
}

async function delCand(id) {
  if (!confirm('למחוק את המועמד?')) return;
  try {
    await api('/api/candidates/' + id, { method: 'DELETE' });
    candidates = candidates.filter(c => c.id !== id);
    renderAll(); renderJobs();
  } catch (err) {
    setStatus('שגיאה במחיקה: ' + err.message, true);
  }
}

async function clearAll() {
  if (!confirm('למחוק את כל המועמדים? פעולה זו אינה הפיכה.')) return;
  try {
    await api('/api/candidates', { method: 'DELETE' });
    candidates = [];
    renderAll(); renderJobs();
  } catch (err) {
    setStatus('שגיאה: ' + err.message, true);
  }
}

/* ---------- Candidate event timeline ---------- */
// Events are stored inside the existing notes field in a private, encoded
// block. This keeps the feature compatible with the current API while the
// ordinary notes remain readable and editable as before.
const EVENTS_RE = /\n?<!--HBC_EVENTS_V1:([A-Za-z0-9+/=]+)-->/;

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readCandidateNotes(raw) {
  const events=[],seen=new Map(),warnings=[];
  const text=String(raw||'').replace(/\n?<!--HBC_EVENTS_V1:([\s\S]*?)-->/g,(whole,encoded)=>{
    try {
      const parsed=JSON.parse(base64ToUtf8(encoded));
      if(!Array.isArray(parsed)||parsed.some(e=>!e||typeof e.id!=='string'||!e.id||typeof e.type!=='string'||!e.type))throw new Error();
      if(parsed.some(e=>seen.has(e.id)&&seen.get(e.id)!==JSON.stringify(e)))throw new Error();
      for(const e of parsed)if(!seen.has(e.id)){seen.set(e.id,JSON.stringify(e));events.push(e);}
      return '';
    }catch{warnings.push('נמצא תיעוד פגום. המקור נשמר בהערות; האירועים התקינים מוצגים כרגיל.');return whole;}
  }).trim();
  if(text.includes('<!--HBC_EVENTS_V1:')&&!warnings.length)warnings.push('נמצא תיעוד לא שלם. המקור נשמר בהערות.');
  return {text,events,warnings};
}

function composeCandidateNotes(text, events) {
  const visible = String(text || '').trim();
  if (!events || !events.length) return visible;
  const encoded = utf8ToBase64(JSON.stringify(events));
  return `${visible}${visible ? '\n' : ''}<!--HBC_EVENTS_V1:${encoded}-->`;
}

function localDateIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeEventId() {
  return globalThis.crypto?.randomUUID?.() || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function jobLabelById(id) {
  const j = jobs.find(x => String(x.id) === String(id));
  return j ? `#${j.jobNumber} ${j.title}${j.clientName ? ' · ' + j.clientName : ''}` : '';
}

function makeCandidateEvent(type, description, result, candidate, extras = {}) {
  const jobId = extras.jobId !== undefined ? extras.jobId : (candidate?.jobId || '');
  const job = jobs.find(j => String(j.id) === String(jobId));
  return {
    id: makeEventId(),
    type: type || 'note',
    date: extras.date || localDateIso(),
    jobId: jobId || '',
    jobTitle: extras.jobTitle ?? (jobLabelById(jobId) || (String(jobId) === String(candidate?.jobId || '') ? candidate?.jobTitle : '') || ''),
    clientId: job?.clientId || candidate?.clientId || '',
    clientName: job?.clientName || candidate?.clientName || '',
    description: String(description || '').trim(),
    result: String(result || '').trim(),
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

function notesWithEvent(candidate, event) {
  const parsed = readCandidateNotes(candidate?.notes);
  return composeCandidateNotes(parsed.text, [event, ...eventsWithBaseline(candidate, parsed.events)]);
}

function eventsWithBaseline(candidate, events) {
  if (!candidate?.id || events.some(e => e.type === 'baseline' || e.legacy)) return [...events];
  // Preserve the known current state before the first edit. Earlier overwritten
  // states cannot be reconstructed and must never be presented as known history.
  const baseline = legacyEventForApplication(candidate);
  return baseline ? [...events, baseline] : [...events];
}

let editingEvents = [];
let editingCandidateSnapshot = null;

function samePersonApplications(candidate) {
  if (!candidate) return [];
  if (candidate.personId) return candidates.filter(c => String(c.personId) === String(candidate.personId));
  const email = String(candidate.email || '').trim().toLowerCase();
  const phone = String(candidate.phone || '').replace(/\D/g, '');
  return candidates.filter(c => c.id === candidate.id ||
    (email && String(c.email || '').trim().toLowerCase() === email) ||
    (phone.length >= 7 && String(c.phone || '').replace(/\D/g, '') === phone));
}

function legacyEventForApplication(c) {
  const parsed = readCandidateNotes(c.notes);
  const description = [c.summaryText, parsed.text, c.rejectionReason && 'סיבת פסילה: ' + c.rejectionReason].filter(Boolean).join('\n');
  const result = c.outcomeStatus || (STAGES.find(s => s.id === c.stage) || {}).label || '';
  const date = null;
  if (!date && !description && !result) return null;
  return {
    id: `baseline_${c.id}`,
    type: 'baseline', date, description, result,
    jobId: c.jobId || '', jobTitle: jobLabelById(c.jobId) || c.jobTitle || '', legacy: true,
    clientId: jobs.find(j => String(j.id) === String(c.jobId))?.clientId || c.clientId || '',
    clientName: jobs.find(j => String(j.id) === String(c.jobId))?.clientName || c.clientName || '',
    snapshot: processSnapshot(c),
    createdAt: new Date().toISOString(), _sourceAppId: c.id,
  };
}

function timelineEventsForCurrentCandidate() {
  const current = editingCandidateSnapshot;
  if (!current) return editingEvents.map(e => ({ ...e, _sourceAppId: 'new' }));
  const all = [];
  for (const app of samePersonApplications(current)) {
    const own = app.id === current.id ? editingEvents : readCandidateNotes(app.notes).events;
    if (own.length) own.forEach(e => all.push({ ...e, _sourceAppId: app.id }));
    else {
      const legacy = legacyEventForApplication(app);
      if (legacy) all.push(legacy);
    }
  }
  return all.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) ||
    (a.type === 'baseline' ? -1 : b.type === 'baseline' ? 1 : String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
}

function renderCandidateTimeline() {
  const wrap = document.getElementById('mTimeline');
  if (!wrap) return;
  const events = timelineEventsForCurrentCandidate();
  if (!events.length) {
    wrap.innerHTML = '<div class="hint">עדיין אין אירועים. האירוע הראשון ייצור את תחילת ציר הזמן.</div>';
    return;
  }
  wrap.innerHTML = events.map(e => {
    const savedIds = new Set(readCandidateNotes(editingCandidateSnapshot?.notes).events.map(x => x.id));
    const canDelete = !e.legacy && !e.automatic && !e.before && !savedIds.has(e.id) && (e._sourceAppId === editingId || e._sourceAppId === 'new');
    const job = e.jobTitle || jobLabelById(e.jobId);
    return `<div class="timeline-item">
      <div class="timeline-head">
        <b>${esc(EVENT_TYPE_LABELS[e.type] || 'אירוע')}</b>
        <span class="timeline-date">${esc(e.date || '')}</span>
        ${canDelete ? `<button type="button" class="btn small" style="margin-inline-start:auto;color:var(--red)" data-hbc-click="69" data-arg0="${esc(String(e.id))}">בטל אירוע שטרם נשמר</button>` : ''}
      </div>
      ${job ? `<div class="timeline-meta">${esc(job)}</div>` : ''}
      ${e.clientName && !job.includes(e.clientName) ? `<div class="timeline-meta">לקוח: ${esc(e.clientName)}</div>` : ''}
      ${e.description ? `<div class="timeline-text">${esc(e.description)}</div>` : ''}
      ${e.result ? `<div class="timeline-text"><b>תוצאה:</b> ${esc(e.result)}</div>` : ''}
      ${e.reason ? `<div class="timeline-text"><b>סיבה:</b> ${esc(e.reason)}</div>` : ''}
      ${e.before && e.after ? `<div class="timeline-meta">${esc(describeProcessChange(e.before, e.after))}</div>` : ''}
      ${e.notesBefore !== undefined && e.notesBefore !== e.notesAfter ? `<div class="timeline-text"><b>הערות לפני:</b> ${esc(e.notesBefore || 'ללא')}<br><b>הערות אחרי:</b> ${esc(e.notesAfter || 'ללא')}</div>` : ''}
      ${e.actor ? `<div class="timeline-meta">תועד על ידי: ${esc(e.actor)}</div>` : ''}
      ${e.legacy ? '<div class="timeline-meta">מצב שהיה קיים בעת תחילת התיעוד. מועד השינוי המקורי והמצבים שנדרסו קודם אינם ידועים.</div>' : ''}
    </div>`;
  }).join('');
}

function fillEventControls(selectedJobId) {
  document.getElementById('mEventType').innerHTML = EVENT_TYPES.filter(([id]) => !['audit', 'baseline'].includes(id))
    .map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('');
  const latest = editingEvents.filter(e => e.after && e.outcome && String(e.jobId || '') === String(selectedJobId || ''))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const stageType = {applied:'cv_received', phone:'phone_interview', frontal:'teams_interview', fit_client:'sent_to_client',
    cv_to_client:'client_decision', client_interview:'client_interview', client_approved:'client_decision', contract:'contract', staffed:'placement', rejected:'note'};
  document.getElementById('mEventType').value = (latest && NEXT_EVENT[latest.outcome]) || stageType[editingCandidateSnapshot?.stage] || 'cv_received';
  document.getElementById('mEventJob').innerHTML = '<option value="">— ללא משרה —</option>' +
    jobs.map(j => `<option value="${j.id}" ${String(j.id) === String(selectedJobId || '') ? 'selected' : ''}>#${esc(j.jobNumber)} ${esc(j.title)}${j.clientName ? ' · ' + esc(j.clientName) : ''}</option>`).join('');
  document.getElementById('mEventDate').value = localDateIso();
  document.getElementById('mEventDescription').value = '';
  document.getElementById('mEventResult').value = '';
  document.getElementById('mEventApply').checked = true;
  document.getElementById('mNextEventHint').textContent = latest && NEXT_EVENT[latest.outcome] ?
    'השלב הבא למילוי: ' + EVENT_TYPE_LABELS[NEXT_EVENT[latest.outcome]] : '';
  fillEventOutcomes();
}

function fillEventOutcomes() {
  const type = document.getElementById('mEventType').value;
  document.getElementById('mEventOutcome').innerHTML = '<option value="">— תיעוד ללא שינוי תוצאה —</option>' +
    (EVENT_FLOW[type] || []).map(id => `<option value="${id}">${esc(FLOW_OUTCOMES[id][0])}</option>`).join('');
  fillEventReasons();
}

function fillEventReasons() {
  const type = document.getElementById('mEventType').value;
  const outcome = document.getElementById('mEventOutcome').value;
  const rejected = ['reject', 'client_reject'].includes(outcome);
  document.getElementById('mEventReasonBox').style.display = rejected ? '' : 'none';
  const reasons = outcome === 'client_reject' ? ['הלקוח בחר מועמד אחר', 'אי־התאמה לדרישות הלקוח', 'לקוח ביטל בקשה', 'אחר — פירוט בסיכום'] :
    [...(EVENT_REASONS[type] || ['נמצא לא מתאים לדרישות התפקיד', PHYSICAL_REQUIREMENTS_REASON]), 'אחר — פירוט בסיכום'];
  document.getElementById('mEventReason').innerHTML = '<option value="">— בחר סיבה —</option>' + reasons.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
}

function addCandidateEvent() {
  const description = document.getElementById('mEventDescription').value.trim();
  const result = document.getElementById('mEventResult').value.trim();
  const type = document.getElementById('mEventType').value;
  const outcome = document.getElementById('mEventOutcome').value;
  const reason = ['reject', 'client_reject'].includes(outcome) ? document.getElementById('mEventReason').value : '';
  if (!description) { alert('נא למלא סיכום שיחה / פידבק / תיעוד האירוע'); return false; }
  if (['reject', 'client_reject'].includes(outcome) && !reason) { alert('נא לבחור סיבת פסילה'); return false; }
  const date = document.getElementById('mEventDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDateIso()) { alert('נא לבחור תאריך אירוע שהתקיים, עד היום'); return false; }
  const jobId = document.getElementById('mEventJob').value;
  const apply = document.getElementById('mEventApply').checked;
  if (apply && String(jobId) !== String(document.getElementById('mJob').value)) {
    alert('כדי לעדכן מצב נוכחי, בחר את המשרה שבכרטיס. אירוע למשרה אחרת ניתן לשמור כהיסטוריה בלבד.'); return false;
  }
  if (['sent_to_client', 'client_interview', 'client_decision', 'contract', 'placement'].includes(type) && !jobId) {
    alert('לאירוע מול לקוח או לאיוש יש לבחור משרה, כדי שהלקוח יישמר בהיסטוריה.'); return false;
  }
  const before = processSnapshot(modalPayload());
  if (apply) {
    const eventPatch = { ...(FLOW_OUTCOMES[outcome]?.[1] || {}) };
    if (type === 'teams_interview') eventPatch.interviewedTeams = true;
    if (type === 'sent_to_client') eventPatch.sentToClient = true;
    if (type === 'sent_to_client' && !outcome) Object.assign(eventPatch, {stage: 'cv_to_client', outcomeStatus: 'קו"ח הועבר ללקוח'});
    if (type === 'withdrawal') Object.assign(eventPatch, {stage: 'rejected', outcomeStatus: 'הסיר/ה מועמדות'});
    if (type === 'placement') Object.assign(eventPatch, {stage: 'staffed', outcomeStatus: 'גוייס/ה'});
    for (const [key, id] of Object.entries({stage: 'mStage', outcomeStatus: 'mOutcomeStatus', rejectedBy: 'mRejectedBy'})) {
      if (eventPatch[key] !== undefined) document.getElementById(id).value = eventPatch[key];
    }
    for (const [key, id] of Object.entries({interviewedTeams: 'mInterviewedTeams', sentToClient: 'mSentToClient', clientApproved: 'mClientApproved', gotTask: 'mGotTask'})) {
      if (eventPatch[key] !== undefined) document.getElementById(id).checked = eventPatch[key];
    }
    if (reason) document.getElementById('mRejectReason').value = reason;
    toggleRejectFields();
  }
  editingEvents.unshift(makeCandidateEvent(
    type, description, [FLOW_OUTCOMES[outcome]?.[0], result].filter(Boolean).join(' · '), editingCandidateSnapshot,
    { date, jobId, jobTitle: jobLabelById(jobId), reason, outcome, before: apply ? before : undefined,
      after: apply ? processSnapshot(modalPayload()) : undefined, actor: getUser()?.username || '' }
  ));
  document.getElementById('mEventDescription').value = '';
  document.getElementById('mEventResult').value = '';
  if (NEXT_EVENT[outcome]) {
    document.getElementById('mEventType').value = NEXT_EVENT[outcome];
    document.getElementById('mEventDate').value = localDateIso();
    document.getElementById('mNextEventHint').textContent = 'האירוע נוסף. השלב הבא נפתח למילוי: ' + EVENT_TYPE_LABELS[NEXT_EVENT[outcome]] + '. יש לתעד אותו לאחר שיתקיים.';
  } else {
    document.getElementById('mNextEventHint').textContent = 'האירוע נוסף להיסטוריה. לחץ „שמור“ לשמירה.';
  }
  fillEventOutcomes();
  renderCandidateTimeline();
  renderPriorRejections();
  return true;
}

function removeCandidateEvent(id) {
  if (readCandidateNotes(editingCandidateSnapshot?.notes).events.some(e => e.id === id)) return;
  editingEvents = editingEvents.filter(e => e.id !== id);
  renderCandidateTimeline();
}

/* ---------- Modal ---------- */
function fillStageSelect() {
  document.getElementById('mStage').innerHTML =
    STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
}
function fillJobSelect(selectedId) {
  const open = jobs.filter(j => j.status === 'awaiting' || j.id === selectedId);
  document.getElementById('mJob').innerHTML =
    '<option value="">— ללא משרה —</option>' +
    open.map(j => `<option value="${j.id}" ${j.id === selectedId ? 'selected' : ''}>#${esc(j.jobNumber)} ${esc(j.title)}${j.clientName ? ' · ' + esc(j.clientName) : ''}</option>`).join('');
}
function handleCandidateJobChange() {
  const id = document.getElementById('mJob').value;
  const job = jobs.find(j => String(j.id) === String(id));
  document.getElementById('mTaskHint').style.display = job && job.track !== 'multi' ? '' : 'none';
  const eventJob = document.getElementById('mEventJob');
  if (eventJob) eventJob.value = id;
  renderPriorRejections();
}

function renderPriorRejections() {
  const box = document.getElementById('mPriorRejections');
  const jobId = document.getElementById('mJob').value;
  const job = jobs.find(j => String(j.id) === String(jobId));
  const past = timelineEventsForCurrentCandidate().filter(e =>
    (jobId && String(e.jobId) === String(jobId) || job?.clientId && String(e.clientId) === String(job.clientId)) &&
    (e.reason || ['reject', 'client_reject', 'withdraw'].includes(e.outcome) || e.after?.stage === 'rejected' || e.snapshot?.stage === 'rejected'));
  box.textContent = past.length ? 'לתשומת לב: קיים תהליך קודם שנסגר מול המשרה או הלקוח הזה.\n' +
    past.map(e => `${e.date || ''} · ${e.jobTitle || e.clientName || ''} · ${e.reason || e.snapshot?.rejectionReason || e.after?.rejectionReason || e.result || ''}`).join('\n') : '';
}
function toggleRejectFields() {
  const show = document.getElementById('mStage').value === 'rejected';
  document.getElementById('mRejectBox').style.display = show ? '' : 'none';
}
function handleOutcomeChange() {
  const current = editingCandidateSnapshot || { stage: document.getElementById('mStage').value };
  const implied = processPatchForOutcome(current, document.getElementById('mOutcomeStatus').value);
  if (implied.stage) document.getElementById('mStage').value = implied.stage;
  if (implied.sentToClient) document.getElementById('mSentToClient').checked = true;
  if (implied.clientApproved) document.getElementById('mClientApproved').checked = true;
  if (implied.interviewedTeams) document.getElementById('mInterviewedTeams').checked = true;
  toggleRejectFields();
}
function fillRejectPresets() {
  document.getElementById('mRejectPreset').innerHTML =
    '<option value="">— בחר סיבה נפוצה —</option>' +
    REJECT_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
}

// Draft a thank-you / rejection letter via AI and show it for copy-paste.
async function draftLetterFor(kind) {
  if (!editingId) { alert('שמור את המועמד תחילה'); return; }
  showBusy(kind === 'thankyou' ? '✍️ מנסח מכתב תודה…' : '✍️ מנסח מכתב שלילה…');
  try {
    const { text } = await api('/api/candidates/' + editingId + '/letter', {
      method: 'POST', body: JSON.stringify({ kind }),
    });
    hideBusy();
    showLetter(kind === 'thankyou' ? 'מכתב תודה' : 'מכתב שלילה', text);
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בניסוח המכתב: ' + err.message, true);
  }
}
function showLetter(title, text) {
  document.getElementById('letterTitle').textContent = '✉️ ' + title;
  document.getElementById('letterText').value = text;
  document.getElementById('letterModal').classList.add('show');
}
function closeLetterModal() { document.getElementById('letterModal').classList.remove('show'); }
async function copyLetter() {
  await copyText(document.getElementById('letterText').value,
                 '✓ המכתב הועתק בהצלחה — הדבק באאוטלוק (Cmd+V)');
  closeLetterModal();
}
// Selects whose options come from the shared vocabularies.
function fillModalSelects() {
  const opt = (v, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v || '— לא צוין —')}</option>`;
  document.getElementById('mRegion').innerHTML = ['', ...REGIONS].map(r => opt(r)).join('');
  document.getElementById('mSourceChannel').innerHTML = ['', ...SOURCE_CHANNELS].map(r => opt(r)).join('');
  document.getElementById('mOutcomeStatus').innerHTML = ['', ...OUTCOME_STATUSES].map(r => opt(r)).join('');
}

// Fill the milestone/detail part of the modal from a candidate (or clear it).
function fillModalDetails(c) {
  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  const check = (id, val) => { document.getElementById(id).checked = !!val; };
  set('mRegion', c?.region || ''); set('mCity', c?.city || '');
  set('mSalaryExpectation', c?.salaryExpectation ?? '');
  set('mJobScope', c?.jobScope || ''); set('mEmploymentType', c?.employmentType || '');
  set('mSourceChannel', c?.sourceChannel || '');
  set('mOutcomeStatus', c?.outcomeStatus || '');
  set('mSummaryText', c?.summaryText || '');
  set('mContactedAt', c?.contactedAt || '');
  check('mInterviewedTeams', c?.interviewedTeams); check('mGotTask', c?.gotTask);
  check('mSentToClient', c?.sentToClient); check('mClientApproved', c?.clientApproved);
  // A task is only part of the multi-discipline track.
  document.getElementById('mTaskHint').style.display =
    c && c.jobTrack && c.jobTrack !== 'multi' ? '' : 'none';
}

function openAddModal() {
  editingId = null;
  editingCandidateSnapshot = null;
  editingEvents = [];
  fillStageSelect();
  fillModalSelects();
  fillModalDetails(null);
  fillJobSelect('');
  document.getElementById('modalTitle').textContent = 'הוספת מועמד';
  ['mName','mEmail','mPhone','mRole','mReferral','mNotes','mRejectReason'].forEach(i => document.getElementById(i).value = '');
  fillRejectPresets();
  document.getElementById('mStage').value = 'applied';
  document.getElementById('mRejectedBy').value = '';
  document.getElementById('mRejectPreset').value = '';
  document.getElementById('mLetterSent').checked = false;
  toggleRejectFields();
  document.getElementById('mAiBox').style.display = 'none'; // analysis available after saving
  fillEventControls('');
  renderCandidateTimeline();
  renderPriorRejections();
  document.getElementById('candModal').classList.add('show');
}
function openEditModal(id) {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  editingId = id;
  editingCandidateSnapshot = { ...c };
  const historyWarnings=readCandidateNotes(c.notes).warnings;
  if(historyWarnings.length) setStatus(historyWarnings.join(' '),true);
  const parsedNotes = readCandidateNotes(c.notes);
  editingEvents = eventsWithBaseline(c, parsedNotes.events).map(e => ({ ...e }));
  fillStageSelect();
  fillModalSelects();
  fillModalDetails(c);
  fillJobSelect(c.jobId || '');
  document.getElementById('modalTitle').textContent =
    'עריכת מועמד' + (c.doNotRehire ? '  ⛔ סומן "לא לגייס שוב"' : '');
  document.getElementById('mName').value = c.name;
  document.getElementById('mEmail').value = c.email;
  document.getElementById('mPhone').value = c.phone || '';
  document.getElementById('mRole').value = c.role || '';
  document.getElementById('mReferral').value = c.referral || '';
  document.getElementById('mStage').value = effectiveBoardStage(c);
  document.getElementById('mNotes').value = parsedNotes.text;
  fillRejectPresets();
  document.getElementById('mRejectPreset').value = '';
  document.getElementById('mRejectReason').value = c.rejectionReason || '';
  document.getElementById('mRejectedBy').value = c.rejectedBy || '';
  document.getElementById('mLetterSent').checked = !!c.rejectionLetterSent;
  toggleRejectFields();
  // Analysis section is available once a candidate exists (edit mode).
  document.getElementById('mAiBox').style.display = '';
  document.getElementById('mCvFile').value = '';
  document.getElementById('mShowAnalysis').style.display = c.ai ? '' : 'none';
  fillEventControls(c.jobId || '');
  renderCandidateTimeline();
  renderPriorRejections();
  document.getElementById('candModal').classList.add('show');
}
function closeModal() { document.getElementById('candModal').classList.remove('show'); renderAll(); }

/* ---------- AI analysis (Gemini) ---------- */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]); // strip data: prefix
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showBusy(text) {
  document.getElementById('busyText').textContent = text || 'מעבד…';
  document.getElementById('busyOverlay').classList.add('show');
}
function setBusy(text) { document.getElementById('busyText').textContent = text; }
function hideBusy() { document.getElementById('busyOverlay').classList.remove('show'); }

async function analyzeCandidate(id, file) {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  showBusy('🤖 מנתח קו"ח של ' + c.name + '…');
  try {
    const updated = await api('/api/candidates/' + id + '/analyze', {
      method: 'POST', body: JSON.stringify({ ...(file ? { file } : {}), autoMatch: false, manualClassification: true }),
    });
    const i = candidates.findIndex(x => x.id === id);
    if (i >= 0) candidates[i] = updated;
    scoreAll(); renderAll();
    hideBusy();
    openAnalysisModal(id);
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בניתוח: ' + err.message, true);
  }
}

async function analyzeFromModal() {
  if (!editingId) { alert('שמור את המועמד תחילה'); return; }
  const input = document.getElementById('mCvFile');
  let file = null;
  if (input.files && input.files[0]) {
    const f = input.files[0];
    if (f.size > 15 * 1024 * 1024) {
      alert('הקובץ גדול מדי (מעל 15MB). נסה PDF קטן יותר.');
      return;
    }
    file = { filename: f.name, mimeType: f.type, dataBase64: await fileToBase64(f) };
  }
  closeModal();
  await analyzeCandidate(editingId, file);
}

function openAnalysisModal(id) {
  const c = candidates.find(x => x.id === id);
  if (!c || !c.ai) { setStatus('אין ניתוח זמין למועמד זה.', true); return; }
  const a = c.ai;
  const list = arr => ((arr || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li style="color:var(--muted)">—</li>');
  const fitTxt = a.relevant ? `רלוונטי · רמת התאמה ${a.fit}/3` : 'לא רלוונטי למשרה';
  document.getElementById('aiModalTitle').textContent = '🤖 ניתוח קו"ח — ' + c.name;
  const facts = [
    a.age ? `גיל ${esc(a.age)}` : '',
    a.location ? `📍 ${esc(a.location)}` : '',
  ].filter(Boolean).join(' · ');
  const certs = (a.certifications || []).length
    ? `<div class="field"><b>הכשרות</b><br>${(a.certifications || []).map(k => `<span class="badge crit">${esc(k)}</span>`).join(' ')}</div>` : '';
  document.getElementById('aiModalBody').innerHTML = `
    <div class="field"><b>${esc(fitTxt)}</b>${c.jobNumber ? ` · משרה #${esc(c.jobNumber)} ${esc(c.jobTitle)}` : ' · ללא משרה משויכת'}</div>
    ${a.jobReason ? `<div class="field" style="color:var(--muted)">🎯 למה שויך לכאן: ${esc(a.jobReason)}</div>` : ''}
    ${facts ? `<div class="field" style="color:var(--muted)">${facts}</div>` : ''}
    ${certs}
    <div class="field"><b>סיכום</b><br>${esc(a.summary || '')}</div>
    <div class="field"><b>יתרונות</b><ul>${list(a.strengths)}</ul></div>
    <div class="field"><b>נקודות לבירור בראיון</b><ul>${list(a.concerns)}</ul></div>
    <div class="field"><b>שאלות לראיון הטלפוני</b><ul>${list(a.interviewQuestions)}</ul></div>
    <div class="field"><b>מילות מפתח שנמצאו</b><br>${(a.matchedKeywords || []).map(k => `<span class="badge crit">${esc(k)}</span>`).join(' ') || '<span style="color:var(--muted)">—</span>'}</div>
  `;
  document.getElementById('aiModal').classList.add('show');
}
function closeAiModal() { document.getElementById('aiModal').classList.remove('show'); }
document.getElementById('aiModal').addEventListener('click', e => { if (e.target.id === 'aiModal') closeAiModal(); });

// Analyze every candidate that hasn't been analyzed yet. We deliberately don't
// filter on hasAttachment: Outlook reports no attachment for CVs embedded inline,
// so trusting that flag silently skipped real CVs. The server reads the actual
// attachments and tells us (noFile) when there was nothing to analyze — those
// cost no AI call.
async function analyzeNew() {
  const list = candidates.filter(c => !c.ai);
  if (!list.length) { setStatus('כל המועמדים כבר נותחו.'); return; }
  if (!confirm(`לנתח ${list.length} מועמדים? מועמדים ללא קו"ח מצורף ידולגו. הפעולה כרוכה בעלות שימוש ב-API.`)) return;
  let done = 0, failed = 0, skipped = 0;
  showBusy(`🤖 מנתח 1/${list.length}…`);
  for (const c of list) {
    setBusy(`🤖 מנתח ${done + failed + skipped + 1}/${list.length}: ${c.name}`);
    try {
      const updated = await api('/api/candidates/' + c.id + '/analyze', {
        method: 'POST', body: JSON.stringify({ autoMatch: false, manualClassification: true, fileOnly: true }),
      });
      const i = candidates.findIndex(x => x.id === c.id); if (i >= 0) candidates[i] = updated;
      done++;
    } catch (err) {
      if (/אין קובץ קו"ח/.test(err.message)) skipped++; else failed++;
    }
    scoreAll(); renderAll();  // update badges live as each one finishes
  }
  hideBusy();
  setStatus(
    `ניתוח הושלם: ${done} נותחו` +
    `${skipped ? `, ${skipped} דולגו (אין קו"ח מצורף)` : ''}` +
    `${failed ? `, ${failed} נכשלו` : ''}.`,
    !!failed
  );
}

// Repair names left as filenames (or as the sending mailbox) using the name the
// AI already read out of the CV. Shows exactly what will change before touching
// anything — this rewrites existing candidate records.
async function repairNames() {
  showBusy('בודק אילו שמות ניתן לתקן…');
  let info;
  try {
    info = await api('/api/candidates/repairable-names');
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בבדיקת שמות: ' + err.message, true);
    return;
  }
  hideBusy();
  if (!info.count) { setStatus('אין שמות לתיקון — כל המועמדים כבר בשם הנכון.'); return; }

  const preview = info.samples.map(s => `  ${s.from}  →  ${s.to}`).join('\n');
  if (!confirm(
    `נמצאו ${info.count} מועמדים שהשם שלהם שונה ממה שכתוב בקורות החיים.\n\n` +
    `דוגמאות:\n${preview}\n\n` +
    `לתקן את כולם? (יעודכנו גם מייל וטלפון חסרים)`
  )) return;

  showBusy(`מתקן ${info.count} שמות…`);
  try {
    const r = await api('/api/candidates/repair-names', { method: 'POST' });
    await loadData();
    hideBusy();
    setStatus(`✓ תוקנו ${r.renamed} שמות.`);
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בתיקון השמות: ' + err.message, true);
  }
}

/* ---------- Match the pool against a job ---------- */
// The direction the recruiter actually works in: a request lands and she wants
// to know who she already has, before spending anything on an ad.
async function matchJob(jobId) {
  showBusy('🎯 מדרג מועמדים מהמאגר…');
  let data;
  try {
    data = await api('/api/jobs/' + jobId + '/match', {
      method: 'POST', body: JSON.stringify({ limit: 25 }),
    });
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בדירוג מועמדים: ' + err.message, true);
    return;
  }
  hideBusy();

  document.getElementById('matchTitle').textContent =
    `🎯 מועמדים מתאימים — #${data.job.jobNumber} ${data.job.title}` +
    (data.job.clientName ? ` · ${data.job.clientName}` : '');

  const rows = (data.results || []).map(r => {
    const cls = r.score >= 70 ? 'score-hi' : r.score >= 40 ? 'score-mid' : 'score-lo';
    return `<tr>
      <td>
        ${candidateNameLink(r.candidateId, r.name)}${r.doNotRehire ? ' <span class="badge" style="background:var(--red-soft);color:var(--red)">⛔ לא לגייס</span>' : ''}
        <div style="color:var(--muted); font-size:11px">
          ${esc(r.role || '')}${r.city ? ' · ' + esc(r.city) : ''}${r.salaryExpectation ? ' · צ"ש ' + ils(r.salaryExpectation) : ''}
        </div>
      </td>
      <td><span class="badge ${cls}">${r.score}</span></td>
      <td style="font-size:11px">
        ${r.matched.slice(0, 6).map(m => `<span class="badge crit">${esc(m)}</span>`).join(' ') || '<span style="color:var(--muted)">—</span>'}
        ${r.missing.length ? `<div style="color:var(--red); margin-top:3px">חסר: ${esc(r.missing.join(', '))}</div>` : ''}
        ${r.flags.length ? `<div style="color:var(--amber); margin-top:3px">⚠ ${esc(r.flags.join(' · '))}</div>` : ''}
      </td>
      <td><button class="btn small" data-hbc-click="70" data-arg0="${esc(String(r.candidateId))}">פתח</button></td>
    </tr>`;
  }).join('');

  document.getElementById('matchBody').innerHTML = rows
    ? `<table><thead><tr><th>מועמד</th><th>ציון</th><th>למה</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">לא נמצאו מועמדים במאגר.</div>';
  document.getElementById('matchModal').classList.add('show');
}
function closeMatchModal() { document.getElementById('matchModal').classList.remove('show'); }

/* ---------- Reading the recruiter's .xlsx in the browser ---------- */
// An .xlsx is a ZIP of XML files. The browser can inflate on its own via
// DecompressionStream, so the workbook is parsed here with no library and no
// 20MB upload — only the extracted rows are sent to the server.

/** Index the ZIP central directory: entry name -> compressed bytes + method. */
function zipIndex(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // End of central directory: scan back from the end (comment is usually empty).
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= 0 && i > buffer.byteLength - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('הקובץ אינו קובץ אקסל תקין');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const fnLen = dv.getUint16(p + 28, true);
    const exLen = dv.getUint16(p + 30, true);
    const cmLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + fnLen));
    p += 46 + fnLen + exLen + cmLen;

    // The local header repeats the name/extra lengths; the data follows it.
    const lfnLen = dv.getUint16(localOff + 26, true);
    const lexLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lfnLen + lexLen;
    out.set(name, { method, bytes: bytes.subarray(start, start + compSize) });
  }
  return out;
}

function entryStream(entry) {
  const blob = new Blob([entry.bytes]).stream();
  return entry.method === 0 ? blob : blob.pipeThrough(new DecompressionStream('deflate-raw'));
}

async function entryText(entry) {
  return entry ? await new Response(entryStream(entry)).text() : '';
}

function colNum(ref) {
  let n = 0;
  for (const ch of (ref.match(/^[A-Z]+/) || [''])[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function decodeXmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, '&');
}

const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const ROW_RE = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

function parseRowCells(rowXml, shared) {
  const cells = {};
  CELL_RE.lastIndex = 0;
  let m;
  while ((m = CELL_RE.exec(rowXml))) {
    const attrs = m[1] || '', inner = m[2] || '';
    if (!inner) continue;
    const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
    let val = '';
    if (type === 'inlineStr') {
      val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
    } else {
      const v = (inner.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) continue;
      val = type === 's' ? (shared[Number(v)] ?? '') : v;
    }
    val = decodeXmlText(String(val)).trim();
    if (val) {
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (ref) cells[colNum(ref)] = val;
    }
  }
  return cells;
}

/**
 * Reads a worksheet by streaming it.
 *
 * This workbook's sheets are padded out to Excel's million-row limit — one is
 * 255MB of XML uncompressed — so it is never held in memory or handed to a DOM
 * parser. Rows are matched off a small rolling buffer and the stream is
 * cancelled once the data clearly ran out.
 */
async function streamSheetRows(entry, shared) {
  const reader = entryStream(entry).pipeThrough(new TextDecoderStream()).getReader();
  const rows = [];
  let buf = '', emptyRun = 0, stop = false;

  while (!stop) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;

    let lastEnd = 0;
    ROW_RE.lastIndex = 0;
    let m;
    while ((m = ROW_RE.exec(buf))) {
      lastEnd = m.index + m[0].length;
      const cells = parseRowCells(m[0], shared);
      rows.push(cells);
      emptyRun = Object.keys(cells).length ? 0 : emptyRun + 1;
      // A long run of blank rows means the real data ended; the rest is padding.
      if (emptyRun > 1000 || rows.length > 50000) { stop = true; break; }
    }
    buf = buf.slice(lastEnd);
    if (buf.length > 4e6) buf = buf.slice(-2e6);   // never let the buffer grow
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return rows;
}

/** Sheet name -> array of rows, each row a {columnNumber: text} object. */
async function readWorkbook(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('הדפדפן הזה לא תומך בקריאת אקסל. השתמש ב-Chrome מעודכן.');
  }
  const zip = zipIndex(await file.arrayBuffer());

  const shared = [];
  const ssText = await entryText(zip.get('xl/sharedStrings.xml'));
  for (const si of ssText.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXmlText([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  }

  const relText = await entryText(zip.get('xl/_rels/workbook.xml.rels'));
  const relTarget = new Map();
  for (const r of relText.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (r[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (r[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target) relTarget.set(id, target);
  }

  const wbText = await entryText(zip.get('xl/workbook.xml'));
  const sheets = new Map();
  for (const sh of wbText.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXmlText((sh[0].match(/name="([^"]+)"/) || [])[1] || '');
    const rid = (sh[0].match(/r:id="([^"]+)"/) || [])[1];
    let target = relTarget.get(rid) || '';
    target = target.startsWith('/xl/') ? target.slice(1)
           : target.startsWith('xl/') ? target : 'xl/' + target;
    const entry = zip.get(target);
    if (!name || !entry) continue;
    sheets.set(name, await streamSheetRows(entry, shared));
  }
  return sheets;
}

/* ---------- Mapping the workbook onto the import payload ---------- */
const XL_EPOCH = Date.UTC(1899, 11, 30);

function xlDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    return new Date(XL_EPOCH + Number(s) * 864e5).toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);   // "03/2026" — month only
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}-01`;
  return '';
}

function xlNum(v) {
  if (!v) return null;
  const s = String(v).replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return null;
  return n < 100 ? n * 1000 : n;   // "18" means 18K
}

const JOB_STATUS_FROM_XL = { 'אויש': 'filled', 'לא אויש': 'not_filled', 'ממתין לאיוש': 'awaiting' };
const XL_CERT_COLS = {
  25: 'בנייה ענפית', 26: 'מדריך גובה', 27: 'הכנת תוכנית בטיחות', 28: 'הדרכה טובה',
  29: 'אש', 30: 'איכות הסביבה', 31: 'כימיה', 32: 'ארגונומיה',
  33: 'קרינה בלתי מייננת', 34: 'עזרה ראשונה', 35: 'חשמל',
};

/**
 * Find a sheet by name, falling back to its header row.
 * Sheet names are whatever the recruiter last called a tab, so matching on the
 * headers she actually types is the more durable signal.
 */
function findSheet(sheets, nameRe, headerTerms) {
  for (const [name, rows] of sheets) if (nameRe.test(name)) return rows;
  for (const [, rows] of sheets) {
    for (const row of rows.slice(0, 5)) {
      const text = Object.values(row).join(' ');
      if (headerTerms.every(t => text.includes(t))) return rows;
    }
  }
  return [];
}

// Candidates come out of the workbook with no CV attached — her sheet is the
// record of the intro call, not a CV library. Everything downstream (board,
// list, dashboard, matching) has to work from these fields alone.
function workbookToImport(sheets) {
  const candidateRows = findSheet(sheets, /מועמדים/, ['שם מועמד']);
  const jobRows = findSheet(sheets, /משרות/, ['שם תפקיד', 'תאריך בקשה']);
  const frozenRows = findSheet(sheets, /בהקפאה/, ['שם תפקיד', 'רייט']);

  const candidates = [];
  candidateRows.forEach((r, idx) => {
    if (idx === 0) return;                       // header
    const name = (r[3] || '').trim();
    if (!name || name === '0') return;
    const noAnswer = ['א"מ', 'אמ'].includes(r[4] || '');
    const desc = r[17] || '', status = r[18] || '';
    candidates.push({
      name,
      phone: noAnswer ? '' : (r[4] || ''),
      region: r[5] || '', city: r[6] || '', role: r[7] || '', clientName: r[8] || '',
      jobScope: r[10] || '', salaryExpectation: xlNum(r[11]),
      employmentType: r[12] ? 'חשבונית' : '',
      interviewedTeams: !!r[13] && r[13] !== '0',
      gotTask: !!r[14] && r[14] !== '0',
      sentToClient: !!r[15] && r[15] !== '0',
      clientApproved: !!r[16] && r[16] !== '0',
      outcomeStatus: status || desc,
      rejectionReason: desc && desc !== status ? desc : '',
      sourceChannel: r[19] || '', summaryText: r[20] || '',
      contactedAt: xlDate(r[2]), noAnswer,
      // Position is the only stable identity the workbook offers.
      importKey: 'cand#' + idx,
    });
  });

  const jobs = [];
  jobRows.forEach((r, idx) => {
    const status = JOB_STATUS_FROM_XL[(r[1] || '').trim()];
    if (!status) return;   // rows carrying a recruiter name aren't requests
    const requirements = {};
    for (const [col, label] of Object.entries(XL_CERT_COLS)) if (r[col]) requirements[label] = r[col];
    jobs.push({
      status, statusReason: r[2] || '', candidateInProcess: r[3] || '',
      filledDate: xlDate(r[5]), requestDate: xlDate(r[6]),
      clientName: r[7] || '', contact: r[8] || '', startDate: r[9] || '',
      period: r[10] || '', rate: r[11] || '', title: r[12] || 'משרה ללא כותרת',
      description: r[13] || '', salaryRange: r[14] || '',
      includesCar: { 'כן': true, 'לא': false }[r[15]],
      travelBetweenSites: { 'כן': true, 'לא': false }[r[16]],
      keywords: r[17] || '', location: r[18] || '', workHours: r[19] || '',
      jobScope: r[20] || '', shifts: r[21] || '', employmentPeriod: r[22] || '',
      equipment: r[23] || '', yearsExperience: r[24] || '', requirements,
      language: r[37] || '', reportsTo: r[38] || '',
      securityClearance: r[39] || '', extraNotes: r[40] || '',
      importKey: 'job#' + idx,
    });
  });
  frozenRows.forEach((r, idx) => {
    if (idx === 0) return;
    if (!r[7] && !r[4]) return;
    jobs.push({
      status: 'frozen', statusReason: r[1] || 'בהקפאה / לא אושר',
      requestDate: xlDate(r[3]), clientName: r[4] || '', description: r[5] || '',
      contact: r[6] || '', title: r[7] || 'משרה ללא כותרת', rate: r[8] || '',
      salaryRange: r[9] || '', keywords: r[10] || '', location: r[11] || '',
      workHours: r[12] || '', jobScope: r[13] || '', requirements: {},
      importKey: 'frozen#' + idx,
    });
  });
  return {
    candidates, jobs,
    // What the reader actually saw, so a failed import can explain itself
    // instead of just reporting "nothing found".
    diagnostics: {
      sheets: [...sheets.entries()].map(([name, rows]) => ({ name, rows: rows.length })),
      candidateRows: candidateRows.length,
      jobRows: jobRows.length,
      frozenRows: frozenRows.length,
    },
  };
}

/* ---------- One-time import of the recruiter's workbook ---------- */
async function importWorkbook(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  let payload;
  const isExcel = /\.xlsx$/i.test(file.name);
  try {
    if (isExcel) {
      showBusy('📖 קורא את קובץ האקסל…');
      payload = workbookToImport(await readWorkbook(file));
      hideBusy();
    } else {
      payload = JSON.parse(await file.text());
    }
  } catch (err) {
    hideBusy();
    setStatus(`שגיאה בקריאת הקובץ: ${err.message}`, true);
    return;
  }

  const nc = (payload.candidates || []).length, nj = (payload.jobs || []).length;
  const d = payload.diagnostics;

  if (!nc && !nj) {
    // Say what was read, so the failure points at its own cause.
    const seen = d
      ? '\n\nגיליונות שנמצאו בקובץ:\n' + d.sheets.map(s => `  • ${s.name} — ${s.rows} שורות`).join('\n') +
        `\n\nשורות מועמדים שזוהו: ${d.candidateRows}\nשורות משרות שזוהו: ${d.jobRows}`
      : '';
    alert('לא זוהו מועמדים או משרות בקובץ.' + seen +
      '\n\nצפוי גיליון מועמדים עם עמודת "שם מועמד", וגיליון משרות עם "שם תפקיד" ו-"תאריך בקשה".');
    setStatus('הייבוא לא מצא נתונים — ראה את פירוט הגיליונות.', true);
    return;
  }

  showBusy('בודק את השורות לפני הייבוא…');
  try {
    const preview=await api('/api/import',{method:'POST',body:JSON.stringify({...payload,dryRun:true})});
    hideBusy();
    downloadJson('import-preview.json',preview);
    if(preview.issues.length) {
      alert('הייבוא נעצר ללא שינוי נתונים. נמצאו התאמות לא חד-משמעיות:\n'+preview.issues.slice(0,20).map(i=>`שורה ${i.row}: ${i.reason}`).join('\n')+'\nהדוח המלא הורד למחשב.');return;
    }
    if(!confirm(`נבדקו ${nc} שורות מועמדים ו-${nj} בקשות.\nייווצרו ${preview.candidatesCreated} הגשות ו-${preview.jobsCreated} משרות.\n${preview.candidatesSkipped} הגשות ו-${preview.jobsSkipped} משרות כבר קיימות או זוהו בוודאות.\nדוח ההתאמות הורד למחשב. השיוך למשרה יישאר ידני.\nלבצע את הייבוא?`))return;
    showBusy('מייבא את הנתונים שנבדקו…');
    const r=await api('/api/import',{method:'POST',body:JSON.stringify({...payload,dryRun:false,previewToken:preview.previewToken})});
    await loadData();
    hideBusy();
    setStatus(`✓ יובאו ${r.candidatesCreated} מועמדים ו-${r.jobsCreated} משרות ` +
      `(דולגו: ${r.candidatesSkipped} מועמדים, ${r.jobsSkipped} משרות).`);
  } catch (err) {
    hideBusy();
    setStatus('שגיאה בייבוא: ' + err.message, true);
  }
}

/* ---------- Bulk import (many CV files at once) ---------- */
function openBulkImportModal() {
  const open = jobs.filter(j => j.status === 'awaiting');
  document.getElementById('bulkJob').innerHTML =
    '<option value="" selected>— ללא משרה — שיוך ידני בהמשך</option>' +
    open.map(j => `<option value="${j.id}">#${esc(j.jobNumber)} ${esc(j.title)}${j.clientName ? ' · ' + esc(j.clientName) : ''}</option>`).join('');
  document.getElementById('bulkNoJobsHint').style.display = open.length ? 'none' : '';
  document.getElementById('bulkFiles').value = '';
  document.getElementById('bulkProgress').innerHTML = '';
  document.getElementById('bulkModal').classList.add('show');
}
function closeBulkModal() { document.getElementById('bulkModal').classList.remove('show'); }

// WhatsApp/phone exports name files like "IMG-20250203-WA0007.pdf" — strip that noise
// so the placeholder (pre-AI-analysis) name is at least readable in the board.
function cleanFileName(fn) {
  const base = fn.replace(/\.[^.]+$/, '');
  const stripped = base.replace(/^(IMG|VID|DOC|PTT|WA)[-_ ]?\d*/i, '').replace(/[_-]+/g, ' ').trim();
  return stripped || ('קובץ: ' + fn);
}

// Create the placeholder application (no email/phone yet, so dedup never fires here).
// If it somehow 409s anyway, attach the application to the existing person instead of blocking.
async function bulkCreateCandidate(name, jobId) {
  const post = body => fetch(API_BASE + '/api/candidates', {
    method: 'POST',
    credentials:'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-HBC-Request':'1' },
    body: JSON.stringify(body),
  });
  let res = await post({ name, jobId, stage: 'applied' });
  if (res.status === 409) {
    const body = await res.json();
    const personId = body.duplicate?.person?.id;
    if (!personId) throw new Error(body.error || 'מועמד קיים');
    res = await post({ name, jobId, stage: 'applied', personId, expectedPersonVersion:body.duplicate.person.version });
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'שגיאה ביצירת מועמד');
  return res.json();
}

async function startBulkImport() {
  const jobChoice = document.getElementById('bulkJob').value;
  const autoMatch = false;
  const jobId = jobChoice || null;
  const files = Array.from(document.getElementById('bulkFiles').files || []);
  if (!files.length) { alert('נא לבחור קבצים'); return; }
  const target = jobId ? 'מול המשרה שנבחרה ידנית' : 'ללא שיוך למשרה';
  if (!confirm(`לייבא ולנתח ${files.length} קבצים ${target}? הפעולה כרוכה בעלות שימוש ב-API ועשויה לקחת כמה דקות.`)) return;

  document.getElementById('bulkStartBtn').disabled = true;
  const progress = document.getElementById('bulkProgress');
  progress.innerHTML = files.map((f, i) => `<div id="bulkRow${i}">⏳ ${esc(f.name)}</div>`).join('');
  let ok = 0, fail = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const row = document.getElementById('bulkRow' + i);
    row.textContent = `🔄 מעבד (${i + 1}/${files.length}): ${f.name}`;
    let createdId = null;
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error('קובץ גדול מדי (מעל 15MB)');
      const created = await bulkCreateCandidate(cleanFileName(f.name), jobId);
      createdId = created.id;
      const dataBase64 = await fileToBase64(f);
      const analyzed = await api('/api/candidates/' + created.id + '/analyze', {
        method: 'POST',
        body: JSON.stringify({ file: { filename: f.name, mimeType: f.type, dataBase64 }, autoMatch: false, manualClassification: true }),
      });

      // The AI read the actual name/email/phone off the CV — use it to replace
      // the filename-derived placeholder, best-effort (a 409 here just means the
      // email already belongs to someone else; keep the analysis, skip the rename).
      const a = analyzed.ai || {};
      const patch = {expectedVersion:analyzed.version,expectedPersonVersion:analyzed.personVersion};
      if (a.candidateName) patch.name = a.candidateName;
      if (a.candidateEmail) patch.email = a.candidateEmail;
      if (a.candidatePhone) patch.phone = a.candidatePhone;
      let finalRow = analyzed;
      if (Object.keys(patch).length) {
        try {
          finalRow = await api('/api/candidates/' + created.id, { method: 'PATCH', body: JSON.stringify(patch) });
        } catch { /* keep placeholder name/contact, analysis is still saved */ }
      }

      const i2 = candidates.findIndex(x => x.id === finalRow.id);
      if (i2 >= 0) candidates[i2] = finalRow; else candidates.push(finalRow);

      const fitTxt = finalRow.ai ? (finalRow.ai.relevant ? `✅ מתאים (${finalRow.ai.fit}/3)` : '⚠️ לא רלוונטי') : '';
      const jobTxt = finalRow.jobTitle
        ? ` · 🎯 ${finalRow.jobTitle}`
        : (finalRow.role ? ` · 🏷 ${finalRow.role}` : (autoMatch ? ' · ❔ לא שויך למשרה' : ''));
      row.textContent = `✔ ${finalRow.name} — ${fitTxt}${jobTxt}`;
      ok++;
    } catch (err) {
      // Roll back the row we just created: without analysis it holds nothing but
      // a filename, has no contact details for dedup to match on, and would come
      // back as a duplicate the moment these files are imported again.
      if (createdId) {
        try {
          await api('/api/candidates/' + createdId, { method: 'DELETE' });
          candidates = candidates.filter(x => x.id !== createdId);
        } catch { /* leave it; the error below is what matters to the user */ }
      }
      row.textContent = `✖ ${f.name}: ${err.message}`;
      fail++;
    }
    scoreAll(); renderAll();
  }

  document.getElementById('bulkStartBtn').disabled = false;
  setStatus(`ייבוא הושלם: ${ok} הצליחו${fail ? `, ${fail} נכשלו` : ''}.`, !!fail);
}

function modalPayload() {
  const v = id => document.getElementById(id).value.trim();
  const chk = id => document.getElementById(id).checked;
  const stage = document.getElementById('mStage').value;
  return {
    name: v('mName'), email: v('mEmail'), phone: v('mPhone'),
    role: v('mRole'), referral: v('mReferral'),
    region: v('mRegion'), city: v('mCity'),
    salaryExpectation: v('mSalaryExpectation'),
    jobScope: v('mJobScope'), employmentType: v('mEmploymentType'),
    sourceChannel: v('mSourceChannel'),
    interviewedTeams: chk('mInterviewedTeams'), gotTask: chk('mGotTask'),
    sentToClient: chk('mSentToClient'), clientApproved: chk('mClientApproved'),
    outcomeStatus: v('mOutcomeStatus'),
    summaryText: document.getElementById('mSummaryText').value,
    contactedAt: v('mContactedAt'),
    jobId: document.getElementById('mJob').value || null,
    stage, notes: composeCandidateNotes(document.getElementById('mNotes').value, editingEvents),
    rejectionReason: stage === 'rejected' ? v('mRejectReason') : '',
    rejectedBy: stage === 'rejected' ? document.getElementById('mRejectedBy').value : '',
    rejectionLetterSent: stage === 'rejected' ? document.getElementById('mLetterSent').checked : false,
  };
}

function automaticEventsForChanges(before, payload) {
  const prior = processSnapshot(before || {});
  const next = processSnapshot(payload);
  const description = before ? describeProcessChange(prior, next) : 'מועמד/ת נוסף/ה למערכת';
  if (before && !description) return [];
  return [makeCandidateEvent(payload.outcomeStatus === 'הסיר/ה מועמדות' ? 'withdrawal' : 'audit',
    description, payload.outcomeStatus || '', payload,
    { automatic: true, before: prior, after: next, actor: getUser()?.username || '' })];
}

function processSnapshot(c) {
  const keys = ['jobId', 'stage', 'outcomeStatus', 'rejectionReason', 'rejectedBy', 'summaryText',
    'interviewedTeams', 'gotTask', 'sentToClient', 'clientApproved', 'rejectionLetterSent', 'role', 'contactedAt'];
  const job = jobs.find(j => String(j.id) === String(c.jobId));
  return { ...Object.fromEntries(keys.map(k => [k, c[k] ?? (['interviewedTeams', 'gotTask', 'sentToClient', 'clientApproved', 'rejectionLetterSent'].includes(k) ? false : '')])),
    jobTitle: jobLabelById(c.jobId) || c.jobTitle || '', clientId: job?.clientId || c.clientId || '', clientName: job?.clientName || c.clientName || '' };
}

function describeProcessChange(before, after) {
  const labels = {jobId:'משרה', stage:'שלב', outcomeStatus:'סטטוס', rejectionReason:'סיבת פסילה', rejectedBy:'נפסל על ידי',
    summaryText:'סיכום שיחה', interviewedTeams:'ראיון TEAMS', gotTask:'משימה', sentToClient:'הועבר ללקוח', clientApproved:'אישור לקוח',
    rejectionLetterSent:'מכתב שלילה', role:'סיווג מקצועי', contactedAt:'תאריך שיחה'};
  const display = (k, v) => typeof v === 'boolean' ? (v ? 'כן' : 'לא') :
    k === 'stage' ? STAGES.find(s => s.id === v)?.label || v || 'ללא' :
    k === 'jobId' ? jobLabelById(v) || v || 'ללא משרה' : k === 'rejectedBy' ? ({us:'אנחנו',client:'הלקוח'}[v] || 'ללא') : v || 'ללא';
  return Object.keys(labels).filter(k => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(k => `${labels[k]} — קודם: ${k === 'jobId' ? before.jobTitle || display(k, before[k]) : display(k, before[k])}; כעת: ${k === 'jobId' ? after.jobTitle || display(k, after[k]) : display(k, after[k])}`).join('\n');
}

async function saveModal() {
  const button = document.getElementById('saveCandidateBtn');
  if (button.disabled) return;
  if (document.getElementById('mEventDescription').value.trim() || document.getElementById('mEventResult').value.trim() || document.getElementById('mEventOutcome').value) {
    if (!addCandidateEvent()) return;
  }
  const payload = reconcileCandidateProcess(modalPayload(), editingCandidateSnapshot);
  if (!payload.name) { alert('נא להזין שם'); return; }
  if (payload.stage === 'rejected' && payload.outcomeStatus !== 'הסיר/ה מועמדות' && !payload.rejectionReason) {
    alert('נא למלא סיבת פסילה כדי שתישמר בהיסטוריה'); return;
  }
  const autoEvents = automaticEventsForChanges(editingCandidateSnapshot, payload);
  payload.notes = composeCandidateNotes(document.getElementById('mNotes').value, [...autoEvents, ...editingEvents]);
  if (editingId) {payload.expectedVersion=editingCandidateSnapshot?.version;payload.expectedPersonVersion=editingCandidateSnapshot?.personVersion;}
  button.disabled = true;
  try {
    if (editingId) {
      const updated = await api('/api/candidates/' + editingId, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
      const i = candidates.findIndex(x => x.id === editingId);
      if (i >= 0) candidates[i] = updated;
    } else {
      if (!payload.name) { alert('נא להזין שם'); return; }
      let created = await createCandidateWithDedup(payload);
      if (!created) return; // user cancelled the duplicate prompt
      candidates.push(created);
    }
    scoreAll();
    closeModal();
    renderAll();
    renderJobs();
    showToast('✓ כרטיס המועמד נשמר');
  } catch (err) {
    setStatus('שגיאה בשמירה: ' + err.message, true);
    alert('השמירה לא הושלמה: ' + err.message);
  } finally {
    button.disabled = false;
  }
}

// POST a candidate; on a 409 duplicate, offer to attach a new application to the
// existing person instead of creating a duplicate.
async function createCandidateWithDedup(payload) {
  const res = await fetch(API_BASE + '/api/candidates', {
    method: 'POST',
    credentials:'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-HBC-Request':'1' },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    setUser(null); showLogin();
    throw new Error('פג תוקף החיבור — יש להתחבר מחדש');
  }
  if (res.status === 409) {
    const body = await res.json();
    const dup = body.duplicate;
    if (!dup) throw new Error(body.error || 'מועמד קיים');
    const existingJobs = (dup.applications || [])
      .map(a => a.jobNumber ? `#${a.jobNumber} ${a.jobTitle}` : (a.role || a.stage)).filter(Boolean).join(', ');
    const ok = confirm(
      `מועמד קיים: ${dup.person.name}` +
      (dup.person.email ? ` (${dup.person.email})` : '') +
      (existingJobs ? `\nהגשות קיימות: ${existingJobs}` : '') +
      `\n\nלהוסיף הגשה חדשה לאותו מועמד?`
    );
    if (!ok) return null;
    return await api('/api/candidates', {
      method: 'POST',
      body: JSON.stringify({ ...payload, personId: dup.person.id, expectedPersonVersion:dup.person.version }),
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('שגיאה ' + res.status));
  }
  return res.json();
}

document.getElementById('candModal').addEventListener('click', e => {
  if (e.target.id === 'candModal') closeModal();
});

/* ---------- Settings ---------- */
function addCritRow(name, kw) {
  const div = document.createElement('div');
  div.className = 'crit-row';
  div.innerHTML = `<input type="text" placeholder="שם הקריטריון" value="${esc(name)}">
    <input type="text" placeholder="מילות מפתח, מופרדות בפסיק" value="${esc(kw)}">
    <button class="btn small" data-hbc-click="71">✕</button>`;
  document.getElementById('critList').appendChild(div);
}
function renderSettings() {
  document.getElementById('setQuery').value = settings.query;
  document.getElementById('setDays').value = settings.days;
  document.getElementById('setGmail').checked = settings.gmail;
  document.getElementById('setOutlook').checked = settings.outlook;
  document.getElementById('setAttach').checked = settings.attachOnly;
  document.getElementById('setOutlookMailbox').value = settings.outlookMailbox || '';
  document.getElementById('setGmailTo').value = settings.gmailTo || '';
  document.getElementById('critList').innerHTML = '';
  (settings.criteria || []).forEach(c => addCritRow(c.name, c.keywords));
}
async function saveSettings() {
  const newSettings = {
    query: document.getElementById('setQuery').value.trim() || DEFAULT_SETTINGS.query,
    days: parseInt(document.getElementById('setDays').value) || 60,
    gmail: document.getElementById('setGmail').checked,
    outlook: document.getElementById('setOutlook').checked,
    attachOnly: document.getElementById('setAttach').checked,
    outlookMailbox: document.getElementById('setOutlookMailbox').value.trim(),
    gmailTo: document.getElementById('setGmailTo').value.trim(),
    criteria: [...document.querySelectorAll('.crit-row')].map(r => {
      const ins = r.querySelectorAll('input');
      return { name: ins[0].value.trim(), keywords: ins[1].value.trim() };
    }).filter(c => c.name),
  };
  try {
    const saved = await api('/api/settings', { method: 'PUT', body: JSON.stringify(newSettings) });
    settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    scoreAll();
    renderAll();
    const m = document.getElementById('saveMsg');
    m.textContent = '✓ נשמר';
    setTimeout(() => m.textContent = '', 2000);
  } catch (err) {
    setStatus('שגיאה בשמירת הגדרות: ' + err.message, true);
  }
}

/* ---------- Email connections & scanning ---------- */
const PROVIDER_LABELS = { google: 'Gmail', microsoft: 'Outlook' };

async function loadConnections() {
  const wrap = document.getElementById('connList');
  if (!wrap) return;
  try {
    const data = await api('/api/connections');
    aiConfigured = !!data.aiConfigured;
    const batchBtn = document.getElementById('btnBatchAI');
    if (batchBtn) {
      batchBtn.disabled = !aiConfigured;
      batchBtn.title = aiConfigured ? 'נתח קו"ח של מועמדים חדשים עם קובץ מצורף' : 'AI לא הוגדר בשרת (חסר GEMINI_API_KEY)';
    }
    const connected = {};
    (data.connections || []).forEach(c => { connected[c.provider] = c; });
    const available = data.available || {};
    const rows = Object.keys(PROVIDER_LABELS)
      .filter(p => available[p])
      .map(p => {
        const label = PROVIDER_LABELS[p];
        if (connected[p]) {
          return `<div class="checkrow" style="justify-content:space-between;max-width:420px">
            <span>✅ <b>${label}</b> מחובר${connected[p].account_email ? ' · ' + esc(connected[p].account_email) : ''}</span>
            <button class="btn small" style="color:var(--red)" data-hbc-click="72" data-arg0="${esc(String(p))}">נתק</button>
          </div>`;
        }
        return `<div class="checkrow"><button class="btn" data-hbc-click="73" data-arg0="${esc(String(p))}">🔗 התחבר ל-${label}</button></div>`;
      });
    wrap.innerHTML = rows.length
      ? rows.join('')
      : '<div class="hint">לא הוגדר אף ספק מייל בשרת. יש להגדיר את משתני ה-OAuth ב-Render.</div>';
  } catch (err) {
    wrap.innerHTML = '<div class="status-line err">שגיאה בטעינת חיבורים: ' + esc(err.message) + '</div>';
  }
}

async function connectProvider(p) {
  try {
    const { url } = await api('/api/oauth/' + p + '/start');
    window.location.href = url;
  } catch (err) {
    setStatus('שגיאה בהתחברות: ' + err.message, true);
  }
}

async function disconnectProvider(p) {
  if (!confirm('לנתק את ' + (PROVIDER_LABELS[p] || p) + '?')) return;
  try {
    await api('/api/connections/' + p, { method: 'DELETE' });
    loadConnections();
  } catch (err) {
    setStatus('שגיאה בניתוק: ' + err.message, true);
  }
}

async function scanEmails() {
  const btn = document.getElementById('btnScan');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⏳</span> סורק...';
  try {
    const r = await api('/api/scan', { method: 'POST' });
    await loadData();
    let msg = r.added > 0 ? `נוספו ${r.added} מועמדים חדשים.` : 'לא נמצאו מועמדים חדשים.';
    if (r.errors && r.errors.length) msg += ' שגיאות: ' + r.errors.join(' | ');
    setStatus(msg, !!(r.errors && r.errors.length));
  } catch (err) {
    setStatus('שגיאה בסריקה: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 סרוק מיילים';
  }
}

// Show a one-time message after returning from an OAuth redirect, then clean the URL.
function handleOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const error = params.get('error');
  if (connected) setStatus('✅ ' + (PROVIDER_LABELS[connected] || connected) + ' חובר בהצלחה.');
  else if (error) setStatus('שגיאה בחיבור המייל: ' + error, true);
  if (connected || error) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/* ---------- Jobs ---------- */
const TRACK_LABELS = { office: 'משרדי / תפעולי', multi: 'רב-תחומי', project: 'פרויקטים' };

function fillJobClientSelect(selectedId) {
  document.getElementById('jClient').innerHTML =
    '<option value="">— ללא לקוח —</option>' +
    clients.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

let jobFilters = { q: '', status: '', client: '' };

function setJobFilter(key, value) { jobFilters[key] = value; renderJobs(); }

function toggleJobForm(show) {
  const panel = document.getElementById('jobFormPanel');
  if (!panel) return;
  const open = show === undefined ? panel.style.display === 'none' : show;
  panel.style.display = open ? '' : 'none';
  if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const JOB_STATUS_COLORS = {
  awaiting: 'var(--amber)', filled: 'var(--green)',
  not_filled: 'var(--red)', frozen: 'var(--muted)',
};

function matchesJobFilters(j) {
  if (jobFilters.status && j.status !== jobFilters.status) return false;
  if (jobFilters.client && (j.clientName || '') !== jobFilters.client) return false;
  if (jobFilters.q) {
    const hay = [j.title, j.clientName, j.location, j.contact, j.candidateInProcess,
                 j.jobNumber, j.keywords].join(' ').toLowerCase();
    if (!hay.includes(jobFilters.q.toLowerCase())) return false;
  }
  return true;
}

// "משרות לגיוס" as a work surface: the requests table is what she opens the tab
// for, so it leads and the (long) request form stays folded away.
function renderJobs() {
  fillJobClientSelect(document.getElementById('jClient').value || '');

  // Keep the filter selects in sync with the data.
  const statusSel = document.getElementById('jobStatusFilter');
  if (statusSel) {
    statusSel.innerHTML = '<option value="">כל הסטטוסים</option>' +
      JOB_STATUSES.map(s => `<option value="${s.id}" ${jobFilters.status === s.id ? 'selected' : ''}>${s.label} (${jobs.filter(j => j.status === s.id).length})</option>`).join('');
  }
  const clientSel = document.getElementById('jobClientFilter');
  if (clientSel) {
    const names = [...new Set(jobs.map(j => j.clientName).filter(Boolean))].sort();
    clientSel.innerHTML = '<option value="">כל הלקוחות</option>' +
      names.map(n => `<option value="${esc(n)}" ${jobFilters.client === n ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }

  const wrap = document.getElementById('jobsWrap');
  const countEl = document.getElementById('jobCount');
  if (!jobs.length) {
    if (countEl) countEl.textContent = '';
    wrap.innerHTML = '<div class="empty">אין בקשות גיוס עדיין. לחץ "בקשת גיוס חדשה", או ייבא את האקסל דרך ההגדרות.</div>';
    return;
  }

  const shown = jobs.filter(matchesJobFilters);
  if (countEl) countEl.textContent = `מוצגות ${shown.length} מתוך ${jobs.length}`;
  if (!shown.length) { wrap.innerHTML = '<div class="empty">אין בקשות התואמות לסינון.</div>'; return; }

  const rows = shown.map(j => {
    const linked = collapseDuplicates(candidates.filter(c => c.jobId === j.id));
    const activeCandidates = linked.filter(isCandidateActive);
    const autoNames = activeCandidates.map(c => candidateNameLink(c.id, c.name)).join('<br>');
    const manual = String(j.candidateInProcess || '').trim();
    const manualAlreadyShown = manual && activeCandidates.some(c => manual.includes(c.name));
    const processNames = [autoNames, manual && !manualAlreadyShown
      ? `<span style="color:var(--muted);font-size:11px">הערה ידנית: ${esc(manual)}</span>` : ''].filter(Boolean).join('<br>');
    const reqs = Object.entries(j.requirements || {})
      .map(([k, v]) => `<span class="badge crit" title="${esc(v)}">${esc(k)}${v === 'חובה' ? '*' : ''}</span>`)
      .join(' ');
    return `<tr>
      <td style="white-space:nowrap">
        <span style="color:${JOB_STATUS_COLORS[j.status] || 'inherit'}; font-weight:600">${jobStatusLabel(j.status)}</span>
        ${j.fillMonths != null ? `<br><span style="color:var(--muted);font-size:11px">${j.fillMonths} ח'</span>` : ''}
        ${j.statusReason ? `<br><span style="color:var(--muted);font-size:11px">${esc(j.statusReason)}</span>` : ''}
      </td>
      <td style="white-space:nowrap">${esc(j.requestDate || '')}</td>
      <td>${esc(j.clientName || '')}${j.contact ? `<br><span style="color:var(--muted);font-size:11px">${esc(j.contact)}</span>` : ''}</td>
      <td><b>${esc(j.title)}</b><br><span style="color:var(--muted);font-size:11px">#${esc(j.jobNumber)}</span></td>
      <td>${esc(j.location || '')}</td>
      <td>${processNames || '<span style="color:var(--muted)">—</span>'}</td>
      <td>${esc(j.salaryRange || j.rate || '')}</td>
      <td style="max-width:220px">${reqs || '<span style="color:var(--muted)">—</span>'}</td>
      <td title="${linked.length} מועמדים משויכים בסך הכל">${activeCandidates.length} פעילים${linked.length !== activeCandidates.length ? ` / ${linked.length} סה"כ` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-hbc-click="74" data-arg0="${esc(String(j.id))}" title="מי מהמאגר מתאים למשרה הזו">🎯</button>
        <button class="btn small" data-hbc-click="75" data-arg0="${esc(String(j.id))}" title="העתק כטקסט למחולל מודעות">📋</button>
        <button class="btn small" data-hbc-click="76" data-arg0="${esc(String(j.id))}">✏️</button>
        <button class="btn small" style="color:var(--red)" data-hbc-click="77" data-arg0="${esc(String(j.id))}">🗑</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div style="overflow-x:auto"><table><thead><tr>
    <th>סטטוס</th><th>תאריך בקשה</th><th>לקוח</th><th>תפקיד</th><th>מיקום</th>
    <th>מועמד בתהליך</th><th>שכר</th><th>דרישות</th><th>מועמדים</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function jobStatusLabel(id) {
  return (JOB_STATUSES.find(s => s.id === id) || {}).label || id || '';
}

// API field -> input id, for the many plain-text fields on a client request.
const JOB_FIELD_IDS = {
  requestDate: 'jRequestDate', filledDate: 'jFilledDate', statusReason: 'jStatusReason',
  candidateInProcess: 'jCandidateInProcess', contact: 'jContact', location: 'jLocation',
  workHours: 'jWorkHours', jobScope: 'jJobScope', shifts: 'jShifts',
  startDate: 'jStartDate', period: 'jPeriod', salaryRange: 'jSalaryRange', rate: 'jRate',
  yearsExperience: 'jYearsExperience', language: 'jLanguage', reportsTo: 'jReportsTo',
  securityClearance: 'jSecurityClearance', equipment: 'jEquipment', extraNotes: 'jExtraNotes',
};

function renderRequirementInputs(current) {
  document.getElementById('jRequirements').innerHTML = REQUIREMENT_FIELDS.map(r => `
    <label style="display:flex; align-items:center; gap:6px; font-size:12px">
      <span style="flex:1">${esc(r)}</span>
      <select data-req="${esc(r)}" style="padding:4px">
        ${REQUIREMENT_LEVELS.map(l =>
          `<option value="${esc(l)}" ${(current || {})[r] === l ? 'selected' : ''}>${l || '—'}</option>`
        ).join('')}
      </select>
    </label>`).join('');
}

function readRequirements() {
  const out = {};
  document.querySelectorAll('#jRequirements select[data-req]').forEach(sel => {
    if (sel.value) out[sel.dataset.req] = sel.value;
  });
  return out;
}

function resetJobForm() {
  editingJobId = null;
  document.getElementById('jobFormTitle').textContent = 'הקמת משרה חדשה';
  ['jTitle', 'jKeywords', 'jDescription', ...Object.values(JOB_FIELD_IDS)]
    .forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  document.getElementById('jClient').value = '';
  document.getElementById('jTrack').value = '';
  document.getElementById('jStatus').innerHTML =
    JOB_STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  document.getElementById('jStatus').value = 'awaiting';
  document.getElementById('jIncludesCar').checked = false;
  document.getElementById('jTravel').checked = false;
  renderRequirementInputs({});
  document.getElementById('jCancelBtn').style.display = 'none';
  toggleJobForm(false);
}

function editJob(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  editingJobId = id;
  document.getElementById('jobFormTitle').textContent = 'עריכת משרה #' + j.jobNumber;
  document.getElementById('jTitle').value = j.title;
  fillJobClientSelect(j.clientId || '');
  document.getElementById('jTrack').value = j.track || '';
  document.getElementById('jStatus').innerHTML =
    JOB_STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  document.getElementById('jStatus').value = j.status;
  document.getElementById('jKeywords').value = j.keywords || '';
  document.getElementById('jDescription').value = j.description || '';
  for (const [key, id] of Object.entries(JOB_FIELD_IDS)) {
    const el = document.getElementById(id);
    if (el) el.value = j[key] || '';
  }
  document.getElementById('jIncludesCar').checked = !!j.includesCar;
  document.getElementById('jTravel').checked = !!j.travelBetweenSites;
  renderRequirementInputs(j.requirements || {});
  document.getElementById('jCancelBtn').style.display = '';
  toggleJobForm(true);
}

/**
 * The job as plain text, for pasting into an ad-writing tool.
 *
 * Only fields that were actually filled in, with no interface wording — copying
 * the form itself dragged along every hint and label, which had to be cleaned
 * up by hand before it was usable.
 */
function jobToText(j) {
  const lines = [];
  const add = (label, value) => {
    const v = (value ?? '').toString().trim();
    if (!v) return;
    // Some fields carry the label as their value ("סיווג בטחוני: סיווג בטחוני").
    lines.push(v === label ? v : `${label}: ${v}`);
  };
  const joinFilled = (...pairs) => {
    const parts = pairs.filter(([, v]) => (v ?? '').toString().trim())
      .map(([k, v]) => `${k}: ${String(v).trim()}`);
    if (parts.length) lines.push(parts.join(' | '));
  };

  lines.push(j.clientName ? `${j.title} — ${j.clientName}` : String(j.title || ''));
  add('מיקום', j.location);
  joinFilled(['היקף', j.jobScope], ['שעות', j.workHours], ['משמרות', j.shifts]);
  joinFilled(['תחילת עבודה', j.startDate], ['תקופה', j.period]);
  joinFilled(['טווח שכר', j.salaryRange], ['רייט', j.rate]);

  const perks = [];
  if (j.includesCar === true) perks.push('כולל רכב');
  if (j.travelBetweenSites === true) perks.push('נסיעות בין אתרים');
  if (perks.length) lines.push(perks.join(' | '));

  joinFilled(['שנות ניסיון', j.yearsExperience], ['שפה', j.language]);

  const must = [], nice = [];
  for (const [req, level] of Object.entries(j.requirements || {})) {
    const l = String(level || '').trim();
    if (!l) continue;
    (['חובה', 'V', 'v', 'כן', '1'].includes(l) ? must : nice).push(req);
  }
  if (must.length) lines.push('דרישות חובה: ' + must.join(', '));
  if (nice.length) lines.push('יתרון: ' + nice.join(', '));

  add('כישורים נוספים', j.keywords);
  add('כפיפות', j.reportsTo);
  add('סיווג בטחוני', j.securityClearance);
  add('ציוד/ביגוד', j.equipment);
  add('תיאור', j.description);
  add('הערות', j.extraNotes);
  return lines.join('\n');
}

let toastTimer;
function showToast(msg, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
    setStatus(okMsg);
  } catch {
    // Clipboard API needs a secure context and permission; fall back to a
    // temporary textarea so the button still works.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    if (ok) { showToast(okMsg); setStatus(okMsg); }
    else {
      const msg = 'ההעתקה נחסמה בדפדפן — סמן את הטקסט והעתק ידנית.';
      showToast(msg, true);
      setStatus(msg, true);
    }
  }
}

/** Copy the job open in the form (works before it has been saved). */
function copyJobFormText() {
  const p = jobFormPayload();
  if (!p.title) { alert('נא להזין כותרת משרה'); return; }
  const text = jobToText(p);
  copyText(text, `✓ הטקסט הועתק בהצלחה — ${text.split('\n').length} שורות`);
}

/** Copy a job straight from its row in the table. */
function copyJobText(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  const text = jobToText(j);
  copyText(text, `✓ הטקסט הועתק בהצלחה — ${j.title}`);
}

/** The job as currently typed into the form (used for saving and for export). */
function jobFormPayload() {
  const v = id => document.getElementById(id).value.trim();
  const clientSel = document.getElementById('jClient');
  const payload = {
    title: v('jTitle'),
    clientId: clientSel.value || null,
    clientName: clientSel.selectedOptions[0] ? clientSel.selectedOptions[0].textContent.trim() : '',
    track: document.getElementById('jTrack').value || '',
    status: document.getElementById('jStatus').value,
    keywords: v('jKeywords'),
    description: document.getElementById('jDescription').value,
    requirements: readRequirements(),
    includesCar: document.getElementById('jIncludesCar').checked,
    travelBetweenSites: document.getElementById('jTravel').checked,
  };
  for (const [key, id] of Object.entries(JOB_FIELD_IDS)) payload[key] = v(id);
  return payload;
}

async function saveJob() {
  const v = id => document.getElementById(id).value.trim();
  if (!v('jTitle')) { alert('נא להזין כותרת משרה'); return; }
  const payload = jobFormPayload();
  try {
    if (editingJobId) {
      const updated = await api('/api/jobs/' + editingJobId, { method: 'PATCH', body: JSON.stringify(payload) });
      const i = jobs.findIndex(x => x.id === editingJobId); if (i >= 0) jobs[i] = updated;
    } else {
      jobs.unshift(await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) }));
    }
    resetJobForm();
    renderJobs();
    showToast('✓ המשרה נשמרה');
    const m = document.getElementById('jobMsg'); m.textContent = '✓ נשמר'; setTimeout(() => m.textContent = '', 2000);
  } catch (err) {
    setStatus('שגיאה בשמירת משרה: ' + err.message, true);
  }
}

async function delJob(id) {
  const used = candidates.filter(c => c.jobId === id).length;
  if (!confirm(used ? `למשרה משויכים ${used} מועמדים (השיוך יוסר, המועמדים יישארו). למחוק?` : 'למחוק את המשרה?')) return;
  try {
    await api('/api/jobs/' + id, { method: 'DELETE' });
    jobs = jobs.filter(j => j.id !== id);
    candidates.forEach(c => { if (c.jobId === id) { c.jobId = ''; c.jobNumber = ''; c.jobTitle = ''; } });
    renderJobs(); renderAll();
  } catch (err) {
    setStatus('שגיאה במחיקת משרה: ' + err.message, true);
  }
}

/* ---------- Clients ---------- */
function renderClients() {
  const wrap = document.getElementById('clientsWrap');
  if (!clients.length) { wrap.innerHTML = '<div class="empty">אין לקוחות עדיין.</div>'; return; }
  const rows = clients.map(c => {
    const jobCount = jobs.filter(j => j.clientId === c.id).length;
    return `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.contactName || '')}${c.contactPhone ? '<br><span style="color:var(--muted);font-size:11px">' + esc(c.contactPhone) + '</span>' : ''}</td>
      <td>${esc(c.lookingFor || '')}</td>
      <td>${jobCount}</td>
      <td><button class="btn small" data-hbc-click="78" data-arg0="${esc(String(c.id))}">✏️</button>
          <button class="btn small" style="color:var(--red)" data-hbc-click="79" data-arg0="${esc(String(c.id))}">🗑</button></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table><thead><tr>
    <th>לקוח</th><th>איש קשר</th><th>מחפש</th><th>משרות</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function resetClientForm() {
  editingClientId = null;
  document.getElementById('clientFormTitle').textContent = 'הוספת לקוח';
  ['clName','clContactName','clContactEmail','clContactPhone','clLookingFor','clNotes'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('clCancelBtn').style.display = 'none';
}

function editClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  editingClientId = id;
  document.getElementById('clientFormTitle').textContent = 'עריכת לקוח';
  document.getElementById('clName').value = c.name;
  document.getElementById('clContactName').value = c.contactName || '';
  document.getElementById('clContactEmail').value = c.contactEmail || '';
  document.getElementById('clContactPhone').value = c.contactPhone || '';
  document.getElementById('clLookingFor').value = c.lookingFor || '';
  document.getElementById('clNotes').value = c.notes || '';
  document.getElementById('clCancelBtn').style.display = '';
  window.scrollTo(0, 0);
}

async function saveClient() {
  const v = id => document.getElementById(id).value.trim();
  if (!v('clName')) { alert('נא להזין שם לקוח'); return; }
  const payload = {
    name: v('clName'), contactName: v('clContactName'),
    contactEmail: v('clContactEmail'), contactPhone: v('clContactPhone'),
    lookingFor: document.getElementById('clLookingFor').value, notes: document.getElementById('clNotes').value,
  };
  try {
    if (editingClientId) {
      const updated = await api('/api/clients/' + editingClientId, { method: 'PATCH', body: JSON.stringify(payload) });
      const i = clients.findIndex(x => x.id === editingClientId); if (i >= 0) clients[i] = updated;
    } else {
      clients.push(await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) }));
      clients.sort((a, b) => a.name.localeCompare(b.name));
    }
    resetClientForm();
    renderClients();
    showToast('✓ הלקוח נשמר');
    const m = document.getElementById('clientMsg'); m.textContent = '✓ נשמר'; setTimeout(() => m.textContent = '', 2000);
  } catch (err) {
    setStatus('שגיאה בשמירת לקוח: ' + err.message, true);
  }
}

async function delClient(id) {
  const used = jobs.filter(j => j.clientId === id).length;
  if (!confirm(used ? `ללקוח משויכות ${used} משרות (השיוך יוסר). למחוק?` : 'למחוק את הלקוח?')) return;
  try {
    await api('/api/clients/' + id, { method: 'DELETE' });
    clients = clients.filter(c => c.id !== id);
    jobs.forEach(j => { if (j.clientId === id) { j.clientId = ''; j.clientName = ''; } });
    renderClients(); renderJobs();
  } catch (err) {
    setStatus('שגיאה במחיקת לקוח: ' + err.message, true);
  }
}

/* ---------- Tabs ---------- */
function switchTab(t) {
  document.querySelectorAll('.tab').forEach(b => {
    const active = b.dataset.tab === t;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tabview').forEach(v => { v.style.display = 'none'; v.setAttribute('aria-hidden', 'true'); });
  const view = document.getElementById('tab-' + t);
  view.style.display = '';
  view.setAttribute('aria-hidden', 'false');
  if (t === 'settings') { renderSettings(); loadConnections(); }
  if (t === 'jobs') renderJobs();
  if (t === 'clients') renderClients();
  if (t === 'dashboard') renderDashboard();
  if (t === 'today') renderToday();
}

function setupAccessibility() {
  document.querySelectorAll('.field label').forEach(label => {
    if (label.htmlFor) return;
    const control = label.parentElement?.querySelector('input, select, textarea');
    if (control?.id) label.htmlFor = control.id;
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'tab-' + tab.dataset.tab);
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
  });
  document.querySelectorAll('.tabview').forEach(view => {
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-hidden', view.style.display === 'none' ? 'true' : 'false');
  });
  document.querySelectorAll('.overlay').forEach(overlay => {
    if (!overlay.hasAttribute('role')) overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
  });
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.overlay.show')].reverse()[0];
  if (!open || open.id === 'busyOverlay') return;
  const closers = {
    candModal: closeModal, letterModal: closeLetterModal, aiModal: closeAiModal,
    matchModal: closeMatchModal, bulkModal: closeBulkModal,
  };
  if (closers[open.id]) closers[open.id]();
});

function downloadJson(name,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
let lastMergeIds=[];
async function mergePhoneDuplicates() {
  try {
    const preview=await api('/api/people/duplicates');
    const safe=preview.groups.filter(g=>!g.conflict);
    if(!safe.length){alert('לא נמצאו כפילויות בטוחות לאיחוד לפי טלפון.');return;}
    const names=safe.map(g=>`${g.names.join(' / ')} ← ${g.name}`).join('\n');
    if(!confirm(`לאחד ${safe.length} קבוצות לפי מספר טלפון?\n${names}\nכל ההגשות וההיסטוריה יישמרו. עותק המקור יישמר לשחזור.\n${preview.groups.length-safe.length} קבוצות עם נתונים סותרים לא יאוחדו.`))return;
    const result=await api('/api/people/merge-duplicates',{method:'POST',body:JSON.stringify({token:preview.token})});
    lastMergeIds=result.archiveIds;document.getElementById('undoMergeBtn').style.display='';
    await loadData();alert(`אוחדו ${result.merged} רשומות כפולות. השמות בעברית נשמרו.`);
  }catch(err){alert(err.message);}
}
async function undoLastMerge() {
  try {for(const id of [...lastMergeIds].reverse())await api('/api/people/undo-merge/'+id,{method:'POST',body:'{}'});
    lastMergeIds=[];document.getElementById('undoMergeBtn').style.display='none';await loadData();
  }catch(err){alert(err.message);}
}


// Precompiled UI handlers. No inline JavaScript or runtime eval.
const uiHandlers={
0:function(event){doLogin(event)},
1:function(event){scanEmails()},
2:function(event){analyzeNew()},
3:function(event){openAddModal()},
4:function(event){openBulkImportModal()},
5:function(event){repairNames()},
6:function(event){logout()},
7:function(event){switchTab('today')},
8:function(event){switchTab('board')},
9:function(event){switchTab('dashboard')},
10:function(event){switchTab('list')},
11:function(event){switchTab('jobs')},
12:function(event){switchTab('clients')},
13:function(event){switchTab('settings')},
14:function(event){toggleJobForm()},
15:function(event){setJobFilter('q', this.value)},
16:function(event){setJobFilter('status', this.value)},
17:function(event){setJobFilter('client', this.value)},
18:function(event){saveJob()},
19:function(event){copyJobFormText()},
20:function(event){resetJobForm()},
21:function(event){saveClient()},
22:function(event){resetClientForm()},
23:function(event){addCritRow('','')},
24:function(event){saveSettings()},
25:function(event){importWorkbook(this)},
26:function(event){mergePhoneDuplicates()},
27:function(event){undoLastMerge()},
28:function(event){clearAll()},
29:function(event){document.getElementById('candidateHistoryHeading').scrollIntoView({block:'start',behavior:'smooth'})},
30:function(event){handleCandidateJobChange()},
31:function(event){handleOutcomeChange()},
32:function(event){toggleRejectFields()},
33:function(event){if(this.value){document.getElementById('mRejectReason').value=this.value}},
34:function(event){draftLetterFor('rejection')},
35:function(event){document.getElementById('mEventApply').checked=this.value===localDateIso()},
36:function(event){fillEventOutcomes()},
37:function(event){fillEventReasons()},
38:function(event){addCandidateEvent()},
39:function(event){analyzeFromModal()},
40:function(event){openAnalysisModal(editingId)},
41:function(event){draftLetterFor('thankyou')},
42:function(event){saveModal()},
43:function(event){closeModal()},
44:function(event){copyLetter()},
45:function(event){closeLetterModal()},
46:function(event){closeAiModal()},
47:function(event){closeMatchModal()},
48:function(event){startBulkImport()},
49:function(event){closeBulkModal()},
50:function(event){openEditModal(this.dataset.arg0)},
51:function(event){matchJob(this.dataset.arg0)},
52:function(event){runDrill(this.dataset.arg0)},
53:function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();runDrill(this.dataset.arg0)}},
54:function(event){runDrill(this.dataset.arg0)},
55:function(event){openEditModal(this.dataset.arg0)},
56:function(event){openEditModal(this.dataset.arg0)},
57:function(event){openAnalysisModal(this.dataset.arg0)},
58:function(event){analyzeCandidate(this.dataset.arg0)},
59:function(event){delCand(this.dataset.arg0)},
60:function(event){clearListDrill()},
61:function(event){setListFilter('q', this.value)},
62:function(event){setListFilter('source', this.value)},
63:function(event){setListFilter('analyzed', this.value)},
64:function(event){setMergeDuplicates(this.checked)},
65:function(event){setMilestone(this.dataset.arg0, this.dataset.arg1, this.checked)},
66:function(event){setOutcome(this.dataset.arg0, this.value)},
67:function(event){openAnalysisModal(this.dataset.arg0)},
68:function(event){openEditModal(this.dataset.arg0)},
69:function(event){removeCandidateEvent(this.dataset.arg0)},
70:function(event){closeMatchModal(); openEditModal(this.dataset.arg0)},
71:function(event){this.parentElement.remove()},
72:function(event){disconnectProvider(this.dataset.arg0)},
73:function(event){connectProvider(this.dataset.arg0)},
74:function(event){matchJob(this.dataset.arg0)},
75:function(event){copyJobText(this.dataset.arg0)},
76:function(event){editJob(this.dataset.arg0)},
77:function(event){delJob(this.dataset.arg0)},
78:function(event){editClient(this.dataset.arg0)},
79:function(event){delClient(this.dataset.arg0)}
};
for(const type of ['click','change','input','keydown','submit']) document.addEventListener(type,event=>{
  const target=event.target.closest?.('[data-hbc-'+type+']');
  if(!target)return;
  const id=target.getAttribute('data-hbc-'+type);
  if(Object.hasOwn(uiHandlers,id))uiHandlers[id].call(target,event);
});

/* ---------- Init ---------- */
setupAccessibility();
showLogin();
api('/api/auth/me').then(data=>{setUser(data.user);showApp();return loadData();})
  .then(()=>{loadConnections();handleOAuthReturn();}).catch(()=>showLogin());
