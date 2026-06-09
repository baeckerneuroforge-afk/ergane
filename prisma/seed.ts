// Demo seed for `pnpm db:seed`.
//
// In production, organizations are created via Clerk and mirrored on first use
// (see src/lib/org.ts). This seed just creates two demo tenants so you can SEE
// isolation in psql / Prisma Studio without going through the UI.
//
// It is intentionally written the SAME way the app writes data: org rows are
// upserted directly (organizations has no RLS), and all tenant-scoped writes go
// through withTenant() — never the bare client.
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { logAudit } from '../src/lib/audit';

// Fixed UUIDs so the seed is idempotent.
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

async function seedOrg(id: string, clerkOrgId: string, name: string) {
  await prisma.organization.upsert({
    where: { id },
    create: { id, clerkOrgId, name },
    update: { name },
  });

  await withTenant(id, async (tx) => {
    const item = await tx.knowledgeItem.create({
      data: {
        orgId: id,
        title: `Welcome to ${name}`,
        body: `This knowledge item belongs to ${name} and is visible to ${name} only.`,
      },
    });
    await logAudit(tx, {
      orgId: id,
      actorId: 'seed',
      actorType: 'agent',
      action: 'knowledge_item.create',
      target: item.id,
    });
  });
}

async function main() {
  await seedOrg(ORG_A, 'demo_org_a', 'Demo Org A');
  await seedOrg(ORG_B, 'demo_org_b', 'Demo Org B');
  console.log('Seeded 2 demo organizations, each with 1 knowledge item + audit entry.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
