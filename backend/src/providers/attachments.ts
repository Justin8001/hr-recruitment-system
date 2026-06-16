// Shared helpers for picking and decoding CV attachments across providers.

const CV_EXT = ['.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg'];

/**
 * How "CV-like" a filename is. Higher = better candidate for the résumé.
 * PDFs first, then Word, then images. Non-matching files score 0.
 */
export function cvRank(filename: string): number {
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.pdf')) return 5;
  if (f.endsWith('.docx')) return 4;
  if (f.endsWith('.doc')) return 3;
  if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')) return 2;
  return 0;
}

export function isCvFilename(filename: string): boolean {
  const f = (filename || '').toLowerCase();
  return CV_EXT.some((ext) => f.endsWith(ext));
}

export function mimeForFilename(filename: string): string {
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.pdf')) return 'application/pdf';
  if (f.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (f.endsWith('.doc')) return 'application/msword';
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/** Gmail returns attachment data as base64url; convert to standard base64. */
export function base64UrlToBase64(data: string): string {
  return data.replace(/-/g, '+').replace(/_/g, '/');
}
