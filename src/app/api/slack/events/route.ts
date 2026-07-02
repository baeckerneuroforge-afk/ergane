// Slack Events API endpoint. PUBLIC route (no Clerk session — Slack is the
// caller), but every request is authenticated by its Slack signature and then
// mapped team → org before anything runs. See src/lib/slack/handlers.ts.
import { handleSlackEvents } from '@/lib/slack/handlers';

export const POST = handleSlackEvents;
