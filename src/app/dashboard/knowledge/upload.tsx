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
import { useDict } from '@/lib/i18n/client';
import { ingestUpload, type UploadFileResult } from './actions';

const ACCEPT = '.pdf,.docx,.md,.txt';

type ItemState =
  | { status: 'pending'; fileName: string }
  | { status: 'uploading'; fileName: string }
  | ({ status: 'done' } & UploadFileResult);

export function UploadDropzone() {
  const router = useRouter();
  const t = useDict();
  const k = t.knowledge;
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
          result = { fileName: list[i].name, ok: false, error: k.upload.transferFailed };
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
        aria-label={k.upload.dropzoneAria}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`dropzone${dragOver ? ' dropzone--over' : ''}${isPending ? ' dropzone--busy' : ''}`}
      >
        <strong>{k.upload.dropHere}</strong> {k.upload.orClick}
        <div className="muted" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
          {k.upload.constraints}
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

      <label htmlFor="upload-visibility" style={{ marginTop: '0.75rem' }}>{k.upload.visibilityLabel}</label>
      <select
        id="upload-visibility"
        value={visibility}
        onChange={(e) => setVisibility(e.target.value)}
        disabled={isPending}
      >
        <option value="open">{k.visibilityOpen}</option>
        <option value="restricted">{k.visibilityRestricted}</option>
        <option value="confidential">{k.visibilityConfidential}</option>
      </select>

      {items.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.75rem' }}>
          {items.map((it, i) => (
            <li key={`${it.fileName}-${i}`} style={{ padding: '0.3rem 0', borderTop: '1px solid #eceef2' }}>
              <span className="mono" style={{ fontSize: '0.85rem' }}>{it.fileName}</span>{' '}
              {it.status === 'pending' ? (
                <span className="muted">{k.upload.waiting}</span>
              ) : it.status === 'uploading' ? (
                <span className="chip chip--indigo">{k.upload.ingesting}</span>
              ) : it.ok ? (
                <span className="chip chip--green">
                  ✓ {it.chunkCount} {k.chunks} · {it.format}
                  {it.pageCount != null ? ` · ${k.pages(it.pageCount)}` : ''}
                  {it.wordCount != null ? ` · ${k.words(it.wordCount)}` : ''}
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
