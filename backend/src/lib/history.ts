import { randomUUID } from 'node:crypto';

const BLOCK = /\n?<!--HBC_EVENTS_V1:([\s\S]*?)-->/g;
type RecordData = Record<string, any>;

export function readNotes(raw: unknown): { text: string; events: RecordData[]; warnings: string[] } {
  const value = String(raw || '');
  const events: RecordData[] = [], warnings: string[] = [];
  const seen = new Map<string, string>();
  const text = value.replace(BLOCK, (whole, encoded) => {
    try {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error();
      const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      if (!Array.isArray(parsed) || parsed.some(e => !e || typeof e.id !== 'string' || !e.id || typeof e.type !== 'string' || !e.type)) throw new Error();
      if (parsed.some(e => seen.has(e.id) && seen.get(e.id) !== JSON.stringify(e))) throw new Error();
      for (const e of parsed) if (!seen.has(e.id)) { seen.set(e.id, JSON.stringify(e)); events.push(e); }
      return '';
    } catch {
      warnings.push('נמצא מקטע היסטוריה פגום. המקור נשמר במלואו בהערות ולא נמחק.');
      return whole;
    }
  }).trim();
  if (text.includes('<!--HBC_EVENTS_V1:') && !warnings.length) warnings.push('נמצא מקטע היסטוריה לא שלם; המקור נשמר בהערות.');
  return { text, events, warnings };
}

export function composeNotes(text: string, events: RecordData[]): string {
  return `<!--HBC_EVENTS_V1:${Buffer.from(JSON.stringify(events)).toString('base64')}-->${text.trim() ? '\n' : ''}${text.trim()}`;
}

const TRACKED = ['jobId', 'stage', 'outcomeStatus', 'rejectionReason', 'rejectedBy',
  'rejectionLetterSent', 'interviewedTeams', 'gotTask', 'sentToClient', 'clientApproved',
  'summaryText', 'contactedAt', 'role', 'jobTitle', 'clientId', 'clientName',
  'name', 'email', 'phone', 'referral', 'region', 'city', 'nationalId', 'doNotRehire',
  'doNotRehireReason', 'salaryExpectation', 'jobScope', 'employmentType', 'sourceChannel'];
export function snapshot(c: RecordData): RecordData {
  return Object.fromEntries(TRACKED.map(k => [k, c[k] ?? '']));
}

// Called under a row lock, in the same transaction as the application update.
// Incoming notes can append events but cannot remove or replace saved events.
export function appendHistory(before: RecordData, patch: RecordData, actor: string): string {
  const stored = readNotes(before.notes);
  const incoming = patch.notes === undefined ? { ...stored } : readNotes(patch.notes);
  // Quarantine damaged original blocks even if a client omits them.
  for (const block of String(before.notes || '').match(BLOCK) || []) {
    if (readNotes(block).warnings.length && !incoming.text.includes(block.trim())) incoming.text += '\n' + block.trim();
  }
  if(stored.warnings.length && !incoming.text.includes(stored.text)) {
    const incomplete=stored.text.match(/<!--HBC_EVENTS_V1:(?:(?!-->)[\s\S])*$/)?.[0];
    if(incomplete&&!incoming.text.includes(incomplete))incoming.text+='\n'+incomplete;
  }
  const events = [...stored.events];
  const ids = new Set(events.map(e => e.id));
  const now = new Date().toISOString();
  if (!events.some(e => e.type === 'baseline' || e.legacy)) {
    const id = `baseline_${before.id}`;
    events.push({ id, type: 'baseline', legacy: true, date: null, recordedAt: now, createdAt: now,
      description: [before.summaryText, stored.text, before.rejectionReason].filter(Boolean).join('\n'),
      result: before.outcomeStatus || before.stage || '', snapshot: snapshot(before),
      jobId: before.jobId || '', jobTitle: before.jobTitle || '',
      clientId: before.clientId || '', clientName: before.clientName || '' });
    ids.add(id);
  }
  for (const event of incoming.events) {
    if (ids.has(event.id) || event.automatic || event.type === 'baseline' || event.legacy) continue;
    events.push({ ...event, actor, recordedAt: now });
    ids.add(event.id);
  }
  const after = { ...before, ...patch };
  const changes = TRACKED.filter(k => patch[k] !== undefined && String(before[k] ?? '') !== String(after[k] ?? ''));
  if (changes.length || incoming.text !== stored.text) {
    events.push({ id: randomUUID(), type: 'audit', automatic: true, date: now.slice(0, 10), createdAt: now,
      description: 'שינוי בכרטיס המועמד', result: after.outcomeStatus || '', actor,
      before: snapshot(before), after: snapshot(after),
      notesBefore: stored.text, notesAfter: incoming.text,
      jobId: after.jobId || '', jobTitle: after.jobTitle || '',
      clientId: after.clientId || '', clientName: after.clientName || '' });
  }
  return composeNotes(incoming.text, events);
}
