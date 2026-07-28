import type { GeminiPart } from './cv.js';

const DEFAULT_MODEL = 'gemini-2.5-pro';

export interface JobContext {
  jobNumber?: string;
  title?: string;
  keywords?: string;
  description?: string;
  clientName?: string;
  clientLookingFor?: string;
}

/** An open job offered to the AI as a candidate match during auto-matching. */
export interface JobOption extends JobContext {
  id: string;
}

export interface CvAnalysis {
  relevant: boolean;
  fit: number;                 // 1..3
  summary: string;
  strengths: string[];
  concerns: string[];
  interviewQuestions: string[];
  matchedKeywords: string[];
  certifications: string[];    // הכשרות: ענף בנייה, הדרכה, קרינה...
  age: number | null;          // computed from birth date / army year, null if unknown
  location: string;            // city / town of residence
  profession: string;          // the candidate's field/role, e.g. "ממונה בטיחות" — classifies them even with no job assigned
  candidateName: string;       // full name as extracted from the CV text (for bulk-import auto-fill)
  candidateEmail: string;      // email as extracted from the CV text, '' if none found
  candidatePhone: string;      // phone as extracted from the CV text, '' if none found
}

/** Analysis plus the job the AI picked for this CV ('' when nothing fits). */
export interface AutoMatchAnalysis extends CvAnalysis {
  jobId: string;
  jobReason: string;           // one line: why this job was chosen (or why none fit)
}

export function isConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function model(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

// Structured-output schema so Gemini returns parseable JSON every time.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    fit: { type: 'integer' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    interviewQuestions: { type: 'array', items: { type: 'string' } },
    matchedKeywords: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
    age: { type: 'integer', nullable: true },
    location: { type: 'string' },
    profession: { type: 'string' },
    candidateName: { type: 'string' },
    candidateEmail: { type: 'string' },
    candidatePhone: { type: 'string' }
  },
  required: [
    'relevant', 'fit', 'summary', 'strengths', 'concerns', 'interviewQuestions',
    'matchedKeywords', 'certifications', 'location', 'profession', 'candidateName'
  ]
};

// Shared tail of every prompt: the per-candidate fields that don't depend on a job.
const CANDIDATE_FIELD_LINES = [
  '- summary: סיכום קצר של המועמד.',
  '- concerns: פערים או נקודות שחשוב לברר.',
  '- interviewQuestions: השאלות הכי חשובות לראיון הטלפוני.',
  '- certifications: רשימת ההכשרות/הסמכות של המועמד (למשל: ענף בנייה, הדרכה, קרינה, עבודה בגובה).',
  '- age: הגיל המחושב של המועמד. חשב לפי תאריך לידה אם צוין, אחרת אמוד לפי שנת שירות צבאי/לימודים. אם אי אפשר להעריך — null.',
  '- location: עיר/יישוב המגורים של המועמד (שם המקום בלבד).',
  '- profession: תחום העיסוק / התפקיד המרכזי של המועמד בשתיים-שלוש מילים (למשל: "ממונה בטיחות", "מהנדס אזרחי", "מנהל פרויקטים"). זהו הסיווג המקצועי שלו.',
  '- candidateName: שם המועמד/ת המלא כפי שמופיע בקורות החיים עצמם (חשוב מאוד — זה משמש ליצירת רשומת המועמד). אם באמת אי אפשר לזהות שם, החזר מחרוזת ריקה.',
  '- candidateEmail: כתובת האימייל של המועמד כפי שמופיעה בקורות החיים. מחרוזת ריקה אם אין.',
  '- candidatePhone: מספר הטלפון של המועמד כפי שמופיע בקורות החיים. מחרוזת ריקה אם אין.'
];

/**
 * No job to score against (none assigned, or none open at all): profile the
 * candidate on their own terms so the CV still gets read, classified and filed.
 */
function buildProfilePrompt(): string {
  return [
    'אתה עוזר גיוס מומחה. אין משרה ספציפית לבדוק מולה — נתח את קורות החיים כפרופיל עצמאי, וענה בעברית בלבד.',
    '',
    'החזר JSON עם:',
    '- relevant: true אם מדובר בקורות חיים אמיתיים וקריאים, false אם הקובץ אינו קורות חיים או לא ניתן לקריאה.',
    '- fit: איכות/חוזק המועמד בתחומו — 1 (חלש) עד 3 (חזק).',
    '- strengths: החוזקות המקצועיות הבולטות של המועמד.',
    '- matchedKeywords: מילות מפתח מקצועיות בולטות מקורות החיים (כישורים, תחומים, מערכות).',
    ...CANDIDATE_FIELD_LINES
  ].join('\n');
}

function buildPrompt(job: JobContext): string {
  // Analyze/bulk flows can reach here with nothing to compare against.
  if (!job.title && !job.keywords && !job.description && !job.clientLookingFor) {
    return buildProfilePrompt();
  }
  const lines = [
    'אתה עוזר גיוס מומחה. נתח את קורות החיים המצורפים מול המשרה, וענה בעברית בלבד.',
    '',
    'פרטי המשרה:'
  ];
  lines.push(`- כותרת: ${job.title || 'לא צוינה'}`);
  if (job.jobNumber) lines.push(`- מספר משרה: ${job.jobNumber}`);
  if (job.keywords) lines.push(`- מילות מפתח נדרשות: ${job.keywords}`);
  if (job.description) lines.push(`- תיאור: ${job.description}`);
  if (job.clientName) lines.push(`- לקוח: ${job.clientName}`);
  if (job.clientLookingFor) lines.push(`- מה הלקוח מחפש: ${job.clientLookingFor}`);
  lines.push(
    '',
    'החזר JSON עם:',
    '- relevant: האם המועמד רלוונטי למשרה בכלל.',
    '- fit: רמת התאמה 1 (נמוכה) עד 3 (גבוהה).',
    '- strengths: יתרונות המועמד למשרה זו.',
    '- matchedKeywords: אילו ממילות המפתח של המשרה מופיעות בקורות החיים.',
    ...CANDIDATE_FIELD_LINES
  );
  return lines.join('\n');
}

/**
 * POSTs a request body to Gemini and returns the parsed JSON payload it produced.
 * Hard timeout so a hung request fails fast instead of blocking forever.
 */
async function requestGeminiJson(body: unknown): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('AI לא הוגדר בשרת (חסר GEMINI_API_KEY)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Gemini לא הגיב בזמן (timeout של 2 דקות)');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini error: ${data.error?.message || res.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini החזיר פלט שאינו JSON תקין');
  }
}

/** Normalizes Gemini's raw JSON into a CvAnalysis (defensive against missing fields). */
function toCvAnalysis(parsed: any): CvAnalysis {
  return {
    relevant: !!parsed.relevant,
    fit: Math.max(1, Math.min(3, Number(parsed.fit) || 1)),
    summary: String(parsed.summary || ''),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [],
    interviewQuestions: Array.isArray(parsed.interviewQuestions) ? parsed.interviewQuestions.map(String) : [],
    matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.map(String) : [],
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications.map(String) : [],
    age: (parsed.age === null || parsed.age === undefined || Number.isNaN(Number(parsed.age))) ? null : Number(parsed.age),
    location: String(parsed.location || ''),
    profession: String(parsed.profession || ''),
    candidateName: String(parsed.candidateName || ''),
    candidateEmail: String(parsed.candidateEmail || ''),
    candidatePhone: String(parsed.candidatePhone || '')
  };
}

/**
 * Sends the CV (as Gemini parts) plus job context and returns structured analysis.
 * Throws on configuration or API errors (caller maps to a friendly message).
 */
export async function analyzeCv(job: JobContext, cvParts: GeminiPart[]): Promise<CvAnalysis> {
  const parsed = await requestGeminiJson({
    contents: [{ parts: [{ text: buildPrompt(job) }, ...cvParts] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2
    }
  });
  return toCvAnalysis(parsed);
}

// Auto-match: same analysis, plus the AI first picks which open job fits best.
const AUTO_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    ...RESPONSE_SCHEMA.properties,
    jobId: { type: 'string' },
    jobReason: { type: 'string' }
  },
  required: [...RESPONSE_SCHEMA.required, 'jobId', 'jobReason']
};

function buildAutoMatchPrompt(jobs: JobOption[]): string {
  const lines = [
    'אתה עוזר גיוס מומחה. לפניך קורות חיים ורשימת המשרות הפתוחות אצלנו.',
    'משימתך: (א) לקבוע לאיזו משרה המועמד מתאים ביותר, (ב) לנתח אותו מול אותה משרה. ענה בעברית בלבד.',
    '',
    'המשרות הפתוחות:'
  ];
  for (const j of jobs) {
    const parts = [`[jobId: ${j.id}]`, `כותרת: ${j.title || 'ללא כותרת'}`];
    if (j.jobNumber) parts.push(`מספר משרה: ${j.jobNumber}`);
    if (j.clientName) parts.push(`לקוח: ${j.clientName}`);
    if (j.keywords) parts.push(`מילות מפתח: ${j.keywords}`);
    if (j.description) parts.push(`תיאור: ${j.description}`);
    if (j.clientLookingFor) parts.push(`מה הלקוח מחפש: ${j.clientLookingFor}`);
    lines.push('- ' + parts.join(' | '));
  }
  lines.push(
    '',
    'החזר JSON עם:',
    '- jobId: המזהה (jobId) של המשרה המתאימה ביותר מהרשימה למעלה, בדיוק כפי שנכתב. אם המועמד לא מתאים לאף אחת מהמשרות — החזר מחרוזת ריקה.',
    '- jobReason: משפט אחד קצר שמסביר למה נבחרה המשרה הזו (או למה אף משרה לא מתאימה).',
    '- relevant: האם המועמד רלוונטי למשרה שבחרת. אם לא בחרת משרה — false.',
    '- fit: רמת התאמה למשרה שבחרת, 1 (נמוכה) עד 3 (גבוהה).',
    '- strengths: יתרונות המועמד למשרה שנבחרה.',
    '- matchedKeywords: אילו ממילות המפתח של המשרה שנבחרה מופיעות בקורות החיים.',
    ...CANDIDATE_FIELD_LINES
  );
  return lines.join('\n');
}

/**
 * Picks the best-fitting open job for this CV and analyzes against it — one call.
 * Returns jobId '' when the AI judged that no open job fits.
 */
export async function analyzeCvAutoMatch(
  jobs: JobOption[],
  cvParts: GeminiPart[]
): Promise<AutoMatchAnalysis> {
  const parsed = await requestGeminiJson({
    contents: [{ parts: [{ text: buildAutoMatchPrompt(jobs) }, ...cvParts] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: AUTO_MATCH_SCHEMA,
      temperature: 0.2
    }
  });

  // Only trust an id that actually exists — the model can hallucinate one.
  const picked = String(parsed.jobId || '');
  const jobId = jobs.some(j => j.id === picked) ? picked : '';
  return {
    ...toCvAnalysis(parsed),
    jobId,
    jobReason: String(parsed.jobReason || '')
  };
}

// Drafts a Hebrew thank-you / rejection letter the user can copy into their own
// mail client. Returns plain letter text (no JSON, no permissions needed to send).
export async function draftLetter(
  kind: 'thankyou' | 'rejection',
  ctx: { candidateName: string; jobTitle?: string; reason?: string }
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('AI לא הוגדר בשרת (חסר GEMINI_API_KEY)');

  const prompt = kind === 'thankyou'
    ? [
        'כתוב מכתב תודה קצר ומנומס בעברית למועמד שהגיש מועמדות.',
        `שם המועמד: ${ctx.candidateName}.`,
        ctx.jobTitle ? `המשרה: ${ctx.jobTitle}.` : '',
        'ציין שקיבלנו את מועמדותו ושנעדכן בהמשך התהליך. טון חם ומקצועי. החזר טקסט מכתב בלבד, ללא כותרות מטא.'
      ].join('\n')
    : [
        'כתוב מכתב שלילה מנומס, מכבד ותמציתי בעברית למועמד.',
        `שם המועמד: ${ctx.candidateName}.`,
        ctx.jobTitle ? `המשרה: ${ctx.jobTitle}.` : '',
        ctx.reason ? `הסיבה הפנימית (אל תצטט אותה ישירות, נסח בעדינות): ${ctx.reason}.` : '',
        'הודה למועמד על הזמן, ציין שלא נמשיך בתהליך הפעם, ואחל הצלחה. החזר טקסט מכתב בלבד.'
      ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5 } }),
        signal: controller.signal
      }
    );
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Gemini לא הגיב בזמן (timeout)');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini error: ${data.error?.message || res.status}`);
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('').trim() || '';
}
