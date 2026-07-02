// Slack slash-command endpoint (/ergane). PUBLIC route, signature-verified —
// see src/lib/slack/handlers.ts.
import { handleSlackCommands } from '@/lib/slack/handlers';

export const POST = handleSlackCommands;
