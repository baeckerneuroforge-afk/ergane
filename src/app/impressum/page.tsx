import type { Metadata } from 'next';
import { PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Impressum — helix.ai' };

/** DE pilot-stage imprint — no invented company registry fields. */
export default function ImpressumPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Impressum</h1>
        <p>
          <strong>helix.ai</strong> wird in der Pilotphase von Hephaistos Systems
          (Deutschland) betrieben. Vollständige Angaben nach § 5 TMG (Firma,
          Anschrift, Register) werden vor dem öffentlichen Produktivbetrieb hier
          ergänzt.
        </p>
        <p>
          Kontakt für Pilots und Produktfragen:{' '}
          <a href="mailto:pilot@helix.ai">pilot@helix.ai</a>
        </p>
        <p className="muted">
          Hosting-Region: EU (Frankfurt). Diese Seite enthält bewusst keine
          unvollständigen Platzhalter-Felder.
        </p>
      </article>
    </PublicShell>
  );
}
