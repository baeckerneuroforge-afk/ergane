// Prisma-CLI-Konfiguration — ersetzt den deprecated package.json#prisma-Block.
//
// WICHTIG: Sobald diese Datei existiert, lädt die Prisma-CLI .env NICHT mehr
// automatisch — der dotenv-Import übernimmt das (no-op, wenn die Variablen
// schon gesetzt sind, z. B. in CI/Vercel).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
