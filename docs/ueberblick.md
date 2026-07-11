# helix — Technische Übersicht: Was wirklich gebaut ist

**Stand:** 2026-07-11 · **Zweck:** Ehrliche Bestandsaufnahme des Codestands für YC-Partner und potenzielle Pilotkunden.

> Diese Übersicht beschreibt **ausschließlich, was im Code tatsächlich vorhanden ist** — jede Angabe ist am
> Quellcode verifiziert (Datei- und Zeilennachweise inline). Der Zukunfts-Ausblick ist als solcher
> gekennzeichnet und verweist auf den [OS-Bauplan](helix-os-bauplan-us.md). Keine „Certified"-Sprache, keine
> Übertreibung: was steht, steht; was Vision ist, heißt Vision.

---

## Was helix ist

helix ist ein **Company Brain, das handelt** — die durchgehende Verarbeitungsschicht einer Firma:
Input → Kern → Output. Konkret und heute im Code:

- **Kern (gebaut):** eine tenant-isolierte Wissensbasis mit semantischer Suche und einem RAG-Chat, der
  **nur mit Quellen** antwortet; eine deterministische **Skill-Engine** mit Leitplanke, menschlicher Freigabe
  und lückenlosem Audit; konfigurierbare **Governance** (wann Freigabe nötig ist, wer welches Wissen sieht);
  **Clients** (Kunden-Entität) und **Artifacts** (versionierte Deliverables im privaten Blob-Store);
  der **Loop** über Deliverables und Prozess-Metriken (Flags, Vorschläge, optional auto-correct).
- **Input (gebaut, ein zweiter Kanal):** Slack als externer Eingang — Fragen stellen, Skills anstoßen,
  Freigaben per Button erteilen.
- **Output (gebaut, erster generativer Beweis):** `transkript_zu_framework` — der erste Skill, der ein LLM
  aufruft und ein **neues Deliverable** (ein strukturiertes Framework aus Kundengespräch-Transkripten)
  entwirft, hinter dem bestehenden Freigabe-Gate, und als **Artifact** persistiert.

Die vollständige Vision (kontinuierliche Tool-Anbindung, durable Langläufe, Loop-Quelle Tool-Artefakte) ist im
[OS-Bauplan](helix-os-bauplan-us.md) beschrieben. **Diese Seite trennt strikt: gebaut vs. geplant.**

Die **Fähigkeit** ist das Verkaufsargument (Company Brain → sichere, ausführbare Skills → Freigabe-Loop),
die Sicherheits-Substanz ist **enterprise-grade** — dieselbe Substanz, die ein B2B-Käufer erwartet.

---

## Stack (verifiziert)

| Schicht | Wahl | Nachweis |
|---|---|---|
| Framework | Next.js 15 (App Router), React 19 | `package.json:34-35` |
| Sprache / Typen | TypeScript, `tsc --noEmit` als Typecheck | `package.json` (`typecheck`-Script) |
| DB / ORM | PostgreSQL + Prisma 6 | `package.json:30,48` · `prisma/schema.prisma` |
| Vektorsuche | pgvector, `vector(1024)`, HNSW-Index, Cosine (`<=>`) | `src/lib/ai/types.ts:8-14` · `src/lib/rag/retrieve.ts` |
| LLM | Anthropic Messages API, Default `claude-opus-4-8` | `src/lib/ai/anthropic.ts:10` |
| Embeddings | Voyage `voyage-3.5`, 1024 Dim (Anthropics Embeddings-Partner) | `src/lib/ai/voyage.ts:12-15` |
| Auth / Orgs | Clerk (Organizations + RBAC) | `package.json:28` · `src/middleware.ts` |
| Tests | Vitest (Unit/Integration) + Playwright (E2E-Smoke) | `package.json:51,44` |

**Provider-Abstraktion:** LLM und Embeddings werden ausschließlich über zwei Interfaces konsumiert
(`ChatProvider`, `EmbeddingProvider`, `src/lib/ai/`). In dev/test laufen deterministische **Fake-Adapter**
(offline, keine Netzwerk-Calls); in Produktion **wirft** der Code, statt still zu faken. Der Vendor ist an
genau einer Stelle wählbar (`src/lib/ai/index.ts`).

---

## Architektur-Highlights (jedes am Code belegt)

### 1 — Mandantentrennung: RLS + FORCE, in der Datenbank erzwungen

Die tragende Eigenschaft. Tenant-Trennung wird **von PostgreSQL** durchgesetzt, nicht von Anwendungs-Disziplin.
Selbst eine fehlerhafte Query oder ein vergessenes `WHERE org_id = …` kann keine fremden Daten leaken, weil
die App als Rolle verbindet, die fremde Zeilen physisch nicht sehen kann.

- **17 mandantengebundene Tabellen**, **jede** mit `ENABLE` **und** `FORCE` Row-Level-Security. `FORCE` lässt
  die Policy sogar für den Tabellen-Owner greifen. Verifiziert über alle Migrationen hinweg
  (`0001_init` … `0013_chat_feedback`).
- **Policy-Prädikat überall identisch, fail-closed:**
  ```sql
  org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  ```
  Ohne gesetzten Kontext ⇒ `NULL` ⇒ **null Zeilen** — deterministisch, nie ein Leak, nie ein Fehler.
- **Der einzige Zugangsweg:** `withTenant(orgId, tx => …)` (`src/lib/tenant.ts:34-55`) öffnet eine Transaktion
  und bindet den Tenant als erste Anweisung transaktionslokal
  (`set_config('app.current_org', $orgId, true)`, `tenant.ts:50`) — als **Bind-Parameter**, UUID-validiert,
  keine Injection-Fläche.
- **Zwei Rollen, zwei Privilegien:** die App (und die Tests) verbinden als `app_user`
  (`NOSUPERUSER NOBYPASSRLS`, **nie** Owner); nur Migrationen laufen als Owner
  (`docker/postgres/init/01-app-user.sql`).

**Wichtiger Ehrlichkeits-Hinweis:** „prod-verified" bezieht sich auf den **Mechanismus**, der im Code und
durch das CI-Gate (unten) nachweisbar ist. Ein wörtlicher Produktions-Nachweis ist kein Artefakt, das im
Repo liegen kann — es ist eine Deployment-Aussage, kein Code-Beleg.

### 2 — Ausführungs-Timeout schützt das Bestehende

`withTenant` erzwingt ein **15-Sekunden-Transaktions-Timeout** (`src/lib/tenant.ts:53`). Das ist bewusst:
ein langer LLM- oder Tool-Call in einer offenen Tenant-Transaktion würde eine DB-Connection minutenlang
pinnen und unter Last den Pool erschöpfen — was auch die kurzen, laufenden Skills träfe. Die Regel „nie ein
LLM-Call innerhalb einer `withTenant`-Transaktion" ist deshalb strukturell verankert (siehe Skill-Engine).

### 3 — Governance: Guardrail → Freigabe → Audit

Der Mechanismus, der helix vom Chatbot zum kontrollierten Orchestrator macht.

- **Einstellbare Autonomie:** Approval-Policies pro Skill mit den drei Modi `always | threshold | never`
  (Enum `prisma/schema.prisma:29-35`). Auflösung im Engine-Gate (`src/lib/skills/engine.ts:251-321`):
  Freigabe-Vorhanden → `always` → `threshold` (Betrag ≥ Schwelle; **unbestimmbar ⇒ Freigabe**, fail-closed).
- **Geld-Failsafe (nicht abschaltbar, doppelt abgesichert):** `never` auf einem geld-behaftenden Skill wird
  **zur Laufzeit** ignoriert (`engine.ts:296-317`, Audit `policy.overridden_failsafe`) **und** schon
  **beim Schreiben** einer Policy zurück auf `always` korrigiert
  (`enforceMoneyFailsafe`, `src/lib/policies/governance.ts:213-230`). Ein geld-Skill ohne Guardrail
  verlangt zudem per Default immer Freigabe.
- **Vier-Augen-Mechanik:** Ein Run, dessen Guardrail griff, erreicht `completed` nur über eine menschliche
  `approve()`-Entscheidung mit ausreichender Rolle (`decide()`, `engine.ts:161-223`).
- **Industry-Presets:** vordefinierte Governance-Profile (`kanzlei`, `gesundheitswesen`, `handwerk`) als
  reine Daten (`src/lib/policies/presets.ts`), portabel als JSON exportier-/importierbar — der Geld-Failsafe
  ist auch hier eingebacken.

### 4 — Audit-Log: append-only, dreifach durchgesetzt

Jede governance-relevante Aktion landet im `audit_log` (`src/lib/audit.ts`), tenant-scoped (RLS **+**
explizites `orgId`), actor-typisiert (`human` vs. `agent`). **Append-only** ist auf drei Ebenen erzwungen
(alle in `0001_init/migration.sql`): keine `UPDATE`/`DELETE`-Policy, kein `UPDATE`/`DELETE`-Privileg für
`app_user`, **und** ein Trigger, der bei jedem Änderungsversuch eine Exception wirft — selbst der Owner kann
Historie nicht still umschreiben. Der Audit-Eintrag wird in **derselben** Transaktion geschrieben wie die
Änderung, die er protokolliert.

### 5 — Verschlüsselte Token (AES-256-GCM)

Externe Tokens werden mit **AES-256-GCM** verschlüsselt (`src/lib/crypto.ts:14`): 12-Byte-Zufalls-IV,
Auth-Tag, Manipulation wirft beim Entschlüsseln. Der 32-Byte-Schlüssel kommt aus einer Umgebungsvariable;
der Code ist so gebaut, dass ein späterer KMS/Vault nur dieses Modul ersetzt. Tokens stehen nie im Klartext
oder Log.

### 6 — Wissensbasis / RAG (mit Quellen, strukturell hallzinationsarm)

- **Ingestion** (`src/lib/rag/ingest.ts`): absatz-bewusstes Chunking → Embedding **außerhalb** jeder
  Transaktion → dann Dokument + Chunks + Audit in **einer** kurzen `withTenant`-Transaktion. Uploads
  (PDF/DOCX/MD/TXT) laufen durch einen Extraktions-Layer; gescannte PDFs ohne Textebene werden abgelehnt
  (fail-closed) oder — wenn ein OCR-Provider konfiguriert ist — via Claude-Vision transkribiert.
- **Retrieval** (`src/lib/rag/retrieve.ts`): Cosine-Top-k über pgvector, **plus** ein Disclosure-Filter
  **in SQL, vor jedem LLM-Kontakt** (fail-closed: unbekannte Rolle ⇒ nur `open`-Wissen).
- **Antwort** (`src/lib/rag/answer.ts`): unter der Relevanz-Schwelle ⇒ **kein LLM-Call**, sondern eine
  ehrliche „Dazu habe ich kein geprüftes Wissen"-Antwort ohne Quellen — Halluzination wird strukturell
  verhindert. Andernfalls bekommt das LLM **nur** die abgerufenen Passagen; Quellen = die genutzten
  Dokumenttitel.
- **Erklärbarkeit:** jede Antwort trägt einen **Answer-Trace** (`chat_messages.trace`, Migration `0021`) —
  welche Quelle welche Aussage stützt, ohne für die Rolle unsichtbares Wissen preiszugeben.
- **Dokument-Sichtbarkeit:** `open | restricted | confidential` mit rollenbasierten Grants. (Präzision: die
  `visibility`-Spalte kommt in Migration **0004**, nicht 0002 — die `documents`-Tabelle selbst in 0002.)

### 7 — Skill-Engine: deterministisch, mit sanktioniertem generativem Pfad

Ein Skill ist **Daten, kein Code-Sonderfall** (`SkillDef`/`StepDef`, `src/lib/skills/types.ts`). Die Engine
kennt keine Sonderpfade; sie führt Steps atomar aus (Step-Effekt + `skill_steps`-Zeile + Audit in einer
Transaktion), pausiert bei ausgelöster Guardrail auf `awaiting_approval` und läuft nach Freigabe weiter.

- **Request-übergreifender Resume:** `approve()`/`reject()` sind eigene Eintrittspunkte, die den State aus
  persistierten `skill_steps` rekonstruieren und ab dem nächsten Step fortsetzen — ein Lauf kann in einem
  **späteren, getrennten Request** weiterlaufen (z. B. über den Slack-Freigabe-Pfad). `engine.ts:135-155`.
- **Dry-run / Probelauf:** ein Simulations-Modus geht jeden Step durch, ohne je zu handeln oder zu pausieren.
- **Effekt-Grenze:** Effekte laufen **nur** in handelnden Steps, **strikt nach** dem Guardrail/Approval-Gate
  (`src/lib/effects/types.ts:4-7`) — ein Effekt-Provider hat keinen Weg, ohne freigegebenen Step zu laufen.
- **Der generative Pfad (die eine Neuerung, ohne die Timeout-Regel zu brechen):** `StepDef` hat einen
  optionalen **`prepare`-Hook**, der **vor** `withTenant()` mit einem **transaktionsfreien** Kontext läuft
  (`types.ts:31-37,56-77`). Der teure LLM-Call passiert dort; die anschließende kurze `withTenant`-Transaktion
  schreibt **nur** das vorab berechnete Ergebnis (`engine.ts:387-411`). So ruft `transkript_zu_framework` ein
  LLM auf, ohne je einen Netzwerk-Call in eine offene Tenant-Transaktion zu legen.

### 8 — Slack als zweiter Eingang (fail-closed an jeder Stufe)

Slack kommt **ohne** Clerk-Session herein, daher eine harte Gate-Sequenz (`src/lib/slack/`): Signatur-Prüfung
(sonst 401) → Team→Org-Auflösung über `slack_installations` (sonst 403) → User→Rolle über `slack_user_links`
(Rolle live gelesen) → Handeln über die **bestehenden** Funktionen (`answerQuestion`, `startRun`,
`approve`/`reject`). **ack-then-work** (200 vor der eigentlichen Arbeit) plus **Idempotenz-Claim** pro Tenant
verhindern Doppelverarbeitung bei Slack-Re-Deliveries. Alles läuft ab der Team-Auflösung durch `withTenant`.

### 9 — Clients, Artifacts, privater Blob-Store (gebaut)

- **Clients** (`prisma/schema.prisma` · `src/lib/clients.ts` · Dashboard `/dashboard/clients`): tenant-scoped
  Kunden-Entität mit Name/Notes; Runs und Artifacts können per Composite-FK an einen Client gebunden werden.
- **Artifacts** (`src/lib/artifacts.ts` · `/dashboard/deliverables`): Metadaten (Typ, Version, slug, clientId,
  runId) + `blobKey`; Download nur über RLS-gesicherte App-Route
  (`/api/artifacts/[id]/download`) — Bytes werden serverseitig gestreamt, nie als öffentliche Capability-URL.
- **Private Blobs** (`src/lib/storage/blob.ts`): Vercel Blob mit `access: 'private'`; Fake-Provider für Tests.
- **Client-Memory** (`src/lib/memory/history.ts`): prior runs + latest deliverable-Inhalte für Skill-`prepare()`
  (Blob-Reads **außerhalb** der Tenant-Tx).

### 10 — Loop über Deliverables (gebaut; Tool-Quelle noch nicht)

- **ObservationSource** (`src/lib/loop/sources/`): Phase-1-Quelle `DeliverableSource` liest Artifacts.
- **Kriterien + Metriken** (`criteria/`, `metrics.ts`, `evaluate.ts`): deterministische Soll-Prüfung, kein LLM-Richter.
- **Flags** als Audit-Einträge; **Suggest** / **Autonomous** (`settings.ts`, `auto-correct.ts`) mit Tageslimit.
- **Cron** `/api/cron/loop` (siehe `vercel.json`).
- **Noch nicht:** Tool-Artefakt-Quelle und schreibende Konnektoren (bewusst Roadmap / WIP).

### 11 — `prepare()`-Hook der Skill-Engine (gebaut)

Teure Arbeit (LLM, Embeddings, externe Reads) läuft im optionalen **`StepDef.prepare`** **vor** `withTenant()`
(`src/lib/skills/types.ts`, `engine.ts`). `run()` schreibt nur das vorbereitete Ergebnis in einer kurzen Tx.
Genutzt u. a. von `transkript_zu_framework` und `wissen_zusammenfassen` (Embedding vor Tx).

---

## Die Skills, die tatsächlich existieren (5)

Registriert in `src/lib/skills/catalog/index.ts`:

| Skill | Art | Freigabe (ohne Policy) | Nachweis |
|---|---|---|---|
| `beleg_kontieren` | handelt, Geld | ab Betrag > 1.000 € | `catalog/beleg_kontieren.ts` |
| `rechnung_erstellen` | handelt, Geld | ab Summe > 1.000 € | `catalog/rechnung_erstellen.ts` |
| `angebot_erstellen` | handelt (Versand) | **immer** (externe Kommunikation) | `catalog/angebot_erstellen.ts` |
| `wissen_zusammenfassen` | liest nur | nie (läuft direkt durch) | `catalog/wissen_zusammenfassen.ts` |
| `transkript_zu_framework` | **generativ (LLM)** | **immer** (neues Deliverable) | `catalog/transkript_zu_framework.ts` |

`transkript_zu_framework` ist der **erste generative Deliverable-Skill** (Etappe 1 des OS-Plans, PR #46): Er
liest Transkripte + Kontext aus der Wissensbasis, entwirft im `prepare`-Hook per LLM ein strukturiertes
Framework, und pausiert vor der Finalisierung für menschliche Freigabe. Die vier übrigen Skills sind bewusst
**deterministisch** (z. B. `beleg_kontieren` mit einer statischen SKR03-Regeltabelle — läuft offline).

**Ehrliche Grenze:** Die schreibenden Effekte der handelnden Skills (DATEV-Buchung, E-Mail-Versand) sind in
diesem Stand **simuliert** bzw. hinter Fake-Providern — genug für den End-to-End-Beweis von
Guardrail → Freigabe → Audit, aber (außer E-Mail/PDF via echtem Provider) noch keine Live-Außenwirkung in
Drittsysteme.

---

## Reife-Signale (nachgezählt)

| Signal | Wert | Nachweis |
|---|---|---|
| Test-Dateien | **40+** in `tests/` + **1** Playwright-E2E (`e2e/smoke.spec.ts`) | `tests/*.test.ts` |
| DB-Migrationen | **29** (`0001_init` … `0029_assert_app_user_hardening`), streng additiv, per Checkliste | `prisma/migrations/` |
| CI-Gate | ein Job **„Tenant isolation gate"** auf jeden Push/PR | `.github/workflows/ci.yml` |

**Das CI-Gate ist die Kern-Disziplin:** Es startet ein echtes `pgvector/pgvector:pg16`, legt die
**least-privileged** Rolle `app_user` an, wendet die Migrationen als Owner an und lässt dann die **gesamte
Test-Suite als `app_user`** laufen — also mit realer RLS. Bricht die Mandantentrennung je, wird CI rot.

**Der Beweis-Kern** ist `tests/isolation.test.ts` (die selbst-deklarierte „wichtigste Datei im Repo"): u. a.
dass Tenant A nie B's Zeilen sieht, dass ein Insert mit fremdem `org_id` am `WITH CHECK` scheitert, dass eine
Query **ohne** Kontext **0 Zeilen** liefert, und dass `app_user` RLS nicht umgehen kann (kein Superuser, kein
`BYPASSRLS`, kann RLS nicht deaktivieren, kann Audit-Zeilen nicht löschen). Ein `beforeAll` **verweigert den
Lauf**, wenn nicht als machtlose `app_user`-Rolle verbunden — das Gate kann nicht über eine privilegierte
Abkürzung „grün" werden. Ergänzt durch tenant-spezifische Gates (`rag-isolation`, `skill-isolation`,
`demo-isolation`, `security`, `hardening` u. a.).

**Migrations-Disziplin:** Neue Tenant-Tabellen folgen einer festen Checkliste (`org_id NOT NULL` + FK, RLS
ENABLE+FORCE, Isolations-Policy, minimale Grants, Zugriff nur über `withTenant`, Aufnahme ins Gate). Die
README dokumentiert sie als „the most important section".

---

## Gebaut vs. Vision — die ehrliche Trennlinie

**Gebaut und im Code nachweisbar (diese Seite):**
Mandantentrennung (RLS+FORCE), 15s-Failsafe, Governance mit Geld-Failsafe + Presets, append-only Audit,
AES-256-GCM-Token, RAG mit Quellen + Answer-Trace + Disclosure-Filter, deterministische Skill-Engine mit
`prepare()`-Hook, request-übergreifendem Resume und sanktioniertem generativem Pfad, Slack als zweiter Eingang,
Clients + Artifacts + **private** Blobs, Client-Memory, Loop über Deliverables (Kriterien, Metriken, Flags,
Suggest/Autonomous), der erste generative Deliverable-Skill, ein hartes CI-Isolations-Gate.

**Vision / Roadmap (im [OS-Bauplan](helix-os-bauplan-us.md), noch nicht gebaut):**
request-übergreifende **durable** Ausführung (Queue/Worker) · Multi-Checkpoint-Approvals ·
kontinuierliche, lesende **Tool-Anbindung** (Linear/GitHub/Google) mit Dedup und fail-closed-Sichtbarkeit ·
Loop-Quelle 2 (Tool-Artefakte) · **schreibende** Tool-Aktionen hinter checkpoint-gebundenen Approvals.

**Bewusst NICHT jetzt (im Plan festgehalten):** kein autonomer Qualitäts-Regelkreis, kein LLM als Richter
über inhaltliche Qualität. Der Loop prüft deterministisch und meldet; Nachjustieren bleibt (Default) beim Menschen.

---

## Weiterlesen

- **Tiefe Engineering-Referenz (phasenweise, mit jedem Trade-off):** [`README.md`](../README.md) — der
  vollständige Bauverlauf von Phase 0 bis heute, inklusive der Checkliste für neue Tenant-Tabellen.
- **Vision & Roadmap:** [`docs/helix-os-bauplan-us.md`](helix-os-bauplan-us.md) — die Landkarte der vier Blöcke
  (Input → Kern → Output → Loop) und der gestufte Etappenplan.
