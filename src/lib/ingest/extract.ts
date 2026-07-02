// Server-side text extraction for uploaded documents (PDF, DOCX, MD, TXT).
//
// ONE entry point: extractText(input) → { text, meta }. The returned text then
// goes through the EXISTING ingestDocument() pipeline (chunking, embeddings,
// atomic write, audit) — this module never touches the database.
//
// Fail-closed by design: anything that cannot be extracted into real text
// (oversize file, wrong MIME/extension, scanned PDF without a text layer,
// empty document) throws an ExtractionError with a user-readable German
// message. There is NO silent empty import.
import mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';
import { getOcrProvider, OCR_MAX_PAGES, type OcrProvider } from './ocr';

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export type SourceFormat = 'pdf' | 'docx' | 'md' | 'txt';

export interface ExtractInput {
  /** Original filename — its extension is half of the format check. */
  filename: string;
  /** Browser/client MIME type; '' is tolerated (CLI, some browsers omit it). */
  mimeType: string;
  /** Raw file bytes. */
  data: Uint8Array;
}

export interface ExtractMeta {
  format: SourceFormat;
  /** PDF only; null for the other formats. */
  pageCount: number | null;
  wordCount: number;
  /** true = the text came from OCR (scanned PDF, Phase 17). */
  ocr?: boolean;
}

export interface ExtractResult {
  text: string;
  meta: ExtractMeta;
}

/** Extraction failed for THIS file — reported per file, never crashes a batch. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

// Extension decides the format; the MIME type (when the client sent one) must
// then agree. Both checks must pass — extension OR MIME alone is spoofable.
const FORMAT_BY_EXTENSION: Record<string, SourceFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
};

const ALLOWED_MIMES: Record<SourceFormat, ReadonlyArray<string>> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  txt: ['text/plain'],
};

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'] as const;

export function detectFormat(filename: string, mimeType: string): SourceFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const format = FORMAT_BY_EXTENSION[ext];
  if (!format) {
    throw new ExtractionError(
      `Nicht unterstütztes Format "${ext ? `.${ext}` : filename}" — erlaubt sind .pdf, .docx, .md, .txt.`,
    );
  }
  // '' and the generic octet-stream mean "client didn't know" — the extension
  // check above plus the parser itself (which fails on wrong bytes) still hold.
  const mime = mimeType.trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && !ALLOWED_MIMES[format].includes(mime)) {
    throw new ExtractionError(
      `MIME-Typ "${mime}" passt nicht zur Endung .${ext} — Datei abgelehnt.`,
    );
  }
  return format;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Light Markdown cleanup: strip decoration that would pollute chunks (heading
 * markers, emphasis, inline-code backticks, link URLs) while keeping every
 * word. Fenced code blocks are preserved VERBATIM as their own paragraphs —
 * only the ``` fence lines are dropped, the content is never re-wrapped.
 */
export function cleanMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      // Fence line itself carries no content; a blank keeps the block a paragraph.
      out.push('');
      continue;
    }
    if (inFence) {
      out.push(line); // code verbatim — never "bereinigt"
      continue;
    }
    out.push(
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // # Heading → Heading (stays its own paragraph)
        .replace(/^\s{0,3}>\s?/, '') // blockquote marker
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
        .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
        .replace(/(\*|_)([^*_]+)\1/g, '$2') // italic
        .replace(/`([^`]+)`/g, '$1'), // inline code
    );
  }
  return out.join('\n');
}

async function extractPdf(data: Uint8Array, ocr: OcrProvider | null): Promise<ExtractResult> {
  let totalPages: number;
  let text: string;
  try {
    ({ totalPages, text } = await extractPdfText(data, { mergePages: true }));
  } catch {
    throw new ExtractionError('PDF konnte nicht gelesen werden — Datei beschädigt oder kein PDF.');
  }
  const cleaned = text.trim();
  if (!cleaned) {
    // Scanned PDF without a text layer. WITH a configured OCR provider the
    // pages are transcribed (Phase 17, page-limited); WITHOUT one this stays
    // the same fail-closed rejection as before — never a silent empty import.
    if (!ocr) {
      throw new ExtractionError(
        'Gescanntes PDF ohne Textebene — OCR ist nicht konfiguriert (ANTHROPIC_API_KEY setzen). Bitte ein Text-PDF hochladen.',
      );
    }
    if (totalPages > OCR_MAX_PAGES) {
      throw new ExtractionError(
        `Gescanntes PDF mit ${totalPages} Seiten — OCR ist auf ${OCR_MAX_PAGES} Seiten begrenzt (Kosten-Guard).`,
      );
    }
    let ocrText: string;
    try {
      ocrText = (await ocr.extractPdfText(data)).trim();
    } catch {
      throw new ExtractionError('OCR fehlgeschlagen — bitte erneut versuchen oder ein Text-PDF hochladen.');
    }
    if (!ocrText) {
      throw new ExtractionError('OCR fand keinen lesbaren Text in diesem Scan.');
    }
    return {
      text: ocrText,
      meta: { format: 'pdf', pageCount: totalPages, wordCount: countWords(ocrText), ocr: true },
    };
  }
  return {
    text: cleaned,
    meta: { format: 'pdf', pageCount: totalPages, wordCount: countWords(cleaned) },
  };
}

async function extractDocx(data: Uint8Array): Promise<ExtractResult> {
  let value: string;
  try {
    // extractRawText keeps headings/paragraphs as separate blocks ("\n\n").
    ({ value } = await mammoth.extractRawText({ buffer: Buffer.from(data) }));
  } catch {
    throw new ExtractionError('DOCX konnte nicht gelesen werden — Datei beschädigt oder kein DOCX.');
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw new ExtractionError('DOCX enthält keinen extrahierbaren Text.');
  }
  return {
    text: cleaned,
    meta: { format: 'docx', pageCount: null, wordCount: countWords(cleaned) },
  };
}

function extractPlain(data: Uint8Array, format: 'md' | 'txt'): ExtractResult {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(data);
  const text = (format === 'md' ? cleanMarkdown(raw) : raw).trim();
  if (!text) {
    throw new ExtractionError('Datei enthält keinen Text.');
  }
  return { text, meta: { format, pageCount: null, wordCount: countWords(text) } };
}

export interface ExtractOptions {
  /** Injectable OCR provider (tests/demo). Default: env-selected (null = off). */
  ocr?: OcrProvider | null;
}

export async function extractText(
  input: ExtractInput,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (input.data.byteLength > MAX_FILE_BYTES) {
    throw new ExtractionError(
      `Datei zu groß (${(input.data.byteLength / 1024 / 1024).toFixed(1)} MB) — Limit sind 20 MB.`,
    );
  }
  if (input.data.byteLength === 0) {
    throw new ExtractionError('Leere Datei — nichts zu extrahieren.');
  }
  const format = detectFormat(input.filename, input.mimeType);
  switch (format) {
    case 'pdf':
      return extractPdf(input.data, options.ocr !== undefined ? options.ocr : getOcrProvider());
    case 'docx':
      return extractDocx(input.data);
    case 'md':
    case 'txt':
      return extractPlain(input.data, format);
  }
}
