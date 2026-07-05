// GET /api/cron/loop — periodic process-metric check (Vercel Cron, vercel.json).
//
// PUBLIC route (middleware exemption '/api/cron(.*)') with its own auth, exactly
// like /api/cron/retention: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
// automatically when the env var is set. Fail-closed:
//   CRON_SECRET not set   → 503 (the tick NEVER runs unauthenticated)
//   header missing/wrong  → 401
// The response carries only counters — no tenant data, no error detail (those go
// to the log/audit). The actual work (per-org tx, metrics, deduped flags) lives
// in runLoopTick() so it stays testable and the route stays thin.
import { runLoopTick } from '@/lib/loop/tick';
import { logError, logInfo } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'cron not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runLoopTick();
    logInfo('loop tick finished', { ...result });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logError('loop tick failed', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
