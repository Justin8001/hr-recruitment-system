import { HttpError } from './errors.js';
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

  const {mime,buffer}=validateCv(file);
  if(INLINE_MIME.has(mime)) return {parts:[{inline_data:{mime_type:mime,data:file.dataBase64}}],sourceNote:`קובץ מצורף: ${file.filename}`};
  const name=(file.filename||'').toLowerCase();
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

export function validateCv(file:CvAttachment) {
  const fail=():never=>{throw new HttpError(400,'INVALID_FILE','קובץ קורות החיים אינו תקין או שסוגו אינו נתמך');};
  if(typeof file.dataBase64!=='string'||file.dataBase64.length>20*1024*1024||
    /[^A-Za-z0-9+/=]/.test(file.dataBase64)) return fail();
  const buffer=Buffer.from(file.dataBase64,'base64');
  if(!buffer.length||buffer.length>15*1024*1024||buffer.toString('base64')!==file.dataBase64)return fail();
  let mime='';
  if(buffer.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
  else if(buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a')mime='image/png';
  else if(buffer.subarray(0,3).toString('hex')==='ffd8ff')mime='image/jpeg';
  else if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')mime='image/webp';
  else if(buffer.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1')mime='application/msword';
  else if(buffer.subarray(0,4).toString('hex')==='504b0304') {
    let total=0,count=0,hasDocument=false;
    for(let i=0;i+46<=buffer.length;i++)if(buffer.readUInt32LE(i)===0x02014b50) {
      const n=buffer.readUInt16LE(i+28),extra=buffer.readUInt16LE(i+30),comment=buffer.readUInt16LE(i+32);
      if(i+46+n+extra+comment>buffer.length)return fail();
      total+=buffer.readUInt32LE(i+24);count++;
      if(buffer.subarray(i+46,i+46+n).toString()==='word/document.xml')hasDocument=true;
      if(total>50*1024*1024||count>2000)return fail();
      i+=45+n+extra+comment;
    }
    if(!hasDocument)return fail();mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if(!mime)return fail();
  const claimed=(file.mimeType||'').toLowerCase().replace('image/jpg','image/jpeg');
  if(claimed&&claimed!=='application/octet-stream'&&claimed!==mime)return fail();
  return {mime,buffer};
}
