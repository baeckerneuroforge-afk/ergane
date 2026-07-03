import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { withTenant } from '@/lib/tenant';
import { VisibilityBadge, formatDateTime } from '../ui';
import { addDocument, changeVisibility, reingestUpload, removeDocument } from './actions';
import { UploadDropzone } from './upload';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const { orgId, role } = await requireTenant();
  const { locale, t } = await getI18n();
  const k = t.knowledge;
  const isAdmin = role === 'admin' || role === 'owner';

  // Every tenant read goes through withTenant — RLS scopes this to `orgId`.
  const documents = await withTenant(orgId, (tx) =>
    tx.document.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    }),
  );

  return (
    <>
      <p className="page-intro">
        {k.intro} <Link href="/dashboard/chat">{k.introChatLink}</Link> {k.introSuffix}
      </p>

      <section className="card">
        <h2>{k.uploadTitle}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {k.uploadHint}
        </p>
        <UploadDropzone />
      </section>

      <section className="card">
        <h2>{k.manualTitle}</h2>
        <form action={addDocument}>
          <label htmlFor="title">{k.titleLabel}</label>
          <input id="title" name="title" placeholder={k.titlePlaceholder} required />
          <label htmlFor="text">{k.textLabel}</label>
          <textarea id="text" name="text" rows={5} placeholder={k.textPlaceholder} />
          <label htmlFor="visibility">{k.visibilityLabel}</label>
          <select id="visibility" name="visibility" defaultValue="open">
            <option value="open">{k.visibilityOpen}</option>
            <option value="restricted">{k.visibilityRestricted}</option>
            <option value="confidential">{k.visibilityConfidential}</option>
          </select>
          <button type="submit" className="btn btn--primary">
            {k.ingest}
          </button>
        </form>
      </section>

      <section className="card card--table">
        <div className="card-title">
          <h2>{k.documentsTitle}</h2>
          <span className="row-meta">{k.entryCount(documents.length)}</span>
        </div>
        {documents.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>
            {k.noDocuments}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.title}</th>
                <th>{t.common.format}</th>
                <th>{t.common.visibility}</th>
                <th>{t.common.date}</th>
                <th>{k.chunks}</th>
                {isAdmin ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div className="row-meta">{doc.source}</div>
                  </td>
                  <td>
                    <span className="chip chip--gray">{doc.sourceFormat ?? 'text'}</span>
                    <div className="row-meta">
                      {doc.pageCount != null ? `${k.pages(doc.pageCount)} · ` : ''}
                      {doc.wordCount != null ? k.words(doc.wordCount) : '—'}
                    </div>
                  </td>
                  <td>
                    <VisibilityBadge visibility={doc.visibility} />
                    {isAdmin ? (
                      <form
                        action={changeVisibility}
                        style={{ display: 'inline-block', marginLeft: '0.5rem' }}
                      >
                        <input type="hidden" name="documentId" value={doc.id} />
                        <select
                          name="visibility"
                          defaultValue={doc.visibility}
                          className="select--inline"
                        >
                          <option value="open">open</option>
                          <option value="restricted">restricted</option>
                          <option value="confidential">confidential</option>
                        </select>{' '}
                        <button type="submit" className="btn btn--ghost select--inline">
                          {t.common.change}
                        </button>
                      </form>
                    ) : null}
                  </td>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(doc.createdAt, locale)}
                  </td>
                  <td className="mono">{doc._count.chunks}</td>
                  {isAdmin ? (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <form
                        action={async (formData: FormData) => {
                          'use server';
                          await reingestUpload(formData);
                        }}
                        style={{ display: 'inline-block', marginRight: '0.5rem' }}
                      >
                        <input type="hidden" name="documentId" value={doc.id} />
                        <input type="hidden" name="title" value={doc.title} />
                        <input
                          type="file"
                          name="file"
                          accept=".pdf,.docx,.md,.txt"
                          className="select--inline"
                          style={{ maxWidth: '11rem' }}
                          aria-label={k.newVersionAria(doc.title)}
                        />
                        <button
                          type="submit"
                          className="btn btn--ghost select--inline"
                          title={k.newVersionTitle}
                        >
                          {k.newVersion}
                        </button>
                      </form>
                      <form action={removeDocument} style={{ display: 'inline-block' }}>
                        <input type="hidden" name="documentId" value={doc.id} />
                        <button
                          type="submit"
                          className="btn btn--ghost select--inline"
                          title={k.deleteTitle}
                        >
                          {t.common.delete}
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
