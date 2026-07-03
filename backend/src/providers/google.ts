import type { CvAttachment, EmailProvider, ScanSettings, ScannedMessage, TokenSet } from './types.js';
import { base64UrlToBase64, cvRank, mimeForFilename } from './attachments.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE}/api/oauth/google/callback`;
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google token error: ${data.error_description || data.error || res.status}`);
  return data;
}

async function getProfileEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return data.emailAddress;
}

function toTokenSet(data: any): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    scopes: data.scope
  };
}

async function exchangeCode(code: string): Promise<TokenSet> {
  const data = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code'
  });
  const ts = toTokenSet(data);
  ts.accountEmail = await getProfileEmail(ts.accessToken);
  return ts;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
    grant_type: 'refresh_token'
  });
  return toTokenSet(data);
}

// Parse a raw "Name <email>" From header (ported from the original artifact).
function parseSender(s: string): { name: string; email: string } {
  if (!s) return { name: '', email: '' };
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  if (s.includes('@')) {
    const local = s.split('@')[0].replace(/[._-]+/g, ' ');
    return { name: local, email: s.trim() };
  }
  return { name: s.trim(), email: '' };
}

function buildQuery(settings: ScanSettings): string {
  const terms = settings.query.split(',').map((t) => t.trim()).filter(Boolean);
  let q = '{' + terms.map((t) => `"${t}"`).join(' OR ') + '} newer_than:' + (settings.days || 60) + 'd';
  if (settings.attachOnly) q += ' has:attachment';
  if (settings.gmailTo) q += ' deliveredto:' + settings.gmailTo.trim();
  return q;
}

async function searchMessages(accessToken: string, settings: ScanSettings): Promise<ScannedMessage[]> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const listUrl =
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=' +
    encodeURIComponent(buildQuery(settings));
  const listRes = await fetch(listUrl, { headers: auth });
  const listData = await listRes.json().catch(() => ({}));
  if (!listRes.ok) throw new Error(`Gmail search error: ${listData.error?.message || listRes.status}`);

  const messages: any[] = listData.messages || [];
  const out: ScannedMessage[] = [];
  for (const m of messages) {
    // format=full (not metadata): we need payload.parts to detect CV attachments.
    const detUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
    const detRes = await fetch(detUrl, { headers: auth });
    if (!detRes.ok) continue;
    const det = await detRes.json().catch(() => ({}));
    const headers: any[] = det.payload?.headers || [];
    const getH = (n: string) => headers.find((h) => h.name?.toLowerCase() === n)?.value || '';
    const snd = parseSender(getH('from'));
    const dateRaw = getH('date');
    out.push({
      extKey: 'gmail:' + (det.threadId || m.id),
      providerMessageId: m.id,
      hasAttachment: hasFileParts(det.payload),
      name: snd.name || snd.email || 'לא ידוע',
      email: snd.email,
      subject: getH('subject'),
      snippet: det.snippet || '',
      date: dateRaw ? new Date(dateRaw).toISOString() : '',
      link: 'https://mail.google.com/mail/u/0/#all/' + (det.threadId || m.id)
    });
  }
  return out;
}

// Walk a Gmail MIME tree collecting parts that have a (CV-like) filename.
function collectAttachmentParts(payload: any, acc: any[] = []): any[] {
  if (!payload) return acc;
  if (payload.filename && payload.body?.attachmentId) acc.push(payload);
  for (const p of payload.parts || []) collectAttachmentParts(p, acc);
  return acc;
}

function hasFileParts(payload: any): boolean {
  return collectAttachmentParts(payload).some((p) => cvRank(p.filename) > 0);
}

async function downloadCvAttachment(accessToken: string, messageId: string): Promise<CvAttachment | null> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const detRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: auth }
  );
  if (!detRes.ok) return null;
  const det = await detRes.json().catch(() => ({}));

  const parts = collectAttachmentParts(det.payload)
    .filter((p) => cvRank(p.filename) > 0)
    .sort((a, b) => cvRank(b.filename) - cvRank(a.filename));
  const best = parts[0];
  if (!best) return null;

  const attRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${best.body.attachmentId}`,
    { headers: auth }
  );
  if (!attRes.ok) return null;
  const att = await attRes.json().catch(() => ({}));
  if (!att.data) return null;

  return {
    filename: best.filename,
    mimeType: best.mimeType || mimeForFilename(best.filename),
    dataBase64: base64UrlToBase64(att.data)
  };
}

export const google: EmailProvider = {
  isConfigured,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  searchMessages,
  downloadCvAttachment
};
