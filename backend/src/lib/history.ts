import { randomUUID } from 'node:crypto';

const BLOCK = /\n?<!--HBC_EVENTS_V1:([A-Za-z0-9+/=]+)-->/;
type RecordData = Record<string, any>;

export function readNotes(raw: unknown): { text: string; events: RecordData[] } {
  const value = String(raw || '');
  const block = value.match(BLOCK);
  if (!block) return { text: value.trim(), events: [] };
  const parsed = JSON.parse(Buffer.from(block[1], 'base64').toString('utf8'));
  if (!Array.isArray(parsed) || parsed.some(e => !e || typeof e.id !== 'string' || !e.type)) {
    throw new Error('ההיסטוריה הקיימת אינה תקינה. השמירה נעצרה כדי לשמור עליה.');
  }
  return { text: value.replace(BLOCK, '').trim(), events: parsed };
}

export function composeNotes(text: string, events: RecordData[]): string {
  return `${text.trim()}${text.trim() ? '\n' : ''}<!--HBC_EVENTS_V1:${Buffer.from(JSON.stringify(events)).toString('base64')}-->`;
}

const TRACKED = ['jobId', 'stage', 'outcomeStatus', 'rejectionReason', 'rejectedBy',
  'rejectionLetterSent', 'interviewedTeams', 'gotTask', 'sentToClient', 'clientApproved',
  'summaryText', 'contactedAt', 'role', 'jobTitle', 'clientId', 'clientName'];
export function snapshot(c: RecordData): RecordData {
  return Object.fromEntries(TRACKED.map(k => [k, c[k] ?? '']));
}

// Called under a row lock, in the same transaction as the application update.
// Incoming notes can append events but cannot remove or replace saved events.
export function appendHistory(before: RecordData, patch: RecordData, actor: string): string {
  const stored = readNotes(before.notes);
  const incoming = patch.notes === undefined ? stored : readNotes(patch.notes);
  const events = [...stored.events];
  const ids = new Set(events.map(e => e.id));
  const now = new Date().toISOString();
  if (!events.some(e => e.type === 'baseline' || e.legacy)) {
    const id = `baseline_${before.id}`;
    events.push({ id, type: 'baseline', legacy: true, date: now.slice(0, 10), createdAt: now,
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
      jobId: before.jobId || '', jobTitle: before.jobTitle || '',
      clientId: before.clientId || '', clientName: before.clientName || '' });
  }
  return composeNotes(incoming.text, events);
}
