import mammoth from 'mammoth';
import type { CvAttachment } from '../providers/types.js';

// A Gemini content "part": either inline binary (PDF/image) or plain text.
export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

const INLINE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

/**
 * Turns a downloaded CV into Gemini parts.
 * - PDF / image  → inline_data (Gemini reads it natively).
 * - DOCX         → text extracted via mammoth.
 * - anything else (e.g. legacy .doc) → null; caller falls back to email text.
 */
export async function prepareCvParts(
  file: CvAttachment | null
): Promise<{ parts: GeminiPart[]; sourceNote: string } | null> {
  if (!file || !file.dataBase64) return null;

  const mime = (file.mimeType || '').toLowerCase();
  if (INLINE_MIME.has(mime)) {
    return {
      parts: [{ inline_data: { mime_type: mime, data: file.dataBase64 } }],
      sourceNote: `קובץ מצורף: ${file.filename}`
    };
  }

  const name = (file.filename || '').toLowerCase();
  if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(file.dataBase64, 'base64') });
      const text = (value || '').trim();
      if (text) {
        return {
          parts: [{ text: `תוכן קורות החיים (מקובץ ${file.filename}):\n${text}` }],
          sourceNote: `קובץ מצורף: ${file.filename}`
        };
      }
    } catch {
      // fall through to null — caller uses email text instead
    }
  }

  return null;
}
