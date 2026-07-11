import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth-context';
import { getArtifact, getArtifactContent } from '@/lib/artifacts';
import { isUuid } from '@/lib/uuid';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await requireTenant();
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const artifact = await getArtifact(orgId, id);
  if (!artifact) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const content = await getArtifactContent(orgId, id);
  if (!content) {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 });
  }

  const filename = `${artifact.title.replace(/[^a-zA-Z0-9_\- ]/g, '_')}.${extensionFor(artifact.contentType)}`;

  return new NextResponse(Buffer.from(content.bytes), {
    headers: {
      'Content-Type': content.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(content.bytes.length),
    },
  });
}

function extensionFor(contentType: string): string {
  if (contentType.includes('markdown')) return 'md';
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('json')) return 'json';
  return 'bin';
}
