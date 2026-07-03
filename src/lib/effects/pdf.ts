// Dependency-free PDF writer für Geschäftsdokumente (Angebot/Rechnung).
//
// Zwei Renderer über EINEM Low-Level-Assembler:
//   renderBusinessPdf() — Briefkopf (Firmendaten), Empfängerblock, Meta-Zeilen,
//                         Positionstabelle mit Summe, Fußzeile (USt-IdNr./Bank/
//                         Seitenzahl) auf JEDER Seite, automatischer Umbruch.
//   renderSimplePdf()   — die alte Ein-Titel-plus-Zeilen-Form (bestehende
//                         Aufrufer/Tests), jetzt ebenfalls mehrseitig.
//
// Text ist WinAnsi (latin1): deutsche Umlaute funktionieren, Zeichen außerhalb
// latin1 werden '?'. Klammern/Backslashes sind nach PDF-Regeln escaped.
// Rechtsbündigkeit (Beträge, Seitenzahl) über eine kompakte Helvetica-
// Metriktabelle — exakt für Ziffern/Interpunktion, Näherung für den Rest.

const PAGE_WIDTH = 595; // A4 @ 72 dpi
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FOOTER_HEIGHT = 60; // reserviert auf jeder Seite (Linie + Kleinzeilen)
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

const TITLE_SIZE = 16;
const BODY_SIZE = 11;
const SMALL_SIZE = 8;
const LEADING = 16;
const SMALL_LEADING = 10;

const FONT_REGULAR = 'F1';
const FONT_BOLD = 'F2';

// Helvetica-Breiten (1/1000 em) für die Zeichen, auf deren Ausrichtung es
// ankommt (Beträge, Seitenzahlen). Alles andere: 556 als brauchbarer Median.
const HELVETICA_WIDTHS: Record<string, number> = {
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, '.': 278, ',': 278, ' ': 278, '-': 333, '/': 278, ':': 278,
  E: 667, U: 722, R: 722, S: 667, e: 556, i: 222, t: 278, n: 556, m: 833,
};
const DEFAULT_WIDTH = 556;

function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) units += HELVETICA_WIDTHS[ch] ?? DEFAULT_WIDTH;
  return (units / 1000) * size;
}

// WinAnsi belegt 0x80–0x9F mit typografischen Zeichen, die in Unicode
// außerhalb von latin1 liegen — die gängigen werden gemappt statt zu '?'.
const WINANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97,
};

function escapePdfText(text: string): string {
  // WinAnsi-darstellbar oder '?', dann PDF-String-Spezialzeichen escapen.
  let out = '';
  for (const ch of text) {
    const mapped = WINANSI_EXTRA[ch];
    if (mapped !== undefined) {
      out += String.fromCharCode(mapped);
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    out += code > 255 ? '?' : ch;
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Weicher Zeilenumbruch auf eine Zielbreite (wortweise, Näherungsmetrik).
 * Einzelwörter über der Breite werden hart getrennt statt überzulaufen. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (let word of words) {
      while (textWidth(word, size) > maxWidth) {
        // Hart trennen: so viele Zeichen, wie in die Breite passen.
        let cut = word.length;
        while (cut > 1 && textWidth(word.slice(0, cut), size) > maxWidth) cut -= 1;
        if (current) {
          lines.push(current);
          current = '';
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = current ? `${current} ${word}` : word;
      if (current && textWidth(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// -----------------------------------------------------------------------------
// Low-Level: Seiten aus Zeichen-Operationen → fertige PDF-Bytes
// -----------------------------------------------------------------------------

/** Eine Seite = Liste fertiger Content-Stream-Zeilen (Text- und Pfad-Ops). */
type PageOps = string[];

function drawText(ops: PageOps, font: string, size: number, x: number, y: number, text: string): void {
  ops.push(
    'BT',
    `/${font} ${size} Tf`,
    `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
    `(${escapePdfText(text)}) Tj`,
    'ET',
  );
}

function drawRightText(ops: PageOps, font: string, size: number, rightX: number, y: number, text: string): void {
  drawText(ops, font, size, rightX - textWidth(text, size), y, text);
}

function drawLine(ops: PageOps, x1: number, y1: number, x2: number, y2: number): void {
  ops.push('0.6 w', `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, 'S');
}

/** Seiten (Content-Ops) zu einem vollständigen PDF-Dokument assemblieren. */
function buildPdf(pages: PageOps[]): Uint8Array {
  // Objekt-Layout: 1 Catalog, 2 Pages, 3 F1, 4 F2, dann je Seite (Page, Stream).
  const pageObjNumbers = pages.map((_, i) => 5 + i * 2);
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from(
      `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      'latin1',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', 'latin1'),
  ];

  for (const [i, ops] of pages.entries()) {
    const stream = Buffer.from(ops.join('\n'), 'latin1');
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /${FONT_REGULAR} 3 0 R /${FONT_BOLD} 4 0 R >> >> /Contents ${pageObjNumbers[i]! + 1} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
        stream,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(position);
    const obj = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(obj);
    position += obj.length;
  });

  const xrefOffset = position;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));

  return new Uint8Array(Buffer.concat(parts));
}

// -----------------------------------------------------------------------------
// Seiten-Baukasten mit Umbruch + Fußzeilen
// -----------------------------------------------------------------------------

/** Absenderdaten für Briefkopf & Fußzeile — Spiegel von CompanyProfile
 * (src/lib/company.ts), hier strukturell dupliziert, damit der PDF-Writer
 * keine DB-/Tenant-Abhängigkeit bekommt. */
export interface PdfSender {
  name: string | null;
  address: string | null;
  vatId: string | null;
  bank: string | null;
}

class PageBuilder {
  readonly pages: PageOps[] = [[]];
  private y = PAGE_HEIGHT - MARGIN;

  private get ops(): PageOps {
    return this.pages[this.pages.length - 1]!;
  }

  /** Platz sichern; bei Bedarf neue Seite beginnen (Fußzeile kommt später). */
  ensure(height: number): void {
    if (this.y - height < CONTENT_BOTTOM) {
      this.pages.push([]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  moveDown(height: number): void {
    this.y -= height;
  }

  text(font: string, size: number, text: string, leading = LEADING): void {
    this.ensure(leading);
    this.y -= leading;
    drawText(this.ops, font, size, MARGIN, this.y, text);
  }

  /** Zeile mit linksbündigem und rechtsbündigem Teil (Tabellen, Meta). */
  row(font: string, size: number, left: string, right: string, leading = LEADING): void {
    this.ensure(leading);
    this.y -= leading;
    drawText(this.ops, font, size, MARGIN, this.y, left);
    drawRightText(this.ops, font, size, PAGE_WIDTH - MARGIN, this.y, right);
  }

  rightText(font: string, size: number, text: string, leading = LEADING): void {
    this.ensure(leading);
    this.y -= leading;
    drawRightText(this.ops, font, size, PAGE_WIDTH - MARGIN, this.y, text);
  }

  separator(): void {
    this.ensure(LEADING);
    this.y -= LEADING / 2;
    drawLine(this.ops, MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
    this.y -= LEADING / 2;
  }

  /** Fußzeile auf jede Seite stempeln (nach der Paginierung — die Gesamtzahl
   * der Seiten ist erst dann bekannt). */
  stampFooters(sender: PdfSender): void {
    const footerLines: string[] = [];
    const identity = [sender.name, sender.address?.replace(/\n/g, ', ')]
      .filter(Boolean)
      .join(' · ');
    if (identity) footerLines.push(identity);
    const fiscal = [
      sender.vatId ? `USt-IdNr.: ${sender.vatId}` : null,
      sender.bank?.replace(/\n/g, ' · ') ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (fiscal) footerLines.push(fiscal);

    const total = this.pages.length;
    this.pages.forEach((ops, i) => {
      const topY = MARGIN + FOOTER_HEIGHT - SMALL_LEADING;
      drawLine(ops, MARGIN, topY + 4, PAGE_WIDTH - MARGIN, topY + 4);
      let y = topY;
      for (const line of footerLines) {
        y -= SMALL_LEADING;
        drawText(ops, FONT_REGULAR, SMALL_SIZE, MARGIN, y, line);
      }
      drawRightText(ops, FONT_REGULAR, SMALL_SIZE, PAGE_WIDTH - MARGIN, topY - SMALL_LEADING, `Seite ${i + 1}/${total}`);
    });
  }
}

// -----------------------------------------------------------------------------
// Öffentliche Renderer
// -----------------------------------------------------------------------------

export interface BusinessPdfPosition {
  beschreibung: string;
  betragEur: number;
}

export interface BusinessPdfInput {
  /** Dokumenttitel, z. B. "Angebot" oder "Rechnung R-2026-001". */
  title: string;
  /** Briefkopf/Fußzeile; leere Felder ⇒ neutraler Kopf, nichts wird erfunden. */
  sender?: PdfSender;
  /** Empfängerblock (Name, ggf. Adresse) unter dem Briefkopf. */
  recipient?: string[];
  /** Meta rechtsbündig über dem Titel, z. B. [['Datum', '03.07.2026']]. */
  meta?: Array<[string, string]>;
  /** Fließtext vor der Tabelle (Absätze; \n innerhalb erlaubt). */
  body?: string[];
  /** Positionen; mit Summenzeile gerendert, wenn nicht leer. */
  positions?: BusinessPdfPosition[];
  /** Label der Summenzeile (Default "Gesamtsumme"). */
  totalLabel?: string;
  /** Fließtext nach der Tabelle (Konditionen, Grußformel). */
  closing?: string[];
}

/** 1234.5 → "1.234,50 EUR" (deutsches Zahlenformat, ohne Intl-Abhängigkeit). */
export function formatEur(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const [int = '0', frac = '00'] = Math.abs(amount).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${frac} EUR`;
}

const NEUTRAL_SENDER: PdfSender = { name: null, address: null, vatId: null, bank: null };
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
// Beschreibungs-Spalte endet vor der Betrags-Spalte (max. Betragsbreite ~110pt).
const DESCRIPTION_WIDTH = CONTENT_WIDTH - 120;

/** Geschäftsdokument (Angebot/Rechnung): Briefkopf, Positionen, Fußzeile. */
export function renderBusinessPdf(input: BusinessPdfInput): Uint8Array {
  const sender = input.sender ?? NEUTRAL_SENDER;
  const b = new PageBuilder();

  // Briefkopf: Firmenname fett, Adresse klein darunter (nur Seite 1).
  if (sender.name) {
    b.text(FONT_BOLD, 12, sender.name);
    for (const line of (sender.address ?? '').split('\n').filter(Boolean)) {
      b.text(FONT_REGULAR, SMALL_SIZE, line, SMALL_LEADING);
    }
    b.moveDown(LEADING);
  }

  // Empfängerblock.
  if (input.recipient && input.recipient.length > 0) {
    for (const line of input.recipient) b.text(FONT_REGULAR, BODY_SIZE, line);
    b.moveDown(LEADING);
  }

  // Meta rechtsbündig (Datum, Nummern).
  for (const [label, value] of input.meta ?? []) {
    b.rightText(FONT_REGULAR, BODY_SIZE, `${label}: ${value}`, LEADING - 2);
  }
  if (input.meta && input.meta.length > 0) b.moveDown(LEADING / 2);

  // Titel.
  b.text(FONT_BOLD, TITLE_SIZE, input.title, LEADING + 8);
  b.moveDown(LEADING / 2);

  // Fließtext.
  for (const paragraph of input.body ?? []) {
    for (const line of wrapText(paragraph, BODY_SIZE, CONTENT_WIDTH)) {
      b.text(FONT_REGULAR, BODY_SIZE, line);
    }
  }

  // Positionstabelle.
  if (input.positions && input.positions.length > 0) {
    b.moveDown(LEADING / 2);
    b.row(FONT_BOLD, BODY_SIZE, 'Beschreibung', 'Betrag');
    b.separator();
    let total = 0;
    for (const pos of input.positions) {
      total += pos.betragEur;
      const lines = wrapText(pos.beschreibung, BODY_SIZE, DESCRIPTION_WIDTH);
      b.row(FONT_REGULAR, BODY_SIZE, lines[0] ?? '', formatEur(pos.betragEur));
      for (const rest of lines.slice(1)) b.text(FONT_REGULAR, BODY_SIZE, rest);
    }
    b.separator();
    b.row(FONT_BOLD, BODY_SIZE, input.totalLabel ?? 'Gesamtsumme', formatEur(total));
  }

  // Schlusstext.
  if (input.closing && input.closing.length > 0) {
    b.moveDown(LEADING);
    for (const paragraph of input.closing) {
      for (const line of wrapText(paragraph, BODY_SIZE, CONTENT_WIDTH)) {
        b.text(FONT_REGULAR, BODY_SIZE, line);
      }
    }
  }

  b.stampFooters(sender);
  return buildPdf(b.pages);
}

/** Ein Titel plus Textzeilen — bestehende Aufrufer; jetzt mit Seitenumbruch. */
export function renderSimplePdf(title: string, lines: string[]): Uint8Array {
  const b = new PageBuilder();
  b.text(FONT_BOLD, TITLE_SIZE, title, LEADING + 8);
  b.moveDown(LEADING / 2);
  for (const raw of lines) {
    const wrapped = wrapText(raw, BODY_SIZE, CONTENT_WIDTH);
    if (wrapped.length === 0) {
      b.moveDown(LEADING);
      continue;
    }
    for (const line of wrapped) {
      b.text(FONT_REGULAR, BODY_SIZE, line);
    }
  }
  b.stampFooters(NEUTRAL_SENDER);
  return buildPdf(b.pages);
}
