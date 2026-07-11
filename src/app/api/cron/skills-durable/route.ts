// GET /api/cron/skills-durable — advance open durable skill runs one step each.
//
// PUBLIC route (middleware exemption '/api/cron(.*)') with CRON_SECRET auth,
// same pattern as retention/loop. Response is counters only — no tenant data.
import { cronSecretMatches } from '@/lib/cron-auth';
import { logError, logInfo } from '@/lib/log';
import { runDurableTick } from '@/lib/skills/durable-tick';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'cron not configured' }, { status: 503 });
  }
  if (!cronSecretMatches(req.headers.get('authorization'), secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runDurableTick();
    logInfo('durable skill tick finished', { ...result });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logError('durable skill tick failed', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
