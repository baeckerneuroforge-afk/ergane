import type { Metadata } from 'next';
import { PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Imprint — helix.ai' };

/**
 * Pilot-stage legal page: no invented firm identity, no yellow placeholders.
 * Full imprint text is filled when incorporation data is ready.
 */
export default function ImprintPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Imprint</h1>
        <p>
          <strong>helix.ai</strong> is operated in pilot stage by Hephaistos Systems
          (Germany). Formal imprint details (legal entity name, registered address,
          commercial register) will be published here before general availability.
        </p>
        <p>
          Contact for pilots and product questions:{' '}
          <a href="mailto:pilot@helix.ai">pilot@helix.ai</a>
        </p>
        <p className="muted">
          Hosting region: EU (Frankfurt). This page intentionally omits incomplete
          registry placeholders.
        </p>
      </article>
    </PublicShell>
  );
}
