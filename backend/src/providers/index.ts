import type { EmailProvider } from './types.js';
import { google } from './google.js';
import { microsoft } from './microsoft.js';

const providers: Record<string, EmailProvider> = { google, microsoft };

export function getProvider(name: string): EmailProvider | undefined {
  return providers[name];
}

// 'google' -> 'gmail', 'microsoft' -> 'outlook' (candidate.source values)
export function sourceFor(provider: string): string {
  return provider === 'google' ? 'gmail' : 'outlook';
}

export { google, microsoft };
