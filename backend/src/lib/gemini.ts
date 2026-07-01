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
    location: { type: 'string' }
  },
  required: [
    'relevant', 'fit', 'summary', 'strengths', 'concerns', 'interviewQuestions',
    'matchedKeywords', 'certifications', 'location'
  ]
};

function buildPrompt(job: JobContext): string {
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
    '- summary: סיכום קצר של המועמד.',
    '- strengths: יתרונות המועמד למשרה זו.',
    '- concerns: פערים או נקודות שחשוב לברר.',
    '- interviewQuestions: השאלות הכי חשובות לראיון הטלפוני.',
    '- matchedKeywords: אילו ממילות המפתח של המשרה מופיעות בקורות החיים.',
    '- certifications: רשימת ההכשרות/הסמכות של המועמד (למשל: ענף בנייה, הדרכה, קרינה, עבודה בגובה).',
    '- age: הגיל המחושב של המועמד. חשב לפי תאריך לידה אם צוין, אחרת אמוד לפי שנת שירות צבאי/לימודים. אם אי אפשר להעריך — null.',
    '- location: עיר/יישוב המגורים של המועמד (שם המקום בלבד).'
  );
  return lines.join('\n');
}

/**
 * Sends the CV (as Gemini parts) plus job context and returns structured analysis.
 * Throws on configuration or API errors (caller maps to a friendly message).
 */
export async function analyzeCv(job: JobContext, cvParts: GeminiPart[]): Promise<CvAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('AI לא הוגדר בשרת (חסר GEMINI_API_KEY)');

  const body = {
    contents: [{ parts: [{ text: buildPrompt(job) }, ...cvParts] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2
    }
  };

  // Hard timeout so a hung request fails fast instead of blocking forever.
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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini החזיר פלט שאינו JSON תקין');
  }

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
    location: String(parsed.location || '')
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
