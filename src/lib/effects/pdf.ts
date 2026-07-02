// Minimal, dependency-free PDF writer — one A4 page of text lines.
//
// Good enough for Angebots-/Rechnungs-Dokumente aus dem Skill-Katalog; when
// layout needs grow, swap this for a real library behind the same function.
// Text is WinAnsi (latin1) encoded so German umlauts work; characters outside
// latin1 become '?'. Parentheses/backslashes are escaped per PDF string rules.

const PAGE_WIDTH = 595; // A4 @ 72 dpi
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const TITLE_SIZE = 16;
const BODY_SIZE = 11;
const LEADING = 16;

function escapePdfText(text: string): string {
  // latin1-representable or '?', then escape PDF string specials.
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    out += code > 255 ? '?' : ch;
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Render a single-page PDF: a title line followed by body lines. */
export function renderSimplePdf(title: string, lines: string[]): Uint8Array {
  const content: string[] = [];
  content.push('BT');
  content.push(`/F1 ${TITLE_SIZE} Tf`);
  content.push(`${MARGIN} ${PAGE_HEIGHT - MARGIN - TITLE_SIZE} Td`);
  content.push(`${LEADING} TL`);
  content.push(`(${escapePdfText(title)}) Tj`);
  content.push(`/F1 ${BODY_SIZE} Tf`);
  content.push('T* T*');
  for (const line of lines) {
    content.push(`(${escapePdfText(line)}) Tj T*`);
  }
  content.push('ET');
  const stream = Buffer.from(content.join('\n'), 'latin1');

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  ];

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
