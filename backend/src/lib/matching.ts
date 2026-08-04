// Reverse matching: given a job, rank the candidates already in the pool.
//
// The recruiter's ask was "when I open a request, rank the people I already
// have against it" — often without posting an ad at all. Two inputs decide the
// fit, and the HR consultant was explicit that both are needed: the client's
// structured requirements matrix, and the free-text description where the soft
// requirements live.
//
// Scoring here is deterministic and cheap so it can run over the whole pool on
// every request; the AI pass (see jobs route) only re-ranks the shortlist.

export interface JobForMatch {
  id: string;
  title?: string;
  keywords?: string;
  description?: string;
  location?: string;
  salaryRange?: string;
  rate?: string;
  yearsExperience?: string;
  language?: string;
  requirements?: Record<string, string>;
}

export interface CandidateForMatch {
  id: string;
  name: string;
  role?: string;
  region?: string;
  city?: string;
  salaryExpectation?: number | null;
  /** The recruiter's own write-up of the intro call. */
  summaryText?: string;
  notes?: string;
  ai?: any;
}

export interface MatchResult {
  candidateId: string;
  score: number;              // 0..100
  matched: string[];          // requirements/keywords found
  missing: string[];          // mandatory requirements not found
  flags: string[];            // things the recruiter should see before calling
}

/**
 * Everything we know about a candidate, as one searchable blob.
 *
 * Candidates imported from the recruiter's workbook have no CV and therefore no
 * AI analysis — only what she typed after the intro call. That write-up is the
 * richest thing we hold on them ("ענפית בניה, אנגלית בסיסית, מסיים בודק מוסמך"),
 * so it has to feed the match or the whole imported pool ranks near zero.
 */
function candidateText(c: CandidateForMatch): string {
  const a = c.ai || {};
  return norm([
    c.role, c.region, c.city, c.summaryText, c.notes,
    a.summary, a.profession, a.location,
    ...(a.certifications || []),
    ...(a.strengths || []),
    ...(a.matchedKeywords || [])
  ].filter(Boolean).join(' '));
}

/**
 * Hebrew spelling drifts between the client's requirement list and the
 * recruiter's notes — "בנייה" vs "בניה", quotes in "צ\"ש" — so both sides are
 * flattened before comparing.
 */
function norm(s: string): string {
  return (s || '').toLowerCase()
    .replace(/["'`׳״]/g, '')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, term: string): boolean {
  const t = norm(term);
  if (t.length < 2) return false;
  if (t.length <= 3) {
    // Short labels like "אש" would otherwise match inside ראש / אשקלון.
    return new RegExp(`(^|[^\\u0590-\\u05FFa-z])${t}([^\\u0590-\\u05FFa-z]|$)`).test(text);
  }
  if (text.includes(t)) return true;
  // Multi-word requirements are rarely written in the same order in her notes
  // ("בנייה ענפית" vs "ענפית בניה"), so fall back to matching every word.
  const words = t.split(' ').filter(w => w.length >= 3);
  return words.length > 1 && words.every(w => text.includes(w));
}

/** Largest number in a free-text salary field, read as thousands when written "16-18". */
function maxSalary(s?: string): number | null {
  if (!s) return null;
  const nums = (s.match(/\d[\d,.]*/g) || [])
    .map(n => Number(n.replace(/[,]/g, '')))
    .filter(n => !Number.isNaN(n) && n > 0);
  if (!nums.length) return null;
  const max = Math.max(...nums);
  return max < 100 ? max * 1000 : max;   // "16-18" means 16–18K
}

const MANDATORY = ['חובה', 'must', 'v', 'V', '1', 'כן'];

export function scoreCandidate(job: JobForMatch, c: CandidateForMatch): MatchResult {
  const text = candidateText(c);
  const matched: string[] = [];
  const missing: string[] = [];
  const flags: string[] = [];
  let points = 0;
  let possible = 0;

  // 1) The client's requirements matrix. Mandatory items carry triple the
  // weight of a nice-to-have, and a missing one is called out by name.
  for (const [req, level] of Object.entries(job.requirements || {})) {
    if (!level || !String(level).trim()) continue;
    const mandatory = MANDATORY.includes(String(level).trim());
    const weight = mandatory ? 3 : 1;
    possible += weight;
    if (has(text, req)) { points += weight; matched.push(req); }
    else if (mandatory) missing.push(req);
  }

  // 2) Job keywords and the free-text description — where soft requirements live.
  const terms = [
    ...String(job.keywords || '').split(','),
    ...String(job.title || '').split(/\s+/)
  ].map(t => t.trim()).filter(t => t.length > 2);
  for (const term of new Set(terms)) {
    possible += 1;
    if (has(text, term)) { points += 1; matched.push(term); }
  }

  // 3) Geography — her most common hard filter after salary ("נפסל איזור ג\"ג").
  if (job.location) {
    const where = `${c.region || ''} ${c.city || ''} ${c.ai?.location || ''}`.toLowerCase();
    const places = String(job.location).split(/[,/]/).map(p => p.trim()).filter(p => p.length > 2);
    if (places.length) {
      possible += 2;
      if (places.some(p => where.includes(p.toLowerCase()) || p.toLowerCase().includes(where.trim()))) {
        points += 2;
        matched.push(`אזור: ${c.region || c.city}`);
      } else if (where.trim()) {
        flags.push(`גר ב${c.city || c.region} — המשרה ב${job.location}`);
      }
    }
  }

  // 4) Salary. Expectations above the budget are the single biggest reason
  // candidates are dropped, so surface it rather than bury it in the score.
  const budget = maxSalary(job.salaryRange) ?? maxSalary(job.rate);
  if (budget && c.salaryExpectation) {
    if (c.salaryExpectation > budget * 1.05) {
      flags.push(`צ"ש ${c.salaryExpectation.toLocaleString()} מול תקציב ~${budget.toLocaleString()}`);
      points -= 2;
    } else {
      matched.push('ציפיות שכר בתקציב');
      points += 2;
    }
    possible += 2;
  }

  if (c.ai && c.ai.relevant === false) points -= 1;

  const score = possible > 0
    ? Math.max(0, Math.min(100, Math.round((points / possible) * 100)))
    : 0;
  return { candidateId: c.id, score, matched, missing, flags };
}

/**
 * Ranks the whole pool. Candidates missing a mandatory requirement are kept but
 * pushed down — the recruiter still wants to see them, since "חובה" from a
 * client is often negotiable in practice.
 */
export function rankCandidates(
  job: JobForMatch,
  candidates: CandidateForMatch[]
): MatchResult[] {
  return candidates
    .map(c => scoreCandidate(job, c))
    .sort((a, b) =>
      (a.missing.length - b.missing.length) ||
      (b.score - a.score) ||
      (b.matched.length - a.matched.length)
    );
}
