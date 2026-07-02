// Slack interactivity endpoint (Block Kit buttons: Freigeben / Ablehnen).
// PUBLIC route, signature-verified — see src/lib/slack/handlers.ts.
import { handleSlackInteractions } from '@/lib/slack/handlers';

export const POST = handleSlackInteractions;
