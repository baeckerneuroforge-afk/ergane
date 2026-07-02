// Clerk webhook endpoint. PUBLIC route (Clerk/Svix is the caller — no
// session), authenticated per request via the Svix signature. See
// src/lib/clerk/webhooks.ts for the fail-closed sequence.
import { handleClerkWebhook } from '@/lib/clerk/webhooks';

export const POST = handleClerkWebhook;
