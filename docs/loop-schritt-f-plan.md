# Loop-Schritt F — Plan: Quelle 2 (Tool-Artefakte) an den bestehenden Loop andocken

**Stand:** 2026-07-05 · **Art:** Planung, kein Code · **Bezug:** `docs/loop-implementierungsplan.md` (Schritt F, §1, §12), `docs/helix-os-bauplan-us.md` Teil F + Teil G

---

## 0 — Die harte Abhängigkeit (ZUERST lesen — ohne sie ist Schritt F nicht baubar)

Schritt F fügt **keine** neue Tool-Anbindung hinzu. Er setzt eine **schon vorhandene, lesende Tool-Anbindung** voraus und beobachtet nur die Daten, die diese bereits eingelesen hat. Die lesende Anbindung selbst ist **Teil F des OS-Bauplans** (`docs/helix-os-bauplan-us.md:124-163`) und wird **hier nicht geplant**.

**Was heute im Code EXISTIERT** (verifiziert):
- `Document`-Modell (`prisma/schema.prisma:406-426`) mit `source DocumentSource`, `visibility`, RLS.
- `DocumentSource`-Enum (`prisma/schema.prisma:64-70`) — aber nur `upload | manual | transcript`.
- `ingestDocument(input)` (`src/lib/rag/ingest.ts:74`) — quellen-agnostische Text-Ingestion (Chunks + Embeddings + Audit).

**Was heute FEHLT und VOR Schritt F existieren muss** (verifiziert — steht nirgends im Schema/Migrations, `external_ref` kommt nur in `src/lib/loop/sources/{types,deliverable}.ts` als TS-Feldname vor, nicht in der DB):

| Baustein | Status heute | Wer baut es | Referenz |
|---|---|---|---|
| `ConnectorDef`-Vertrag + `src/lib/connectors/` | **existiert nicht** | OS-Bauplan Teil F | `helix-os-bauplan-us.md:126-129` |
| Mind. 1 lesender Konnektor (empfohlen: **Linear-Push**) | **existiert nicht** | OS-Bauplan Teil F | `helix-os-bauplan-us.md:130-136, 240-242` |
| `documents.external_ref` Spalte (z.B. `linear:issue:ABC-123`) | **existiert nicht** | OS-Bauplan Teil F (Ingestion-Dedup) | `helix-os-bauplan-us.md:149-154` |
| `@@unique([orgId, external_ref])` auf `documents` | **existiert nicht** | OS-Bauplan Teil F | `helix-os-bauplan-us.md:151` |
| `DocumentSource`-Werte `ticket` / `code` / `doc` | **fehlen** (nur upload/manual/transcript) | OS-Bauplan Teil F | `helix-os-bauplan-us.md:159` |
| `externalRef`-Upsert-Pfad in `ingestDocument` | **existiert nicht** | OS-Bauplan Teil F | `helix-os-bauplan-us.md:152` |
| fail-closed-Sichtbarkeit für extern gelesene Docs (nie `open`) | teils (Enum vorhanden) | OS-Bauplan Teil F | `helix-os-bauplan-us.md:153-154` |

**Konsequenz:** Der ursprüngliche Loop-Plan (`loop-implementierungsplan.md:44-48, 483`) beschreibt die `ToolArtifactSource` so, als läse sie aus `documents WHERE source IN ('ticket','code','doc')` mit `external_ref`. **Diese Spalten und Enum-Werte existieren heute nicht.** Schritt F ist damit **erst baubar, wenn mindestens ein lesender Konnektor (Linear) samt `external_ref`-Dedup und den neuen `DocumentSource`-Werten gebaut ist.** Diese Vorarbeit ist NICHT Teil dieses Plans — sie ist die Voraussetzung, die ganz oben stehen muss.

**Minimal-Voraussetzung für Schritt F (die kleinste ehrliche Schwelle):**
Ein einzelner Linear-Push-Konnektor, der Tickets als `documents` mit `source='ticket'`, `external_ref='linear:issue:…'`, `visibility='restricted'` und den für die Prüfung nötigen Feldern (Fälligkeit, Status, Assignee, letzte Aktivität) einliest. Ohne diese Felder kann Schritt F kein deterministisches Soll prüfen (siehe §3).

---

## 1 — Was Schritt F ist (und was nicht)

**Ist:** Eine **zweite `ObservationSource`** (`ToolArtifactSource`), die die von einem lesenden Konnektor eingelesenen Tool-Artefakte (Linear-Tickets, später GitHub-Commits) als `Observation` liefert — sodass **derselbe** Vergleichs-, Flag-, Notify- und (eingeschränkt) Autonomie-Mechanismus wie für Quelle 1 sie prüfen kann. **Nur die Quelle ist neu.** Kein neues UI, kein neuer Flag-Typ, keine neue Notify-Schiene.

**Ist nicht:** Kein neuer Konnektor (das ist Teil F des OS-Plans). Kein LLM-Richter über „baut das Team das Richtige". Kein Auto-„Re-Run" von Tickets (§4). Keine Änderung an Quelle 1 (`DeliverableSource`) — Schritt F ist rein **additiv**.

**Der Vision-Bezug (Hu):** „flag when engineering is building the wrong thing" (`helix-os-bauplan-us.md:63`). Das übersetzt Schritt F ehrlich in **deterministisch prüfbare Prozess-Signale** über Tool-Arbeit — nicht in eine Qualitäts-Bewertung des Inhalts.

---

## 2 — Die `ToolArtifactSource` (implementiert `ObservationSource`)

### Vorbild: `DeliverableSource` (`src/lib/loop/sources/deliverable.ts:5-54`)

`DeliverableSource` zeigt das exakte Muster, dem `ToolArtifactSource` folgt:
1. In **einer** `withTenant()`-Tx die Zeilen selektieren (Metadaten, keine Blobs).
2. **Außerhalb** der Tx den Text laden (bei Deliverables: Blob; bei Tool-Artefakten: der Text steht bereits als `documents`-Inhalt / Chunk-Text — **kein** externer Call nötig, die Ingestion hat ihn schon geholt).
3. Pro Zeile ein `Observation` bauen.

### Interface (unverändert — `src/lib/loop/sources/types.ts`)

```
ObservationSource { key; fetchObservations(orgId, since): Observation[] }
Observation { sourceKey; externalRef; type; content; metadata; createdAt }
```

`ToolArtifactSource` erfüllt es 1:1 — **keine Interface-Änderung** (genau dafür wurde das Interface gebaut).

### Neue Datei: `src/lib/loop/sources/tool_artifact.ts`

```
export const toolArtifactSource: ObservationSource = {
  key: 'tool_artifact',
  async fetchObservations(orgId, since) {
    // 1) EINE withTenant-Tx: nur die relevanten documents-Zeilen (Metadaten).
    const docs = await withTenant(orgId, (tx) =>
      tx.document.findMany({
        where: {
          source: { in: ['ticket', 'code', 'doc'] },   // NEUE Enum-Werte (Voraussetzung §0)
          createdAt: { gte: since },
          externalRef: { not: null },                    // NEUE Spalte (Voraussetzung §0)
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_OBSERVATIONS_PER_TICK,                 // Batch-Limit gegen Daten-Explosion (§6)
        select: { id, title, source, externalRef, createdAt, /* + Tool-Felder, s.u. */ },
      }),
    );
    // 2) AUSSERHALB der Tx: (nur falls Volltext gebraucht wird) Chunk-Text
    //    zusammensetzen — reiner DB-Read, KEIN externer/LLM-Call.
    // 3) Pro Doc → Observation:
    return docs.map((d) => ({
      sourceKey: 'tool_artifact',
      externalRef: d.externalRef,        // 'linear:issue:ABC-123'
      type: d.source,                    // 'ticket' | 'code' | 'doc'  → wählt das Kriterien-Set
      content: d.title /* + optional Volltext */,
      metadata: { /* die deterministisch prüfbaren Felder — siehe §3 */ },
      createdAt: d.createdAt,
    }));
  },
};
```

### Die Kernfrage: **woher kommen die prüfbaren Felder (Fälligkeit, Status, Assignee, letzte Aktivität)?**

Das ist die eigentliche Design-Entscheidung. Ein `documents`-Row hat heute nur `title/source/visibility/…` — **keine** Ticket-Fälligkeit, kein Status. Zwei ehrliche Optionen:

- **Option A (empfohlen, kleiner): der Konnektor speichert die Prüf-Felder als strukturiertes `metadata`-JSON.**
  Beim `ingestDocument`-Upsert (Teil F) schreibt der Linear-Konnektor die für das Soll nötigen Felder in eine **neue nullbare JSONB-Spalte `documents.source_meta`** (z.B. `{ dueDate, state, assigneeId, lastActivityAt, sprintId }`). `ToolArtifactSource` mappt `source_meta` direkt auf `Observation.metadata`. Die Prüfung (§3) ist dann eine reine Funktion über `metadata` — passt exakt zum bestehenden `check(obs)`-Muster (`src/lib/loop/criteria/types.ts:13-17`), das rein synchron über die `Observation` läuft.
  → **Voraussetzung für §0:** die Spalte `source_meta` gehört zum Konnektor-Ingest (Teil F), nicht zu Schritt F. Schritt F **liest** sie nur.

- **Option B (größer, nicht empfohlen für den Einstieg): eine eigene `tool_artifacts`-Tabelle** mit typisierten Spalten. Mehr Schema, mehr RLS, mehr Migrationsfläche — überflüssig, solange `source_meta`-JSON reicht. Erst wenn Tool-Artefakte einen eigenen mutablen Lebenszyklus brauchen (analog Flag-Stufe B), lohnt sich das.

**Empfehlung:** Option A. Sie hält Schritt F klein und die „nur die Quelle ist neu"-Zusage ein: kein neues Kernmodell, nur ein zweiter Reader auf `documents` + ein JSON-Feld, das der Konnektor ohnehin füllt.

### Registrierung (`src/lib/loop/sources/index.ts` — additiv)

Heute: `return [deliverableSource];` (`src/lib/loop/sources/index.ts:8`).
Schritt F: `return [deliverableSource, toolArtifactSource];`
Eine Zeile. Quelle 1 bleibt unverändert.

---

## 3 — Das „Soll" für Tool-Arbeit (die schwierige Frage — deterministisch, KEIN LLM)

Bei Deliverables ist das Soll strukturell (Akzeptanzkriterien über Markdown, `src/lib/loop/criteria/framework.ts`). Bei Firmen-Arbeit („baut das Team das Richtige?") ist das Soll **unschärfer** — und genau hier entscheidet sich, ob Schritt F ehrlich bleibt oder in LLM-Raterei abgleitet.

**Regel (nicht verhandelbar, gilt wie im ganzen Loop):** Das Soll ist **nur** aus deterministisch prüfbaren Signalen gebaut. Kein LLM als Richter. Wenn ein Soll nur mit LLM-Urteil ginge → **explizit als „nicht jetzt" markiert** (unten).

### Kriterien-Set für Tickets (neue Datei `src/lib/loop/criteria/ticket.ts`)

Gleiche Struktur wie `frameworkCriteria` (`AcceptanceCriteriaSet` mit reinen `check(obs)`-Funktionen, `src/lib/loop/criteria/types.ts:19-22`). Jedes Kriterium ist eine **reine Funktion über `Observation.metadata`** — kein DB-Zugriff, kein Netzwerk. `now()` wird als Parameter/Feld hereingegeben (injizierbar, testbar), nicht aus der Prüffunktion heraus aufgerufen.

**JETZT baubar (deterministisch, ohne LLM):**

| Kriterium (key) | Prüfung (rein über metadata) | Soll |
|---|---|---|
| `ticket_overdue` | `state` ∈ offen-Menge UND `dueDate < now` | nicht überfällig |
| `ticket_stale` | `state` offen UND `now - lastActivityAt > STALE_DAYS` (z.B. 14) | Aktivität in den letzten X Tagen |
| `ticket_unassigned` | `state` offen UND `assigneeId == null` UND `now - createdAt > GRACE_DAYS` (z.B. 2) | zugeordnet |
| `ticket_no_sprint` | `state` offen UND `sprintId == null` UND `now - createdAt > GRACE_DAYS` | einem Sprint zugeordnet |
| `ticket_missing_acceptance` | Ticket-Beschreibungstext enthält **keinen** der Marker (`Acceptance`, `AC:`, `Akzeptanzkriterien`) — **reine String-Suche**, analog `hasSources` in `framework.ts:124-158` | Akzeptanzkriterien im Ticket |

Diese fünf sind das direkte Tool-Analogon zu den fünf Framework-Kriterien: **strukturell, string-/feld-basiert, falsifizierbar** — dieselbe Klasse Prüfung, andere Quelle.

**Diskrepanz-Signale, JETZT baubar (deterministisch), sobald zwei Quellen vorliegen:**

| Signal (key) | Prüfung | Braucht |
|---|---|---|
| `commit_without_ticket` | GitHub-Commit-Message enthält **keine** Ticket-Referenz (Regex `ABC-\d+`) — reine String-Prüfung | Commits als `source='code'` (2. Konnektor) |
| `ticket_no_commit_but_done` | Ticket `state='done'`, aber **kein** `documents`-Row mit `external_ref` referenziert seine Ticket-ID | Tickets + Commits verlinkt |

> `ticket_no_commit_but_done` erfordert einen **Join über zwei externalRef-Räume** — das ist keine reine `check(obs)`-Funktion mehr, sondern eine **Metrik** (§5, aggregierend über den Tenant). Ehrlich einordnen: gehört in `computeLoopMetrics`, nicht ins `check(obs)`-Kriterien-Set.

**NICHT JETZT (bräuchte LLM als Richter — ehrlich ausgeschlossen):**

| Idee | Warum nicht |
|---|---|
| „Baut das Ticket am Firmenziel vorbei?" | Semantischer Abgleich Ticket-Inhalt ↔ Strategie = LLM-Urteil. Kein deterministisches Soll. |
| „Ist die Ticket-Beschreibung gut genug?" | Qualitäts-Urteil über Freitext = LLM. Nur `missing_acceptance` (Marker vorhanden ja/nein) ist deterministisch. |
| „Passt der Commit inhaltlich zum Ticket?" | Inhaltlicher Match Diff ↔ Ticket = LLM. Nur die **Referenz** (`ABC-123` vorhanden ja/nein) ist deterministisch. |
| „Priorisiert das Team falsch?" | Wertung ohne objektives Soll. |

Diese Zeile ist der Kern der Ehrlichkeit: helix flaggt **„dieses Ticket ist überfällig / verwaist / ohne AC / ohne Ticket-Bezug"** — überprüfbare Prozess-Lücken. Es flaggt **nicht** „ihr baut inhaltlich das Falsche", weil das ein LLM-Urteil wäre, das der Loop bewusst nicht fällt.

---

## 4 — Wie das Flag aussieht (bestehendes Format, KEIN neues UI)

Schritt F erzeugt **keinen neuen Flag-Typ und kein neues UI**. Es nutzt exakt die zwei bestehenden Wege:

**a) Event-nah / periodisch pro Artefakt (Kriterien-Verletzung):**
Eine `flag.criteria_violated`-Audit-Zeile — **dieselbe** wie in `evaluate.ts:111-134`, mit `detail.failedCriteria[]`. `toFlagView` (`src/lib/loop/flags-view.ts:108-131`) rendert dieses Array bereits (der `failedCriteria`-Pfad ist quellenunabhängig). `target` = die `externalRef` des Tickets statt einer `artifactId`. `detail.type` = `'ticket'`.
→ Erscheint **sofort** in Cockpit + `/flags` — ohne UI-Änderung, weil beide nur `toFlagView` konsumieren.

**b) Aggregiert über den Tenant (Metrik-Abweichung):**
Für Tool-Metriken (§5) `buildMetricFlag(orgId, metric, suggestion)` (`src/lib/loop/metric-flags.ts:55-83`) → `flag.metric_deviation`, flaches `{ metric, expected, actual, severity }`. `toFlagView`s Metrik-Pfad rendert es (`flags-view.ts:122-130`). Ebenfalls **kein neues UI**.

**Wichtig:** Weil `toFlagView` schon defensiv „jede zukünftige `flag.*`-Form" verträgt (`flags-view.ts:14-16`) und den `failedCriteria[]`- **und** den flachen Metrik-Pfad kann, braucht Schritt F an der Projektion und am UI **null** Änderungen. Nur `detail.type='ticket'` ist neu — reines Datum, kein Code-Pfad.

---

## 5 — Einhängen in Registry + Tick (additiv, ohne Quelle 1 anzufassen)

Der bestehende periodische Tick (`src/lib/loop/tick.ts`) prüft heute **nur Metriken** (`computeLoopMetrics`, `tick.ts:72`) — er nutzt die `ObservationSource`-Registry **noch gar nicht**. Für Schritt F gibt es zwei saubere Andock-Punkte:

**(1) Per-Artefakt-Kriterien über die Registry (neu im Tick):**
`runLoopTickForOrg` (`tick.ts:68-105`) wird additiv erweitert: nach dem Metrik-Block iteriert es die **Tool-Quellen** aus `getObservationSources()`, ruft `fetchObservations(orgId, since)` **außerhalb** der Tx, prüft mit dem `type`-passenden Kriterien-Set (`ticket.ts`), und schreibt Verletzungen als `flag.criteria_violated` in **einer kurzen Tx** (mit Dedup, s.u.). `DeliverableSource` wird hier **übersprungen** (deren Kriterien laufen event-getrieben in `evaluate.ts` am Run-Ende; sie im Tick erneut zu prüfen wäre Doppelarbeit). Konkret: nur Quellen mit `key !== 'deliverable'` — oder die Quelle trägt ein Flag „periodisch prüfbar".

**(2) Tool-Metriken (aggregiert):**
`computeLoopMetrics` (`src/lib/loop/metrics.ts:223-236`) bekommt zusätzliche, deterministische Tool-Metriken (reine DB-Counts in der bestehenden Tx, kein Netzwerk):
- `open_tickets_without_acceptance` (Anteil offener Tickets ohne AC-Marker)
- `commits_without_ticket` (Anteil Commits ohne `ABC-123`-Referenz)
- `stale_open_tickets` (Anteil offener Tickets ohne Aktivität > X Tage)

Diese fügen sich in das vorhandene `LoopMetric`-Schema (`metrics.ts:33-57`) ein und fließen ohne weitere Änderung durch `buildMetricFlag` → `toFlagView`.

**Ablauf-Erweiterung im Tick (die harte Regel bleibt gewahrt):**
```
runLoopTickForOrg(orgId, since):
  A) withTenant-Tx: computeLoopMetrics (jetzt inkl. Tool-Metriken) → Metrik-Flags (dedup) [wie heute]
  B) AUSSERHALB Tx: für jede Tool-Quelle fetchObservations(orgId, since)   ← nur DB-Reads
  C) AUSSERHALB Tx: check(obs) je Kriterium (reine Funktionen)             ← kein LLM
  D) kurze withTenant-Tx: pro verletztem Artefakt flag.criteria_violated (mit Dedup)
  E) nach Commit: notifyFlag(...) je neuem Flag (best-effort)              [wie heute]
```
Schritt B/C laufen **außerhalb** jeder Tx (die nicht verhandelbare Regel, `helix-os-bauplan-us.md:37-47`). Nur D ist eine kurze Schreib-Tx. Keine Änderung an Quelle 1, keine Änderung an `evaluate.ts`.

**Dedup (Pflicht — sonst Alarm-Müdigkeit):** Wie der bestehende Metrik-Dedup (`tick.ts:50-61`), aber pro **`externalRef` + Kriterium**: kein zweites `flag.criteria_violated` für dasselbe Ticket + dasselbe Kriterium innerhalb des Dedup-Fensters (`DEDUP_HOURS`, `tick.ts:36`). Ein Ticket, das seit Tagen überfällig ist, darf **nicht** bei jedem Tick erneut flaggen.

---

## 6 — Ist die Autonomie-Kette (report/suggest/autonomous) auf Tool-Arbeit anwendbar?

**Kurz: `report` ja, `suggest` eingeschränkt (nur als Review-Hinweis), `autonomous` NEIN.** Das ist die ehrlichste und wichtigste Einordnung dieses Plans.

Der Grund liegt im bestehenden Autonomie-Design: „Korrektur" heißt dort **Re-Run desselben Skills mit denselben Eingaben** (`src/lib/loop/suggest.ts:6-19`, `CorrectionRef` = `{ skillKey, sourceRunId, clientId }`). Auto-Korrektur (`maybeAutoCorrect`, `src/lib/loop/auto-correct.ts:137`) startet **genau diesen Re-Run** hinter vier Bremsen.

**Bei einem überfälligen/verwaisten Ticket gibt es keinen sinnvollen Re-Run.** helix hat das Ticket nicht erzeugt (es kam aus Linear), es gibt keinen `sourceRunId`, kein Skill, den man „erneut ausführen" könnte. Ein Auto-„Re-Run" wäre bedeutungslos — es gäbe nichts zu re-runnen.

| Stufe | Auf Tool-Flags anwendbar? | Was es hier bedeutet |
|---|---|---|
| **report** (Default) | **Ja, voll** | Flag + Notify. Der Mensch schaut ins Ticket/Linear. Exakt der bestehende `report`-Pfad. |
| **suggest** | **Nur als Review-Hinweis** | Wie bei Metrik-Flags: `suggestedAction` = ein Review-Satz („Ticket ABC-123 ist überfällig — im Board prüfen"), **kein** `correction`-Pointer → **kein** „Korrektur starten"-Button. Exakt das Muster von `buildMetricSuggestedActionText` (`suggest.ts:59-67`) und `buildMetricFlag` (das bewusst **kein** `correction` setzt, `metric-flags.ts:46-53`). |
| **autonomous** | **Nein** | Es gibt nichts zu auto-starten. Wie schon bei Metrik-Flags dokumentiert (`tick.ts:95-100`): kein `correction` ⇒ `maybeAutoCorrect` hat nichts zu tun. Tool-Flags **melden**, sie korrigieren nie automatisch. |

**Technische Konsequenz (sauber, weil das bestehende Design es schon trägt):**
Tool-Flags tragen — wie Metrik-Flags — **nie** einen `correction`-Pointer. Damit:
- erscheint **kein** „Korrektur starten"-Button (dessen Sichtbarkeit hängt an `correction != null`, `flags-view.ts:56-60, 138-149`),
- ruft `maybeAutoCorrect` nie an (die Auto-Korrektur greift nur, wenn `proposal.correction` gesetzt ist, `evaluate.ts:148-150`) — und selbst wenn, wäre `sourceRunIsCorrection`/Startpfad nicht anwendbar.

Das bestehende Autonomie-Design schließt gefährliche Autonomie auf Tool-Arbeit also **von selbst** aus — es muss nichts „abgeschaltet" werden. Genau deshalb ist Schritt F sicher: er kann strukturell nur melden.

> Falls je eine **schreibende** Reaktion gewünscht ist (Kommentar ins Ticket, Assignee setzen) — das ist **Block 3c / Teil H** des OS-Bauplans (`helix-os-bauplan-us.md:208-222`), ein `acts:true`-Effekt strikt hinter dem Approval-Gate, **nicht** Teil des Loops und **nicht** dieses Plans.

---

## 7 — Ehrliche Risiken

| Risiko | Warum real | Gegenmittel (konkret) |
|---|---|---|
| **Alarm-Müdigkeit (größtes Risiko)** | Tool-Daten sind viel zahlreicher und lauter als Deliverables — hunderte Tickets vs. wenige Frameworks. Zu viele Flags ⇒ das eine wichtige geht unter. | (1) Konservative Schwellen zuerst (STALE_DAYS/GRACE_DAYS hoch), erst nach Kalibrierung senken. (2) Dedup pro `externalRef`+Kriterium (§5). (3) Batch-Limit `MAX_OBSERVATIONS_PER_TICK` (z.B. 50, `helix-os-bauplan-us.md:560`). (4) Nur Delta seit letztem Tick (`since`). (5) Erste 10 Flags manuell reviewen, dann justieren (wie Schritt A, `loop-implementierungsplan.md:554`). |
| **„Baut das Team das Richtige" wird zu vage → LLM-Raterei** | Der verführerischste Ort für Scope-Creep (`helix-os-bauplan-us.md:256-259`). Die Versuchung, ein LLM „das Ticket beurteilen" zu lassen, ist groß. | Harte Grenze in §3: **nur** deterministische Feld-/String-Prüfungen. Alles, was ein Urteil bräuchte, ist explizit „nicht jetzt". Kein LLM im `check(obs)`, keiner in der Metrik. Reviewbar in Code, weil jedes Kriterium eine reine Funktion ist. |
| **Datenqualität / Duplikate** | Ohne `external_ref`-Dedup beim Ingest liefert der Konnektor Doppel-Docs ⇒ Doppel-Flags. | Dedup ist **harte Voraussetzung** (§0, `helix-os-bauplan-us.md:151`). `ToolArtifactSource` filtert `externalRef != null`; die Quelle „aktiviert" sich faktisch erst, wenn `external_ref` befüllt ist. |
| **Falsch-positive Feld-Prüfungen** | Fehlende `dueDate`/`state`-Felder (Konnektor unvollständig) ⇒ falsche „überfällig"-Flags. | Wie `computeLoopMetrics` bei fehlenden Daten (`metrics.ts:39-41`): **fehlt ein Feld → kein Flag** (nicht messbar ≠ verletzt). Jedes Kriterium prüft erst Feld-Präsenz, dann den Wert. |
| **Vertrauliche Tickets sichtbar** | Extern gelesene Docs dürfen nie `visibility='open'` sein. | fail-closed-Sichtbarkeit ist Voraussetzung des Konnektors (§0, `helix-os-bauplan-us.md:153-154`). Schritt F liest nur, ändert Sichtbarkeit nie. |

---

## 8 — Neue / geänderte Dateien (Schritt F)

**Neu:**
```
src/lib/loop/sources/tool_artifact.ts   ← ToolArtifactSource (Vorbild: sources/deliverable.ts)
src/lib/loop/criteria/ticket.ts         ← Kriterien-Set für type='ticket' (Vorbild: criteria/framework.ts)
```

**Geändert (additiv, Quelle 1 unberührt):**
```
src/lib/loop/sources/index.ts   ← toolArtifactSource in getObservationSources() (eine Zeile)
src/lib/loop/tick.ts            ← Registry-Iteration für Tool-Quellen (§5, Block B–D)
src/lib/loop/metrics.ts         ← + Tool-Metriken in computeLoopMetrics (§5)
```

**NICHT von Schritt F (Voraussetzung — OS-Bauplan Teil F):**
```
src/lib/connectors/…            ← ConnectorDef + Linear-Konnektor
prisma: documents.external_ref  ← Spalte + @@unique([orgId, external_ref])
prisma: documents.source_meta   ← JSONB für die Prüf-Felder (Option A, §2)
prisma: DocumentSource + ticket/code/doc
src/lib/rag/ingest.ts           ← externalRef-Upsert-Pfad + source_meta
```

**Unverändert (bewusst — das ist der Beleg, dass „nur die Quelle neu" ist):**
`src/lib/loop/sources/types.ts` · `src/lib/loop/flags-view.ts` · `src/lib/loop/metric-flags.ts` · `src/lib/loop/evaluate.ts` · `src/lib/loop/notify.ts` · `src/lib/loop/suggest.ts` · `src/lib/loop/auto-correct.ts` · `src/lib/loop/settings.ts` · gesamtes Flags-UI.

---

## 9 — Was VORHER existieren muss + Größe

**Muss vorher existieren (sonst ist Schritt F nicht baubar):**
1. **Mind. 1 lesender Konnektor** (empfohlen: Linear-Push) — OS-Bauplan Teil F, Etappe 3.
2. **`documents.external_ref`** + `@@unique([orgId, external_ref])` + `externalRef`-Upsert in `ingestDocument` — Ingestion-Dedup, Teil F.
3. **`DocumentSource`-Werte `ticket` (min.), optional `code`/`doc`** — Teil F.
4. **`documents.source_meta` (JSONB)** mit den Prüf-Feldern (`dueDate, state, assigneeId, lastActivityAt, sprintId`) — vom Konnektor beim Ingest gefüllt (Option A, §2).
5. **fail-closed-Sichtbarkeit** extern gelesener Docs (`restricted`/`confidential`, nie `open`) — Teil F.

**Größe von Schritt F, WENN (1)–(5) existieren: KLEIN bis MITTEL.**
- `ToolArtifactSource`: ~60–90 LOC (fast 1:1 zu `deliverable.ts`).
- `ticket.ts` Kriterien-Set: ~120–160 LOC (5 reine Funktionen, Muster von `framework.ts`).
- Tick-Erweiterung (Registry-Iteration + Dedup pro externalRef): ~60–100 LOC.
- Tool-Metriken in `metrics.ts`: ~60–90 LOC.
- **Summe: ~300–440 LOC, 1–2 Tage** — deckt sich mit der Schätzung im Loop-Plan (`loop-implementierungsplan.md:499`).

**Der Grund für „klein–mittel":** Der gesamte teure Teil (Flag-Format, `toFlagView`, Notify, Autonomie-Gate, Cron-Gerüst, Dedup-Muster) ist durch Schritt A–E **schon gebaut** und quellenunabhängig. Schritt F ist genau das, wofür das `ObservationSource`-Interface entworfen wurde: **eine neue Quelle + ein neues Kriterien-Set andocken, sonst nichts.** Der ganze Aufwand steckt in der **Voraussetzung** (dem Konnektor, Teil F) — nicht in Schritt F selbst.
