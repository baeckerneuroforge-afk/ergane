// Linear webhooks — public (no Clerk). Authenticated via Linear-Signature.
import { handleLinearWebhook } from '@/lib/connectors/linear';

export const POST = handleLinearWebhook;
