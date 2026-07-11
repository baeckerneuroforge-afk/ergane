# Loop-Implementierungsplan (Block 4 des OS)

**Stand:** 2026-07-05 · **Art:** Planung, kein Code · **Bezug:** helix-os-bauplan-us.md, Teil G

---

## Zusammenfassung

Der Loop beobachtet helix-Outputs und (später) Firmen-Arbeit, vergleicht sie gegen deterministische Soll-Werte und meldet Abweichungen als Flags. Er ist **kein autonomer Regelkreis** — er ist ein Beobachtungs- und Meldesystem mit konfigurierbarer Autonomie-Stufe, das im Default nur meldet.

Architektonisch ruht der Loop auf drei Säulen:
1. **Austauschbare Beobachtungsquelle** — ein Interface, das in Phase 1 helix-Deliverables und in Phase 2 Tool-Artefakte liefert.
2. **Deterministische Soll-Prüfung** — Akzeptanzkriterien (Struktur) + Prozess-Metriken (Zahlen), kein LLM als Richter.
3. **Flags als Audit-Einträge** — im Default append-only, erst bei Bedarf als eigene Entität mit mutablem Status.

---

## 1 — Das Quell-Interface (Schlüssel für Austauschbarkeit)

### Interface-Definition (neue Datei: `src/lib/loop/sources/types.ts`)

```
ObservationSource {
  key: string                                   // z.B. 'deliverable', 'tool_artifact'
  fetchObservations(orgId, since): Observation[]
}

Observation {
  sourceKey: string           // 'deliverable' | 'tool_artifact'
  externalRef: string         // eindeutige Referenz (artifactId, ticketId, …)
  type: string                // 'framework' | 'use_case' | 'ticket' | …
  content: string | null      // Text-Inhalt (Blob-Content für Deliverables)
  metadata: Record<…>         // strukturierte Felder: version, clientId, runId, …
  createdAt: Date
}
```

### Phase-1-Quelle: `DeliverableSource` (`src/lib/loop/sources/deliverable.ts`)

- Setzt auf: `src/lib/artifacts.ts` (`listArtifacts`, `getArtifactContent`), `src/lib/storage/blob.ts` (BlobProvider).
- `fetchObservations(orgId, since)`: ruft `withTenant()` → `artifact.findMany({ createdAt: { gte: since } })`, dann Blob-Content AUSSERHALB der Tx laden (wie `getClientHistory` in `src/lib/memory/history.ts:88-110`).
- Liefert pro Artifact ein `Observation`-Objekt mit type, content (Markdown-Text), metadata (version, clientId, runId, slug).

### Phase-2-Quelle: `ToolArtifactSource` (`src/lib/loop/sources/tool_artifact.ts`)

- Setzt auf: das noch nicht gebaute `ConnectorDef`-Framework (Teil F des Bauplans) + `documents`-Tabelle mit `external_ref`.
- `fetchObservations(orgId, since)`: liest normalisierte Tool-Artefakte (Tickets, Code-Commits, Docs) aus `documents` WHERE `source IN ('ticket', 'code', 'doc')`.
- **Abhängigkeit:** setzt voraus, dass mindestens ein lesender Konnektor (z.B. Linear) existiert und `documents` mit `external_ref` + Quellentyp befüllt. Im Plan als harte Abhängigkeit markiert.

### Registrierung

Eine Registry (`src/lib/loop/sources/index.ts`) exportiert `getObservationSources(): ObservationSource[]`. Phase 1: nur `DeliverableSource`. Phase 2: `DeliverableSource` + `ToolArtifactSource`. Neue Quellen = neue Datei + Registry-Eintrag.

---

## 2 — Akzeptanzkriterien (Soll-Quelle A)

### Definition und Speicherung

**Pro Deliverable-Typ**, als Code-Preset mit optionaler Editierbarkeit:

```
AcceptanceCriterion {
  key: string           // z.B. 'min_use_cases'
  label: string         // menschenlesbar, lokalisiert
  check: (obs: Observation) → CriterionResult
}

CriterionResult {
  passed: boolean
  detail: { expected, actual, message }
}

AcceptanceCriteriaSet {
  type: string                       // z.B. 'framework'
  criteria: AcceptanceCriterion[]
}
```

**Neue Datei:** `src/lib/loop/criteria/types.ts` (Typen), `src/lib/loop/criteria/framework.ts` (Kriterien für `type='framework'`).

### Konkrete Kriterien für `transkript_zu_framework` (Phase 1)

Die Kriterien sind deterministische Funktionen über den Markdown-Text und die Observation-Metadata:

| Kriterium | Prüfung | Erwartet |
|---|---|---|
| `min_use_cases` | Zähle `##`-Überschriften, die "use case" / "Use Case" enthalten, ODER nummerierte Items unter `## Prioritized use cases` / `## Priorisierte Use Cases` | ≥ 3 |
| `has_executive_summary` | Prüfe ob `## Executive summary` / `## Executive Summary` als Heading existiert | vorhanden |
| `has_all_sections` | Prüfe ob alle 6 Sektionen aus `FRAMEWORK_SECTIONS` (`src/lib/skills/catalog/transkript_zu_framework.ts:59-62`) als `##`-Headings vorhanden sind | 6 von 6 |
| `has_sources` | Prüfe ob `Sources:` / `Quellen:` Zeile am Ende existiert UND mindestens 1 Quelle genannt ist | ≥ 1 Quelle |
| `min_length` | Markdown-Zeichenzahl (ohne Leerzeichen) | ≥ 500 Zeichen |

**Blaupause:** analog zum Answer-Trace (`src/lib/rag/answer.ts:111-122`) — dort ist `AnswerTrace.sources` der strukturierte Nachweis "welche Quelle stützt welche Aussage". Hier ist das `CriterionResult[]`-Array der strukturierte Nachweis "welches Kriterium ist erfüllt/verletzt".

### Deliverable-Trace

Am Ende eines Deliverable-Laufs (Skill-Run mit Artifact) entsteht ein **Deliverable-Trace** — analog zum Answer-Trace auf `chat_messages.trace`:

```
DeliverableTrace {
  v: 1
  artifactId: string
  type: string                    // 'framework'
  criteria: CriterionResult[]     // alle geprüften Kriterien mit passed/failed + detail
  passedCount: number
  failedCount: number
  flagRaised: boolean             // true wenn mindestens ein Kriterium verletzt
}
```

**Speicherort:** JSONB-Spalte auf `skill_runs.trace` (neue Migration, analog zu `chat_messages.trace` aus Migration 0021). NULL für Runs ohne Kriterien-Prüfung (alte Runs, nicht-Deliverable-Skills).

### Editierbare Schwellen (Phase 1: Code-Defaults, später: pro Org konfigurierbar)

Phase 1: Schwellen sind Code-Konstanten (wie `DEFAULT_MINUTES_SAVED` in `src/lib/value.ts:30-35`). Kein UI, kein Speicher.

Später (Schritt D/E): Schwellen pro Typ editierbar via `org_settings` (neues JSONB-Feld `loop_criteria_overrides`), schreibbar über den Settings-Tab "Loop" (neuer Tab, siehe §4). Admin-only, auditiert.

---

## 3 — Prozess-Metriken (Soll-Quelle B)

### Vorhandene Signale (kein neuer Code nötig für die Aggregation)

| Metrik | Quelle | Schwelle (Default) |
|---|---|---|
| `success_rate` | `computeValueStats(tx, orgId, { since }).successRate` (`src/lib/value.ts:197-273`) | ≥ 0.7 (70%) |
| `approval_rate` | `audit_log` WHERE `action IN ('approval.approved', 'approval.rejected')` — approved / total (`src/lib/audit.ts`) | ≥ 0.6 |
| `iteration_rate` | `skill_runs` WHERE `skillKey + clientId` — Läufe desselben Typs pro Kunde bis `status='completed'` | ≤ 3 |
| `feedback_negative_rate` | `chat_feedback` 👎-Rate über letzten Zeitraum | ≤ 0.15 (15%) |

### Neue Aggregationsfunktion

`src/lib/loop/metrics.ts`:

```
computeLoopMetrics(tx, orgId, { since }): LoopMetrics
```

- Läuft INNERHALB einer `withTenant()`-Tx (nur DB-Reads, schnell — keine LLM/Network-Calls).
- Nutzt `computeValueStats` für `successRate` (bereits vorhanden).
- Zählt `approval.approved` / `approval.rejected` aus `audit_log` (gleicher Query-Stil wie `queryAuditLog` in `src/lib/audit.ts:65-88`).
- Zählt Runs pro Client+Skill für `iterationRate`.
- Liefert pro Metrik: `{ key, value, threshold, passed, detail }`.

### Schwellen-Konfiguration

Wie bei Akzeptanzkriterien: Code-Defaults zuerst, später editierbar über `org_settings.loop_metric_thresholds` (JSONB).

---

## 4 — Autonomie-Stufen (Konfiguration)

### Enum und Speicherung

**Neuer Enum:** `loop_autonomy` als Postgres-Enum (Migration):
- `report` — Default. Flag + Benachrichtigung. Mensch justiert.
- `suggest` — Flag enthält Korrektur-Vorschlag. Mensch löst aus → normales Approval-Gate.
- `autonomous` — Loop startet Korrektur selbst, ABER hinter Approval-Gate + vollständig auditiert.

**Speicherung:** pro Org auf `org_settings` (wie `approval_mode` pro Org/Skill auf `approval_policies`).

Neue Spalte: `org_settings.loop_autonomy loop_autonomy NOT NULL DEFAULT 'report'`.

**Warum pro Org und nicht pro Typ/pro Kunde:** Die Autonomie-Stufe ist eine Governance-Entscheidung auf Org-Ebene — wie scharf soll der Loop eingreifen? Pro-Typ-Granularität wäre Overengineering für Phase 1. Wenn nötig, später auf `loop_autonomy_overrides` (JSONB, keyed by type) erweiterbar.

### Settings-UI

Neuer Tab `loop` in `/dashboard/settings` (neben den bestehenden 10 Tabs in `src/app/dashboard/settings/page.tsx:42-53`):

```
TAB_KEYS = [..., 'loop'] as const;
```

Inhalt:
- **Autonomie-Stufe:** Radio-Gruppe (report / suggest / autonomous), Default hervorgehoben, `autonomous` mit Warn-Text ("Korrekturen werden automatisch gestartet, durchlaufen aber das Approval-Gate").
- **Metrik-Schwellen** (Phase 1 read-only, später editierbar): Tabelle der aktuellen Schwellen.
- **Akzeptanzkriterien** (Phase 1 read-only): Liste der aktiven Kriterien pro Typ.

**Schreibpfad:** `setLoopAutonomy(input)` in `src/lib/loop/settings.ts` — admin-only, auditiert mit `{old, new}` (exaktes Muster von `setApprovalPolicy` in `src/lib/policies/index.ts:97-141`).

### Verhalten pro Stufe

| Stufe | Bei Abweichung | Autonomes Handeln? |
|---|---|---|
| **report** (Default) | `logAudit(tx, { action: 'flag.criteria_violated' })` + Slack-Post + E-Mail. Kein Vorschlag, kein Button. | Nein |
| **suggest** | Wie report, PLUS: Flag-Detail enthält `suggestedAction` (z.B. "Re-run transkript_zu_framework für Client X"). Slack-Post hat "Korrektur starten"-Button. Button löst `startRun()` aus → normales Approval-Gate. | Nein (Mensch klickt) |
| **autonomous** | Wie suggest, ABER: der Loop ruft `startRun()` direkt auf. Der Run durchläuft das NORMALE Approval-Gate (`awaiting_approval` → Mensch approved/rejected). Der Loop kann einen Run STARTEN, aber nie FREIGEBEN. Vollständig auditiert: `flag.auto_correction_started`. | Ja, aber hinter Gate |

### Die harte Grenze

- **report + suggest** = "beobachten + melden" — sicher, kein Risiko.
- **autonomous** = "spekulativ" — die Konfiguration trennt es, der Default schließt es aus, und das Approval-Gate verhindert unkontrollierte Wirkung. Trotzdem: erst in Schritt E gebaut, NACH ausreichender Erfahrung mit report/suggest.

---

## 5 — Flag-Persistenz

### Stufe A (Einstieg): Flag = Audit-Eintrag

**Keine neue Tabelle.** Ein Flag ist ein `logAudit(tx, { … })` mit:

```
action: 'flag.<typ>'          // z.B. 'flag.criteria_violated', 'flag.metric_deviation'
actorType: 'agent'
actorId: 'loop-engine'
target: '<artifactId>' | '<metrik-key>'
detail: {
  category: 'criteria' | 'metric'
  type: 'framework'                    // Deliverable-Typ
  criterion?: 'min_use_cases'          // welches Kriterium
  metric?: 'success_rate'              // welche Metrik
  expected: 3                          // Soll
  actual: 1                            // Ist
  severity: 'warning' | 'critical'     // nach Abstand Soll/Ist
  autonomy: 'report'                   // aktive Stufe
  suggestedAction?: '...'              // nur bei suggest/autonomous
  autoRunId?: '...'                    // nur bei autonomous
}
```

**Anzeige:** Die bestehende Audit-UI (`/dashboard/audit`) zeigt Flags sofort — `queryAuditLog` mit `actionPrefixes: ['flag.']` filtert sie. Das Cockpit-Panel (`src/app/dashboard/page.tsx:240-244`) zählt offene `flag.*`-Einträge der letzten 7 Tage.

Die `/dashboard/flags`-Seite (`src/app/dashboard/flags/page.tsx`) wird mit einer gefilterten Audit-Ansicht gefüllt: `queryAuditLog(orgId, { actionPrefixes: ['flag.'] })` + Detail-Rendering.

### Stufe B (nur bei Bedarf): Flag als eigene Entität

**Wann nötig:** Wenn Flags einen mutablen Status brauchen (offen → quittiert → erledigt), den ein append-only Audit-Log nicht abbilden kann.

Neue Tabelle `loop_flags`:
- `id`, `org_id`, `status` (open/acknowledged/resolved), `category`, `type`, `detail` (JSONB), `audit_id` (FK zum zugehörigen Audit-Eintrag), `resolved_by`, `resolved_at`, `created_at`.
- RLS ENABLE + FORCE, Tenant-Isolation wie alle Tenant-Tabellen.
- GRANT SELECT, INSERT, UPDATE (kein DELETE — ein Flag wird resolved, nicht gelöscht).

**Stufe B wird ERST gebaut, wenn die Praxis zeigt, dass Stufe A nicht reicht** (z.B. wenn Nutzer Flags quittieren/als erledigt markieren wollen). Das ist eine bewusste Entscheidung: lieber mit dem einfacheren Modell starten.

---

## 6 — Zustellung (Benachrichtigung)

### Kanäle (alle vorhanden)

| Kanal | Vorlage | Neue Nutzung |
|---|---|---|
| **Slack** | `postSlackMessage` (Block-Kit) + `notifyApprovalRequested` (`src/lib/skills/notify.ts`) | Flag-Post mit Detail + ggf. "Korrektur starten"-Button (Stufe suggest) |
| **E-Mail** | `notifyApprovalRequested`-Muster | Flag-Mail an `org_settings.approval_notify_email` |
| **Webhook** | `error-reporter.ts` | Optional: Flag-Events an externen Webhook |

Neue Funktion `notifyFlag(orgId, flag)` in `src/lib/loop/notify.ts` — nach dem `notifyApprovalRequested`-Muster: best-effort, wirft nie (das Flag existiert bereits), läuft NACH dem Tx-Commit.

---

## 7 — Lernsignal zurück ins Gedächtnis

Wenn ein Flag quittiert/gelöst wird (Stufe B) oder wenn der Mensch nach einem Flag eine Korrektur durchführt (neuer Run desselben Typs für denselben Client), fließt ein **Lernsignal** ins Gedächtnis:

### Mechanismus

1. **Flag-Kontext** wird dem nächsten `getClientHistory()`-Aufruf (`src/lib/memory/history.ts`) zugänglich: wenn ein Client-bezogenes Flag existiert, enthält die `ClientHistory` eine neue Property `recentFlags: FlagSummary[]` mit den letzten relevanten Flags (Kriterium, Ist, Soll, Auflösung).

2. **Der generative Skill** (z.B. `transkript_zu_framework`) erhält über `buildHistoryBlock()` (`src/lib/skills/catalog/transkript_zu_framework.ts:222-264`) automatisch den Flag-Kontext: "Beim letzten Framework fehlten 2 Use Cases — stelle sicher, dass diesmal ≥ 3 vorhanden sind."

3. **Feedback-Loop:** Wenn der korrigierte Run die Kriterien besteht → der verbesserte Deliverable-Trace dokumentiert die Verbesserung. Das Lernsignal ist **implizit** (besser nächstes Mal) und **deterministisch** (Kriterien bestanden → kein Flag).

### Keine neue Tabelle nötig

Das Lernsignal nutzt die bestehende Infrastruktur:
- Flag-Context: aus `audit_log` WHERE `action LIKE 'flag.%'` AND `target` enthält den `clientId` (Query in `getClientHistory`, zusätzlicher Block).
- History-Integration: Erweiterung von `ClientHistory` um `recentFlags`.

---

## 8 — Loop-Tick (Cron)

### Route: `/api/cron/loop` (neu)

Exaktes Muster von `/api/cron/retention` (`src/app/api/cron/retention/route.ts`):

- `export const dynamic = 'force-dynamic'`
- Bearer-Auth: `CRON_SECRET` (derselbe wie Retention)
- Fail-closed: kein `CRON_SECRET` → 503, falscher Token → 401
- Vercel-Cron: `vercel.json` um `{ "path": "/api/cron/loop", "schedule": "0 */6 * * *" }` erweitern (alle 6 Stunden)

### Ablauf pro Tick

```
1. Lade alle Org-IDs (analog retention_org_ids(), SECURITY DEFINER)
2. Für jede Org:
   a. withTenant(orgId) → computeLoopMetrics(tx, orgId, { since: 7_days_ago })
   b. Für jede Metrik mit passed=false:
      - logAudit(tx, { action: 'flag.metric_deviation', ... })   [in derselben Tx]
   c. NACH der Tx: notifyFlag() für jedes neue Flag              [best-effort, nach Commit]
3. Rückgabe: { ok: true, orgs, flagsRaised, failed }
```

**Keine LLM-Calls, keine langsamen externen Calls in der Tx.** Nur DB-Reads (Metriken aggregieren) + DB-Writes (Audit-Einträge). Alles innerhalb der 15s-Grenze.

### Deduplizierung

Ein Metrik-Flag wird nur geworfen, wenn kein identisches `flag.metric_deviation` für dieselbe Metrik + Org im letzten Tick-Intervall (6h) existiert. Prüfung: `audit_log` WHERE `action = 'flag.metric_deviation'` AND `detail->>'metric' = key` AND `created_at > now() - interval '6 hours'`.

---

## 9 — Kriterien-Prüfung am Ende eines Skill-Runs (Event-getrieben)

### Integration in die Engine

Am Ende von `executeFrom()` in `src/lib/skills/engine.ts:330-456`, NACH dem letzten Step und VOR `skill.completed`:

```
// Nach Zeile 440, VOR dem finalen withTenant-Block:
if (mode === 'live') {
  await evaluateDeliverableCriteria(orgId, skill.key, runId, state);
}
```

Neue Funktion `evaluateDeliverableCriteria()` in `src/lib/loop/evaluate.ts`:

1. **AUSSERHALB der Tx:** Artifact-Content aus Blob laden (wie in `getClientHistory`).
2. **Observation** bauen aus dem Artifact (DeliverableSource, lokaler Aufruf — kein volles `fetchObservations`, nur das eine Artifact dieses Runs).
3. **Akzeptanzkriterien** laden für den Deliverable-Typ.
4. **Prüfen** (reine Funktionen, deterministisch, schnell).
5. **Deliverable-Trace** bauen.
6. **In einer kurzen Tx:** `skill_runs.trace` schreiben + bei Verletzung `logAudit(tx, { action: 'flag.criteria_violated', ... })`.
7. **NACH der Tx:** `notifyFlag()` bei Verletzung (best-effort).

### Warum event-getrieben UND periodisch

- **Event-getrieben** (Kriterien): sofortige Rückmeldung am Ende eines Runs — "dein Framework hat nur 1 Use Case".
- **Periodisch** (Cron/Metriken): Trends über Zeit — "die Erfolgsquote ist unter 70% gefallen".

Beide fließen in denselben Flag-Mechanismus. Beide nutzen dasselbe Quell-Interface.

---

## Phase 1 — Schritte (jetzt baubar)

### Schritt A: Quell-Interface + Kriterien-Prüfung + Flag als Audit-Eintrag

**Was:** Der kleinste ehrliche Kern. Am Ende eines `transkript_zu_framework`-Runs wird das Deliverable gegen Akzeptanzkriterien geprüft. Verletzung → Flag als Audit-Eintrag.

**Setzt auf im Code:**
- `src/lib/skills/engine.ts:440` — Integrationspunkt nach letztem Step
- `src/lib/skills/catalog/transkript_zu_framework.ts:59-62` — FRAMEWORK_SECTIONS als Referenz für Kriterien
- `src/lib/artifacts.ts` — getArtifactContent für Blob-Laden
- `src/lib/storage/blob.ts` — BlobProvider
- `src/lib/audit.ts` — logAudit

**Neue Dateien:**
- `src/lib/loop/sources/types.ts` — ObservationSource + Observation
- `src/lib/loop/sources/deliverable.ts` — DeliverableSource
- `src/lib/loop/sources/index.ts` — Registry
- `src/lib/loop/criteria/types.ts` — AcceptanceCriterion + CriterionResult
- `src/lib/loop/criteria/framework.ts` — Kriterien für type='framework'
- `src/lib/loop/evaluate.ts` — evaluateDeliverableCriteria
- Migration: `skill_runs.trace` JSONB-Spalte

**Grobe Größe:** ~300–400 LOC Logik + ~50 LOC Migration. 1–2 Tage.

**Tests:**
- Unit: jedes Kriterium isoliert (Markdown-String rein, CriterionResult raus).
- Integration: `evaluateDeliverableCriteria` mit Fake-Blob, prüfe dass Flag im Audit landet.
- Grenzfall: Framework ohne Use Cases → Flag. Framework mit 3+ Use Cases → kein Flag.

**Tenant/Audit:** Flag-Eintrag in derselben `withTenant`-Tx wie `skill_runs.trace`. Kein LLM in der Tx.

---

### Schritt B: Cockpit-Panel + /flags-Seite mit echten Flags

**Was:** Die reservierten UI-Plätze mit echten Daten füllen.

**Setzt auf im Code:**
- `src/app/dashboard/page.tsx:240-244` — Cockpit "Loop & Flags" Panel (Stub)
- `src/app/dashboard/flags/page.tsx` — leere Flags-Seite
- `src/lib/audit.ts:65-88` — queryAuditLog

**Änderungen:**
- Cockpit-Panel: `queryAuditLog` mit `actionPrefixes: ['flag.']`, letzte 7 Tage. Zeige Anzahl offener Flags + letztes Flag mit Detail.
- `/flags`-Seite: gefilterte Audit-Ansicht, neueste zuerst. Pro Flag: Typ, Kriterium/Metrik, Ist vs. Soll, Severity, Zeitstempel. Link zum Run/Artifact.
- Nav: `soon: true` → `soon: false` für den Flags-Link (`src/app/dashboard/shell.tsx:101-108`).

**Grobe Größe:** ~150–200 LOC UI. 0.5–1 Tag.

**Tests:** Audit-Query mit Flag-Prefix liefert korrekte Ergebnisse. UI-Test: Flags werden gerendert.

**Tenant/Audit:** Nur lesend via `queryAuditLog` (bereits RLS-scoped).

---

### Schritt C: Periodischer Metrik-Check (Cron)

**Was:** Der Loop-Tick prüft Prozess-Metriken (Soll-Quelle B) und wirft Flags bei Abweichung.

**Setzt auf im Code:**
- `src/app/api/cron/retention/route.ts` — Muster für Cron-Route
- `src/lib/value.ts:197-273` — computeValueStats (für successRate)
- `src/lib/audit.ts` — logAudit + queryAuditLog (für Dedup)
- `vercel.json` — Cron-Definition

**Neue Dateien:**
- `src/lib/loop/metrics.ts` — computeLoopMetrics
- `src/app/api/cron/loop/route.ts` — Cron-Route

**Grobe Größe:** ~200–250 LOC. 1 Tag.

**Tests:**
- Unit: computeLoopMetrics mit bekannten Daten → korrekte Werte.
- Integration: Cron-Route mit falschem Bearer → 401. Ohne CRON_SECRET → 503. Mit korrektem Token + Daten unter Schwelle → Flag im Audit.
- Dedup: zweiter Tick innerhalb 6h → kein doppeltes Flag.

**Tenant/Audit:** Metriken + Flag-Write in derselben `withTenant`-Tx. Pro Org eigene Tx. Fehlschlag einer Org stoppt nicht die anderen (wie Retention-Sweep).

---

### Schritt D: Autonomie-Stufe "Vorschlagen"

**Was:** Flags enthalten Korrektur-Vorschläge. Slack-Post hat "Korrektur starten"-Button.

**Setzt auf im Code:**
- Stufe A–C (muss existieren)
- `src/lib/skills/notify.ts` — notifyApprovalRequested (Muster für Slack-Button)
- `src/lib/skills/engine.ts` — startRun (zum Auslösen der Korrektur)
- `src/lib/policies/index.ts:97-141` — setApprovalPolicy-Muster für Settings

**Neue Dateien:**
- `src/lib/loop/settings.ts` — setLoopAutonomy, getLoopAutonomy
- `src/lib/loop/notify.ts` — notifyFlag (mit Slack-Button für suggest)
- Migration: `loop_autonomy` Enum + `org_settings.loop_autonomy` Spalte
- Settings-Tab "Loop" in `src/app/dashboard/settings/page.tsx`

**Änderungen:**
- Flag-Detail erhält `suggestedAction` wenn autonomy='suggest'.
- Slack-Post: Block-Kit mit "Korrektur starten"-Button (Callback → neue API-Route → `startRun()`).
- Neue API-Route: `POST /api/loop/correct` — nimmt Flag-Ref, startet Run, normales Approval-Gate.

**Grobe Größe:** ~350–400 LOC. 1–2 Tage.

**Tests:**
- Unit: notifyFlag baut korrekten Slack-Block.
- Integration: Korrektur-Button → startRun → Run in awaiting_approval.
- Settings: setLoopAutonomy schreibt korrekt + auditiert.

**Tenant/Audit:** Settings-Write admin-only + auditiert. Korrektur-Run durchläuft normales Approval-Gate.

---

### Schritt E: Autonomie-Stufe "Autonom" + ggf. Flag-Entität (Stufe B)

**Was:** Loop startet Korrekturen selbst (hinter Approval-Gate). Optional: Flags als eigene Entität mit Status.

**Setzt auf im Code:**
- Stufe A–D (muss existieren)
- `src/lib/skills/engine.ts` — startRun
- `src/lib/loop/evaluate.ts` — evaluateDeliverableCriteria

**Änderungen:**
- `evaluateDeliverableCriteria`: wenn autonomy='autonomous' UND Flag raised → `startRun()` direkt aufrufen (NACH der Flag-Tx, nie darin).
- Audit: `flag.auto_correction_started` mit runId.
- **Optional Stufe B:** wenn die Praxis zeigt, dass Flag-Status (offen/quittiert/erledigt) nötig ist → Migration für `loop_flags`-Tabelle + RLS + UI.

**Grobe Größe:** ~200 LOC (ohne Stufe B), ~400 LOC (mit Stufe B). 1–2 Tage.

**Tests:**
- Integration: autonomy='autonomous' + Flag → Run gestartet + Audit. Run durchläuft Approval-Gate (awaiting_approval, nicht auto-approved).
- Sicherheit: autonomy='report' → kein Run gestartet. autonomy='suggest' → kein Run gestartet (nur Button).

**Tenant/Audit:** Auto-Run auditiert als `flag.auto_correction_started` mit actorType='agent'. Run durchläuft normales Gate.

**Risiken:** Scope-Explosion, Alarm-Müdigkeit bei falsch kalibrierten Schwellen, Endlos-Korrekturen. Gegenmittel: Max-Korrekturen-Limit pro Zeitraum (z.B. 3 pro Tag pro Client+Typ), auditiert als `flag.correction_limit_reached`.

---

## Phase 2 — Schritte (nach Tool-Anbindung)

### Schritt F: Quelle 2 (Tool-Artefakte) andocken

**Was:** Das Quell-Interface wird um `ToolArtifactSource` erweitert. helix überwacht die Arbeit der Firma aus den Tools.

**Abhängigkeit:** Setzt voraus:
- Mindestens ein lesender Konnektor (z.B. Linear-Push, Teil F des Bauplans)
- `documents`-Tabelle mit `external_ref` + Quellentyp (`source IN ('ticket', 'code', 'doc')`)
- `ConnectorDef`-Framework

**Setzt auf im Code:**
- `src/lib/loop/sources/types.ts` — ObservationSource (unverändert)
- `src/lib/loop/sources/index.ts` — Registry (+ ToolArtifactSource)
- `src/lib/loop/criteria/` — neue Kriterien-Sets für Tool-Typen

**Neue Dateien:**
- `src/lib/loop/sources/tool_artifact.ts` — ToolArtifactSource
- `src/lib/loop/criteria/ticket.ts` — Kriterien für Tickets (z.B. "Ticket hat Akzeptanzkriterien", "Ticket ist einem Sprint zugeordnet")

**Änderungen am Cron:**
- `computeLoopMetrics` erweitern: neue Metriken aus Tool-Daten (z.B. "offene Tickets ohne Akzeptanzkriterien", "Commits ohne zugehöriges Ticket").
- Der periodische Check nutzt BEIDE Quellen.

**Grobe Größe:** ~300–400 LOC. 1–2 Tage (vorausgesetzt Konnektor existiert).

**Tests:**
- Integration: ToolArtifactSource liefert Observations aus documents-Tabelle.
- Kriterien: Ticket ohne Akzeptanzkriterien → Flag.

**Tenant/Audit:** Wie Phase 1 — RLS-scoped, Flag als Audit-Eintrag.

**Risiken:**
- **Alarm-Müdigkeit** (größtes Risiko): Tool-Artefakte sind viel zahlreicher als Deliverables. Schwellen müssen konservativ starten (weniger Flags) und erst nach Kalibrierung sensibler werden.
- **Datenqualität:** wenn der Konnektor Duplikate liefert (kein `external_ref`-Dedup), entstehen falsche Flags. Dedup ist harte Voraussetzung.

---

## 10 — Übersicht: Schritt-Reihenfolge

```
PHASE 1 (jetzt baubar, setzt auf bestehendem Code auf)
  │
  ├── Schritt A: Quell-Interface + Kriterien-Prüfung + Flag als Audit
  │               [kleinster ehrlicher Kern, ERSTER Schritt]
  │
  ├── Schritt B: Cockpit-Panel + /flags-Seite füllen
  │               [macht Schritt A sichtbar]
  │
  ├── Schritt C: Periodischer Metrik-Check (Cron → Flags)
  │               [zweiter Auslöser, unabhängig von Skill-Runs]
  │
  ├── Schritt D: Autonomie-Stufe "Vorschlagen" + Settings-Tab
  │               [erste Konfigurierbarkeit]
  │
  └── Schritt E: Autonomie-Stufe "Autonom" + ggf. Flag-Entität
                  [spekulativ, erst nach Erfahrung]

PHASE 2 (nach Tool-Anbindung)
  │
  └── Schritt F: Quelle 2 (Tool-Artefakte) andocken
                  [Abhängigkeit: lesender Konnektor + Dedup]
```

**Empfohlene Reihenfolge: A → B → C → D → E → F**

Die Reihenfolge ist strikt linear — jeder Schritt setzt auf dem vorherigen auf:
- **A vor B:** Es braucht echte Flags, bevor die UI sie zeigen kann.
- **B vor C:** Die UI muss stehen, bevor ein zweiter Flag-Auslöser (Cron) hinzukommt — sonst entstehen unsichtbare Flags.
- **C vor D:** Autonomie-Stufen machen erst Sinn, wenn beide Auslöser (event + periodisch) laufen.
- **D vor E:** "Vorschlagen" muss vor "Autonom" kommen — der Button/Workflow muss existieren, bevor der Loop ihn automatisch auslösen darf.
- **F nach E:** Tool-Quelle dockt an den vollständigen Mechanismus an.

---

## 11 — Ehrliche Risiken

| Schritt | Risiko | Gegenmittel |
|---|---|---|
| **A** | Falsch-positive Kriterien (z.B. Markdown-Parsing zu strikt) → Flags bei korrekten Frameworks | Konservative Kriterien, manuelle Review der ersten 10 Flags, Schwellen justierbar |
| **B** | Flags in der UI, aber niemand schaut hin | Cockpit-KPI prominent platzieren, Slack-Benachrichtigung |
| **C** | **Alarm-Müdigkeit** (größtes Risiko): zu viele Metrik-Flags → wichtige gehen unter | Wenige Metriken (4), hohe Default-Schwellen, 6h-Dedup, pro Metrik max. 1 Flag/Tag |
| **D** | Scope-Creep beim "Vorschlagen"-Feature (Vorschläge werden immer komplexer) | Vorschlag = nur `startRun()` mit denselben Inputs → keine neue Logik, nur Re-Run |
| **E** | **Endlos-Korrekturen** (Loop startet Run → Run verletzt Kriterium → Loop startet nächsten Run → …) | Hard-Limit: max. 3 Auto-Korrekturen pro Client+Typ pro Tag, danach nur noch report |
| **E** | Ungewollte autonome Runs bei falscher Konfiguration | Default = report (nie autonom), autonomous nur per Admin-Setting, Approval-Gate als letzte Schranke |
| **F** | Daten-Explosion: tausende Tickets → tausende Prüfungen → Flags-Rauschen | Batch-Limit (max. 50 Observations pro Tick), konservative Schwellen, nur delta seit letztem Tick |
| **F** | Abhängigkeit von Konnektor-Qualität (Dedup, fail-closed visibility) | Dedup als harte Voraussetzung; Tool-Source aktiviert sich erst, wenn `external_ref` auf documents existiert |

---

## 12 — Datei-Übersicht (alle neuen Dateien)

```
src/lib/loop/
  ├── sources/
  │   ├── types.ts              ← ObservationSource, Observation
  │   ├── deliverable.ts        ← Phase 1: DeliverableSource
  │   ├── tool_artifact.ts      ← Phase 2: ToolArtifactSource
  │   └── index.ts              ← Registry
  ├── criteria/
  │   ├── types.ts              ← AcceptanceCriterion, CriterionResult
  │   ├── framework.ts          ← Kriterien für type='framework'
  │   └── ticket.ts             ← Phase 2: Kriterien für Tickets
  ├── evaluate.ts               ← evaluateDeliverableCriteria
  ├── metrics.ts                ← computeLoopMetrics
  ├── settings.ts               ← get/setLoopAutonomy
  └── notify.ts                 ← notifyFlag

src/app/api/cron/loop/
  └── route.ts                  ← Cron-Route (Metrik-Check)

src/app/api/loop/
  └── correct/route.ts          ← Korrektur-Auslöser (Schritt D)

prisma/migrations/
  ├── 00XX_skill_run_trace/     ← skill_runs.trace JSONB
  └── 00XX_loop_autonomy/       ← loop_autonomy Enum + org_settings-Spalte
```

**Geänderte Dateien:**
- `src/lib/skills/engine.ts` — Integration nach letztem Step
- `src/app/dashboard/page.tsx` — Cockpit-Panel füllen
- `src/app/dashboard/flags/page.tsx` — echte Flag-Ansicht
- `src/app/dashboard/shell.tsx` — `soon: false` für Flags-Link
- `src/app/dashboard/settings/page.tsx` — neuer Tab "Loop"
- `src/lib/memory/history.ts` — recentFlags in ClientHistory
- `vercel.json` — Cron-Definition für /api/cron/loop

---

## 13 — Erster Schritt

**Schritt A** wird als ERSTES gebaut. Er ist der kleinste ehrliche Kern:
- Ein Interface (ObservationSource) + eine Implementierung (DeliverableSource).
- 5 deterministische Prüffunktionen für den Framework-Typ.
- Integration in die Engine (ein Funktionsaufruf nach dem letzten Step).
- Ein Audit-Eintrag bei Verletzung.
- Eine Migration (skill_runs.trace).

Er produziert vom ersten Tag an echte, nützliche Flags — und alles Weitere (UI, Cron, Autonomie, Tool-Quelle) setzt darauf auf, ohne ihn zu verändern.
