import type { EmailProvider, ScanSettings, ScannedMessage, TokenSet } from './types.js';

const SCOPES = 'offline_access Mail.Read User.Read';

function tenant() {
  return process.env.MICROSOFT_TENANT || 'common';
}
function authBase() {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}
function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE}/api/oauth/microsoft/callback`;
}

function isConfigured() {
  return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID as string,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    prompt: 'select_account',
    state
  });
  return `${authBase()}/authorize?${p.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(`${authBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft token error: ${data.error_description || data.error || res.status}`);
  return data;
}

async function getAccountEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return data.mail || data.userPrincipalName;
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
    client_id: process.env.MICROSOFT_CLIENT_ID as string,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET as string,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES,
    code
  });
  const ts = toTokenSet(data);
  ts.accountEmail = await getAccountEmail(ts.accessToken);
  return ts;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const data = await tokenRequest({
    client_id: process.env.MICROSOFT_CLIENT_ID as string,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET as string,
    grant_type: 'refresh_token',
    scope: SCOPES,
    refresh_token: refreshToken
  });
  return toTokenSet(data);
}

async function searchMessages(accessToken: string, settings: ScanSettings): Promise<ScannedMessage[]> {
  const terms = settings.query.split(',').map((t) => t.trim()).filter(Boolean);
  const search = terms.map((t) => `\\"${t}\\"`).join(' OR ');
  const after = new Date(Date.now() - (settings.days || 60) * 864e5);

  const url =
    'https://graph.microsoft.com/v1.0/me/messages' +
    '?$select=subject,from,receivedDateTime,bodyPreview,webLink,internetMessageId' +
    '&$top=50&$search=' + encodeURIComponent(`"${search}"`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: 'eventual' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph search error: ${data.error?.message || res.status}`);

  const items: any[] = data.value || [];
  const out: ScannedMessage[] = [];
  for (const it of items) {
    if (it.receivedDateTime && new Date(it.receivedDateTime) < after) continue;
    const addr = it.from?.emailAddress || {};
    out.push({
      extKey: 'outlook:' + (it.internetMessageId || it.id),
      name: addr.name || addr.address || 'לא ידוע',
      email: addr.address || '',
      subject: it.subject || '(ללא נושא)',
      snippet: it.bodyPreview || '',
      date: it.receivedDateTime ? new Date(it.receivedDateTime).toISOString() : '',
      link: it.webLink || ''
    });
  }
  return out;
}

export const microsoft: EmailProvider = {
  isConfigured,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  searchMessages
};
