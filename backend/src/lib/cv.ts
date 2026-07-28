import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import type { CvAttachment } from '../providers/types.js';

// A Gemini content "part": either inline binary (PDF/image) or plain text.
export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

const INLINE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

/**
 * Turns a downloaded CV into Gemini parts.
 * - PDF / image  → inline_data (Gemini reads it natively).
 * - DOCX         → text extracted via mammoth.
 * - legacy .doc  → text extracted via word-extractor.
 * - anything else → null; caller falls back to email text.
 */
export async function prepareCvParts(
  file: CvAttachment | null
): Promise<{ parts: GeminiPart[]; sourceNote: string } | null> {
  if (!file || !file.dataBase64) return null;

  // Normalize provider quirks: 'image/jpg' is not a valid IANA type (Gemini rejects it).
  const mime = (file.mimeType || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (INLINE_MIME.has(mime)) {
    return {
      parts: [{ inline_data: { mime_type: mime, data: file.dataBase64 } }],
      sourceNote: `קובץ מצורף: ${file.filename}`
    };
  }

  const name = (file.filename || '').toLowerCase();
  const buffer = Buffer.from(file.dataBase64, 'base64');
  const asText = (text: string) => ({
    parts: [{ text: `תוכן קורות החיים (מקובץ ${file.filename}):\n${text}` }] as GeminiPart[],
    sourceNote: `קובץ מצורף: ${file.filename}`
  });

  if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value || '').trim();
      if (text) return asText(text);
    } catch {
      // fall through — try the legacy reader, then null
    }
  }

  // Legacy Word (.doc, pre-2007): mammoth can't read it, word-extractor can.
  if (name.endsWith('.doc') || mime === 'application/msword') {
    try {
      const doc = await new WordExtractor().extract(buffer);
      const text = (doc.getBody() || '').trim();
      if (text) return asText(text);
    } catch {
      // fall through to null — caller uses email text instead
    }
  }

  return null;
}
