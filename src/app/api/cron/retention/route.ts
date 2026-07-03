// GET /api/cron/retention — nightly retention sweep (Vercel Cron, vercel.json).
//
// PUBLIC route (middleware exemption) mit eigenem Auth, gleiches Muster wie
// die Slack-/Clerk-Webhooks: Vercel Cron sendet `Authorization: Bearer
// $CRON_SECRET` automatisch mit, wenn die Env-Variable im Projekt gesetzt ist.
// Fail-closed:
//   CRON_SECRET nicht gesetzt  → 503 (der Sweep läuft NIE unauthentifiziert)
//   Header fehlt/falsch        → 401
// Die Antwort trägt nur Zählwerte — keine Tenant-Daten, keine Fehlerdetails
// (die stehen im Log/Audit).
import { runRetentionSweep } from '@/lib/lifecycle';
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
    const result = await runRetentionSweep();
    logInfo('retention sweep finished', result);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logError('retention sweep failed', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
