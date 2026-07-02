'use client';

// Multi-file upload (Drag & Drop + picker) for .pdf/.docx/.md/.txt.
//
// Files are sent ONE per server-action call (ingestUpload), sequentially, so
// each file gets its own progress state and result line — a scan-PDF or an
// oversize file fails alone with its reason while the rest of the batch goes
// through. Extraction and every write happen server-side; this component only
// holds display state.
import { useRef, useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ingestUpload, type UploadFileResult } from './actions';

const ACCEPT = '.pdf,.docx,.md,.txt';

type ItemState =
  | { status: 'pending'; fileName: string }
  | { status: 'uploading'; fileName: string }
  | ({ status: 'done' } & UploadFileResult);

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [visibility, setVisibility] = useState('open');
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleFiles(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setItems(list.map((f) => ({ status: 'pending', fileName: f.name })));

    startTransition(async () => {
      for (let i = 0; i < list.length; i++) {
        setItems((prev) => prev.map((it, j) => (j === i ? { status: 'uploading', fileName: list[i].name } : it)));
        const formData = new FormData();
        formData.set('file', list[i]);
        formData.set('visibility', visibility);
        let result: UploadFileResult;
        try {
          result = await ingestUpload(formData);
        } catch {
          result = { fileName: list[i].name, ok: false, error: 'Übertragung fehlgeschlagen.' };
        }
        setItems((prev) => prev.map((it, j) => (j === i ? { status: 'done', ...result } : it)));
      }
      router.refresh(); // pull the updated document table
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!isPending) handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Dateien hochladen"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--indigo, #4f46e5)' : '#c7c9d1'}`,
          borderRadius: '8px',
          padding: '1.5rem',
          textAlign: 'center',
          cursor: isPending ? 'wait' : 'pointer',
          background: dragOver ? 'rgba(79,70,229,0.06)' : 'transparent',
        }}
      >
        <strong>Dateien hierher ziehen</strong> oder klicken zum Auswählen
        <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
          .pdf, .docx, .md, .txt — mehrere Dateien möglich, max. 20 MB pro Datei, kein OCR
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          disabled={isPending}
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      <label htmlFor="upload-visibility" style={{ marginTop: '0.75rem' }}>Sichtbarkeit für hochgeladene Dateien</label>
      <select
        id="upload-visibility"
        value={visibility}
        onChange={(e) => setVisibility(e.target.value)}
        disabled={isPending}
      >
        <option value="open">open — alle Rollen</option>
        <option value="restricted">restricted — nur berechtigte Rollen</option>
        <option value="confidential">confidential — nur berechtigte Rollen</option>
      </select>

      {items.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.75rem' }}>
          {items.map((it, i) => (
            <li key={`${it.fileName}-${i}`} style={{ padding: '0.3rem 0', borderTop: '1px solid #eceef2' }}>
              <span className="mono" style={{ fontSize: '0.85rem' }}>{it.fileName}</span>{' '}
              {it.status === 'pending' ? (
                <span className="muted">wartet…</span>
              ) : it.status === 'uploading' ? (
                <span className="chip chip--indigo">wird ingestiert…</span>
              ) : it.ok ? (
                <span className="chip chip--green">
                  ✓ {it.chunkCount} Chunks · {it.format}
                  {it.pageCount != null ? ` · ${it.pageCount} Seiten` : ''}
                  {it.wordCount != null ? ` · ${it.wordCount} Wörter` : ''}
                </span>
              ) : (
                <span className="chip chip--red">✗ {it.error}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
