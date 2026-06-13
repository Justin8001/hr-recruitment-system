/** A message normalized into the fields a candidate needs. */
export interface ScannedMessage {
  extKey: string;   // dedup key, e.g. 'gmail:<threadId>' / 'outlook:<internetMessageId>'
  name: string;
  email: string;
  subject: string;
  snippet: string;
  date: string;     // ISO string ('' if unknown)
  link: string;
}

/** Subset of app settings relevant to scanning. */
export interface ScanSettings {
  query: string;
  days: number;
  attachOnly?: boolean;
  gmailTo?: string;
}

/** Result of an OAuth code exchange or token refresh. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;       // may be absent on refresh
  expiresAt: Date;
  scopes?: string;
  accountEmail?: string;
}

/** Common shape every provider module implements. */
export interface EmailProvider {
  isConfigured(): boolean;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  searchMessages(accessToken: string, settings: ScanSettings): Promise<ScannedMessage[]>;
}
