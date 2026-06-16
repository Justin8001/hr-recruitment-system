/** A message normalized into the fields a candidate needs. */
export interface ScannedMessage {
  extKey: string;   // dedup key, e.g. 'gmail:<threadId>' / 'outlook:<internetMessageId>'
  providerMessageId: string;  // native message id, used to fetch the CV attachment later
  hasAttachment: boolean;
  name: string;
  email: string;
  subject: string;
  snippet: string;
  date: string;     // ISO string ('' if unknown)
  link: string;
}

/** A downloaded attachment, ready to hand to the AI layer. */
export interface CvAttachment {
  filename: string;
  mimeType: string;
  dataBase64: string;  // standard base64 (not base64url)
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
  /** Download the most CV-like attachment from a message, or null if none. */
  downloadCvAttachment(accessToken: string, messageId: string): Promise<CvAttachment | null>;
}
