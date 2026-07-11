# helix als „AI Operating System" — Vollständiger Bauplan

**Stand:** 2026-07-04 · **Art:** Reine Planung (kein Code geändert) · **Autor:** Claude (Opus 4.8)

> **Dieses Dokument ergänzt [`os-analyse.md`](./os-analyse.md) — es wiederholt sie nicht.**
> `os-analyse.md` deckt den Deliverable-Pfad (Rohmaterial → Kern → Deliverable), das Kunden-Gedächtnis,
> das Ausführungsmodell (15-s-Tx-Wand, request-übergreifender Resume, Vercel-nativ vs. durable Queue) und
> die Etappen 1–4 ab. Hier wird die **gesamte Ziel-Architektur** durchgeplant, indem die dort nur
> angerissenen Felder ausgearbeitet werden: **lesende Tool-Anbindung** (Block 1), **Warn-Flags + Loop**
> (Block 3b + 4) und **schreibende Tool-Aktionen** (Block 3c). Wo `os-analyse.md` etwas behandelt, steht
> hier ein Verweis (z. B. „→ os-analyse.md B.2"), keine Wiederholung.

---

## Die nicht verhandelbare Regel (gilt für JEDEN Baustein hier)

**Niemals einen LLM-Call oder einen langsamen externen Tool-Call innerhalb einer `withTenant`-Transaktion.**
Teurer Netzwerk-Call **vor** der Transaktion ausführen, dann das Ergebnis in einer kurzen Transaktion
atomar schreiben (`skill_step`/`document`/Flag + Audit). Begründung, Codebeleg und Failure-Mode:
→ **os-analyse.md B.1 und E** (15-s-Tx-Timeout in `src/lib/tenant.ts:47-54`; das etablierte Muster in
`answerQuestion`/`ingestDocument`). Jeder neue Konnektor, jede Metrik-Berechnung, jeder Flag-Check hält
sich daran: erst rechnen/holen, dann in Millisekunden schreiben.

---

## Architektur-Landkarte: die vier Blöcke → wo geplant

| Block | Inhalt | Wo durchgeplant |
|---|---|---|
| **1 — Inputs** | Transkripte, Mails, Tickets, Code, Docs aus den Firmen-Tools aufnehmen & **laufend lesen** | Datei-Upload/Transkripte: → os-analyse.md A.1. **Kontinuierliches Tool-Lesen: Teil F (neu).** |
| **2 — Kern** | Wissensbasis (RAG), Skills, Governance, Gedächtnis | Vollständig → os-analyse.md A + C (RAG-Retrieval, Engine, Approval/Governance, Kunden-Entität C.3). |
| **3a — Deliverables** | Frameworks, Use Cases, später PPTX | Vollständig → os-analyse.md A.1, B.3, C.1/C.4, Etappen 1–3. |
| **3b — Warn-Flags** | „Ihr baut das Falsche" — Abweichung vom Soll melden | **Teil G (neu).** |
| **3c — Tool-Aktionen** | Schreibend zurück in die Systeme | Grundprinzip → os-analyse.md A.4/Etappe 4. **Konkretisierung: Teil H (neu).** |
| **4 — Loop** | beobachten → Soll/Ist → (Mensch) nachjustieren → Artefakte ändern → von vorn | Prinzip & Ehrlichkeit → os-analyse.md B.5. **Mechanik: Teil G (neu).** |

Die drei neuen Teile (F, G, H) und der erweiterte Etappenplan (Teil I) + Risiken (Teil J) machen die
Architektur zu 100 % durchgeplant.

---

## Teil F — Block 1 (lesend): kontinuierliche Tool-Anbindung

`os-analyse.md` behandelt nur den **einen ausgehenden** Effekt (E-Mail raus, A.4) und nennt „kein Framework
für Tool-Definitionen" als Lücke. Hier: wie Tickets (Linear), Code (GitHub), Kalender/Docs (Google) **rein**
kommen — laufend, mandantensicher, DSGVO-konform.

### F.0 Der wichtigste Befund: das Fundament ist überraschend vollständig, aber pro Tool hand-zu-verdrahten

Es gibt **kein generisches Konnektor-/Integrations-Framework** — Slack und Clerk sind **jeweils
hand-verdrahtet** (getrennte Signatur-Verifier `src/lib/slack/verify.ts` vs. `src/lib/clerk/verify.ts`,
getrennte Routen-Ordner, getrennte Handler). Geteilt werden nur Idempotenz (`claimSlackEvent`),
Rate-Limit (`src/lib/slack/ratelimit.ts`), `withTenant` und `logAudit`. Die **Effekt-Provider-Abstraktion**
(`src/lib/effects/`, `src/lib/ai/`) ist rein **ausgehend** — sie ist **kein** eingehendes Konnektor-Framework.

**Aber:** Jedes sicherheitskritische Teilstück, das ein Tool-Konnektor braucht, existiert bereits als
produktive Vorlage. Der Bauplan setzt genau darauf auf:

| Konnektor-Baustein | Bestehende Vorlage (Datei) | Wiederverwendung |
|---|---|---|
| **OAuth-Install** (Admin autorisiert Tool) | `src/lib/slack/oauth.ts` — signierter, stateless State (HMAC, orgId+expiry, CSRF-Bindung), injizierbarer Token-Exchange (`setSlackOAuthExchanger` für Tests) | 1:1 Muster: `start`→authorize→`callback`→exchange→speichern. Pro Tool ein eigener Scope-Satz. |
| **Verschlüsselte Token-Speicherung** | `src/lib/crypto.ts` (`encryptString`/`decryptString`, AES-256-GCM) + Auflösung `resolveBotToken()` in `src/lib/slack/client.ts` (`enc:<payload>` vs. `env:VAR`) | **DB hält nie ein Klartext-Token.** `crypto.ts` ist bereits generisch (`envName`-Parameter); Kommentar: „when a real vault/KMS arrives, only this module changes". Jedes Tool-Access-Token wird `enc:`-gespeichert. |
| **Eingehende Events verifizieren** | `src/lib/slack/verify.ts` (HMAC) + `src/lib/clerk/verify.ts` (Svix, selbst nachgebaut) | Pro Tool ein Verifier nach demselben Schema (Raw-Body, ±5 min Replay-Fenster, `timingSafeEqual`). |
| **Tenant-Auflösung OHNE Kontext** (welcher Mandant?) | `resolveSlackTeam()` (`src/lib/slack/team.ts:29-46`) über die **SELECT-only Bootstrap-Policy** (Migration 0006, GUC `app.slack_team_lookup`) | Das kritischste Muster: ein eingehendes Linear-/GitHub-Event trägt nur eine externe Workspace-/Repo-ID. Pro Tool eine analoge Mapping-Tabelle (`linear_workspace → org`) + Bootstrap-Policy. |
| **Idempotenz** (kein Doppel-Verarbeiten) | `claimSlackEvent(orgId, key)` (`src/lib/slack/idempotency.ts`) — **wird bereits von Slack UND Clerk geteilt** (Präfixe `events:`/`clerk:`) | Generisch nutzbar, nur neuer Key-Namespace (`linear:<deliveryId>`). |
| **ack-then-work** | `deferWork()` (`src/lib/slack/defer.ts`) + `waitUntil` | Webhook sofort 200, teure Verarbeitung danach (→ dieselbe Vercel-Timeout-Einschränkung wie os-analyse.md B.1). |
| **Text-Ingestion** (Tool-Daten → Wissensbasis) | `ingestDocument()` (`src/lib/rag/ingest.ts`) nimmt **beliebigen** `text: string` — quellen-agnostisch; `chunkText()` ebenso | Ticket-Text, Mail-Body, Commit-Message gehen direkt durch. Der Datei-Extraktor (`extract.ts`) ist nur ein vorgeschalteter Text-Lieferant. |

### F.1 Empfehlung: eine dünne Konnektor-Schicht (kein schweres Framework)

Ein einheitliches `Connector`-Interface, spiegelbildlich zur Effekt-Provider-Denke, aber **eingehend**.
Kein ESB, keine Plugin-Engine — nur ein gemeinsamer Vertrag, damit nicht jedes Tool alles neu erfindet:

- **`ConnectorDef`** (neu, `src/lib/connectors/types.ts`): `key` (`linear`|`github`|`google_cal`…), `oauthScopes`,
  `verifyWebhook(req)` (Signatur), `resolveTenant(externalId)` (Bootstrap-Policy-Lookup),
  `normalize(event) → { externalId, title, text, source, occurredAt }` (Tool-Payload → ingestierbarer Text).
- **Zwei Betriebsarten pro Konnektor:**
  - **Push (Webhook):** Tool ruft `POST /api/connectors/<key>/webhook` → Gate-Sequenz **exakt wie Slack/Clerk**
    (Signatur → Tenant → Idempotenz → ack-then-work → normalisieren → `ingestDocument`). Bevorzugt, wo das
    Tool Webhooks bietet (Linear, GitHub).
  - **Pull (Poll):** Für Tools ohne brauchbare Webhooks (oder für „Nachlese") ein **Cron-Poller** nach dem
    **exakten Muster von `/api/cron/retention`** (`CRON_SECRET`-Bearer-Auth, fail-closed 503/401, Antwort nur
    Zählwerte) — pro Tick: pro Tenant offene Deltas holen (Token via `resolveBotToken`/`decryptString`
    **vor** der Tx), normalisieren, `ingestDocument` (kurze Tx). Der Poll-Cursor (`last_synced_at`/Cursor)
    liegt in der Konnektor-Installations-Zeile.
- **Warum dünn:** Die Sicherheitslogik (Signatur, Tenant-Auflösung, Idempotenz) bleibt pro Tool explizit
  (sie ist sicherheitskritisch und tool-spezifisch); geteilt wird nur das Skelett + die Ingestion.

### F.2 Zwei harte Lücken, die Block 1 blockieren, wenn sie nicht mitgebaut werden

Beide sind **DSGVO-/Korrektheits-kritisch** und heute **nicht vorhanden**:

**(a) Kein Ingestion-Dedup.** `documents` hat **keine** `external_id`/`source_ref`/Content-Hash-Spalte
(`prisma/schema.prisma:359-379`). `ingestDocument` kann ein *bekanntes* Dokument ersetzen
(`replaceDocumentId`), aber der Aufrufer muss die interne id schon kennen. **Folge:** ein wiederholter Poll
desselben Linear-Tickets legt ein **zweites** Document an → Duplikate in der Wissensbasis, verzerrtes
Retrieval. **Baustein:** Spalte `external_ref` (z. B. `linear:issue:ABC-123`) + `@@unique([orgId, external_ref])`
auf `documents`; `ingestDocument` bekommt einen `externalRef`-Upsert-Pfad (bei Treffer → `replaceDocumentId`-
Logik, sonst neu). **Größe: klein–mittel.** **Audit/Tenant:** unverändert (RLS greift, Audit `knowledge.reingested`).

**(b) Keine Dokument-Retention.** Die automatische Retention betrifft **ausschließlich `chat_messages`**
(`enforceChatRetention`/`runRetentionSweep`, → os-analyse.md B.2). `org_settings` hat nur
`chatRetentionDays` — **keine** `documentRetentionDays`. **Folge:** extern gelesene Tickets/Mails (echte
Personendaten!) lägen **unbegrenzt** als `documents`/`chunks`, bis jemand manuell `deleteDocument()` ruft
oder der Tenant offboardet. Das bricht das „GDPR-native"-Versprechen bei kontinuierlicher Fremd-Ingestion.
**Baustein:** `documentRetentionDays` (global und/oder pro Konnektor) auf `org_settings` bzw. der
Konnektor-Installation; der nächtliche Sweep (`runRetentionSweep`, `src/lib/lifecycle/index.ts`) bekommt
einen zweiten Zweig, der abgelaufene *konnektor-erzeugte* Dokumente cascade-löscht (Chunks folgen via
`onDelete: Cascade`, `schema.prisma:395`). **Größe: mittel.** **Audit:** `document.purged` (neuer Agent-Actor
`retention`, analog `chat.purged`).

**Weiterer Pflicht-Punkt — Default-Sichtbarkeit fail-closed.** Extern gelesene Dokumente dürfen **nicht**
`visibility='open'` bekommen (das wäre für vertrauliche Tickets ein Leak). Default fail-closed auf
`restricted`/`confidential` je Konnektor-Konfiguration; die rollenbasierte Disclosure (`visibility_grants`,
→ os-analyse.md, `src/lib/rag/retrieve.ts`) greift dann automatisch.

### F.3 DocumentSource-Enum

Für saubere Herkunft (`ticket`/`email`/`code`/`doc`) neue Enum-Werte (`ALTER TYPE "document_source" ADD
VALUE …`, neue Migration; das Feld ist reines Metadatum, → `schema.prisma:52-58`). **Größe: klein.**

### F.4 Einordnung im Plan

Block 1 (lesend) sitzt in **Etappe 3–4** (Teil I). Grund: er hängt an der Kunden-Entität (ein Ticket gehört
zu Kunde/Projekt X — `clientId`, → os-analyse.md C.3) und an der Dedup-/Retention-Nachrüstung. **Ein
einzelner Push-Konnektor (Linear) als schmaler erster Beweis** ist aber schon nach Etappe 2 machbar.

---

## Teil G — Block 3b + Block 4: Warn-Flags und der Loop-Mechanismus

`os-analyse.md B.5` liefert die **Haltung** (kein autonomer Qualitäts-Regelkreis; „Soll" = explizite
Akzeptanzkriterien + Prozess-Metriken; Nachjustieren bleibt beim Menschen). Hier: die **konkrete Mechanik**
— was ein Warn-Flag technisch ist, woraus es entsteht, wie es zum Menschen kommt, und wo die Grenze liegt.

### G.1 Die zwei Soll-Quellen, beide maschinell prüfbar

**Soll-Quelle 1 — Akzeptanzkriterien pro Deliverable-Typ (Struktur-Abgleich).**
Pro Deliverable-Typ definiert ein Preset *prüfbare* Bedingungen (Daten, kein Freitext), z. B. für
`transkript_zu_framework`: `mindestens 3 Use Cases`, `jede Kernaussage trägt eine Transkript-Quelle`,
`Executive Summary vorhanden`. Diese sind **strukturell** prüfbar — kein LLM-Urteil nötig.

Die **Blaupause existiert**: der Answer-Trace (`chat_messages.trace`, Migration 0021, `src/lib/rag/answer.ts`
`AnswerTrace`) hält bereits „welche Quelle mit welcher Ähnlichkeit stützt die Antwort". Ein Deliverable-Step
erzeugt analog einen **Deliverable-Trace** (welche Aussage ↔ welcher Transkript-Chunk). Die Kriterien-Prüfung
ist dann eine reine Funktion über diesem Trace + der Deliverable-Struktur — deterministisch, testbar,
**kein LLM in der Prüfung**. Ergebnis: `{ kriterium, erfüllt: bool, detail }[]`.

**Soll-Quelle 2 — Prozess-Metriken (aus vorhandenen Signalen, kein neues Tracking nötig).**

| Metrik | Woraus (bereits vorhanden) | „Soll" |
|---|---|---|
| **Erfolgsquote** `completed/(completed+rejected+failed)` | **schon fertig berechnet**: `computeValueStats().successRate` (`src/lib/value.ts:259-267`) | soll ≥ Schwellwert bleiben |
| **Freigabe-Quote** (angenommen vs. abgelehnt) | `audit_log` `approval.approved` / `approval.rejected` (`queryAuditLog` mit Präfix `approval.`) | soll steigen |
| **Iterations-/Rückfrage-Rate** | Anzahl Läufe pro Kunde/Deliverable-Typ bis Freigabe (`skill_runs` + `clientId`) | soll sinken |
| **Feedback-Signal** | `chat_feedback` 👍/👎 (`src/lib/rag/feedback.ts`) | 👎-Quote soll niedrig bleiben |

Alle vier sind **Aggregationen in der Tenant-Tx** (Muster: `computeValueStats`, mode-gefiltert), also
RLS-scoped und ohne externen Call.

### G.2 Was ein Warn-Flag technisch IST

Es gibt heute **kein** Flag-/Alert-Modell. Zwei Ausbaustufen, bewusst gestuft:

**Stufe A (minimal, empfohlen für den Einstieg) — Flag = Audit-Eintrag.**
Ein Flag entsteht als `logAudit(tx, { action: 'flag.<typ>', actorType: 'agent', target: <deliverable/client>,
detail: { kriterium, ist, soll, schwere } })`. Vorteile: append-only, tenant-scoped, **sofort in der
bestehenden Audit-UI** sichtbar/filterbar (`queryAuditLog` filtert nach action-Präfix, `src/lib/audit.ts:65-88`)
— **keine neue Tabelle, keine neue UI**. Für „helix hat X bemerkt" ist das der natürliche Persistenz-Ort.

**Stufe B (später, nur wenn nötig) — Flag = eigene Entität mit Status.**
Falls Flags mehr sein sollen als Log-Zeilen (Status `offen/quittiert/erledigt`, „Inbox", Zuweisung):
neue Tabelle `flag` (tenant-scoped, RLS ENABLE+FORCE, FK auf `organizations` + optional `clientId`/`runId`,
`@@unique([id, orgId])` — **exakt das Standard-Tabellenmuster**). Das ist **mutabler Arbeitszustand**
(Status ändert sich) — gehört also, wie die Kunden-Entität, **nicht** ins append-only Audit (→ os-analyse.md
B.2, dieselbe Trennung). Das Audit hält die unveränderliche Spur („Flag erzeugt", „Flag quittiert von …").

### G.3 Wo ein Flag entsteht und wie es zum Menschen kommt

**Entstehung — zwei Auslöser, beide regel-basiert (kein LLM als Richter):**
1. **Am Ende eines Deliverable-Laufs:** ein letzter *lesender* Step prüft die Akzeptanzkriterien (G.1,
   Quelle 1) über dem Deliverable-Trace. Verletzung → Flag. Das passt in die bestehende Engine als
   `acts:false`-Step (kein Effekt, keine Freigabe nötig).
2. **Periodisch (der eigentliche „Loop-Tick"):** ein Cron nach dem `/api/cron/retention`-Muster rechnet pro
   Tenant die Prozess-Metriken (G.1, Quelle 2) und vergleicht gegen die hinterlegten Schwellwerte.
   Abweichung → Flag. **Regel:** Metrik holen/aggregieren in der Tenant-Tx, Flag + Audit in derselben (kurzen)
   Tx schreiben — keine langen Calls.

**Zustellung — Kanäle existieren alle (kein Neubau):**
- **Slack-Post** in einen konfigurierten Channel: `postSlackMessage` (`src/lib/slack/client.ts`), gern als
  Block-Kit-Karte (dasselbe Muster wie `approvalBlocks`) → „⚠️ Deliverable X: Kriterium ‚jede Aussage
  belegt' verletzt (3 Aussagen ohne Quelle)".
- **E-Mail** an einen Alias: exakt das Muster von `notifyApprovalRequested` (`src/lib/skills/notify.ts`,
  liest `org_settings.approval_notify_email` bzw. ein neues `flag_notify_email`).
- **Externer Sink** (Ops-Alerting): `ERROR_WEBHOOK_URL` via `src/lib/error-reporter.ts`-Muster.

**Auditierung:** immer (Stufe A ist der Audit-Eintrag; Stufe B schreibt zusätzlich `flag.created`).

### G.4 Die klare, harte Grenze — beobachten+melden (baubar) ↔ autonom nachjustieren (NICHT jetzt)

- **In-Scope (Block 4, baubar):** beobachten (Metriken/Kriterien berechnen) → mit Soll vergleichen →
  **Flag erzeugen + Mensch benachrichtigen**. helix *meldet* „ihr baut das Falsche". Punkt.
- **Bewusst NICHT jetzt:** helix ändert **selbstständig** einen fertigen Deliverable oder startet autonom
  einen Korrektur-Lauf, weil eine Kennzahl abweicht. Das ist der spekulativste Schritt (→ os-analyse.md B.5).
  Der maximal vertretbare *nächste* Schritt wäre **„vorschlagen, nicht ausführen"**: ein Flag darf einen
  Nachbesserungs-Lauf **anbieten** (Button „Korrektur starten") — der Mensch löst ihn aus, und dann läuft er
  durch das **normale Approval-Gate**. Damit bleibt der Loop geschlossen (Output → verändert Artefakt → neue
  Beobachtung), ohne autonomen Qualitäts-Regelkreis.

### G.5 Einordnung im Plan

Warn-Flags/Loop sitzen in **Etappe 4** (→ os-analyse.md Etappe 4). Stufe A (Flag = Audit-Eintrag +
Zustellung) ist der schmale, ehrliche Einstieg; Stufe B (Flag-Entität) erst bei Bedarf.

---

## Teil H — Block 3c: schreibende Tool-Aktionen

`os-analyse.md A.4/Etappe 4` nennt das Prinzip („weitere `acts:true`-Effekte hinter dem Gate"). Hier die
Konkretisierung, wie neue schreibende Konnektoren (Kalender-Event anlegen, CRM-Notiz schreiben, Doc
erzeugen) eingehängt werden, **ohne die Governance zu lockern**.

### H.1 Der Rahmen ist gebaut — schreibende Aktionen sind „nur" neue Effekt-Provider

`src/lib/effects/types.ts` sagt es wörtlich: *„Effects run ONLY inside acting skill steps — i.e. strictly
AFTER the guardrail/approval gate. … an effect provider has no way to run without an approved (or ungated)
acting step."* Damit ist die Governance-Frage bereits **strukturell** beantwortet: ein schreibender
Tool-Effekt ist ein Step mit `acts:true`; er läuft nie ohne Guardrail-Verdikt bzw. Freigabe (→ os-analyse.md
A.3/B.4, Approval-Gate in `src/lib/skills/engine.ts`).

**Muster pro Schreib-Konnektor** (spiegelbildlich zu `getEmailProvider`):
- Ein `ToolActionProvider`-Interface (analog `EmailProvider`, `src/lib/effects/types.ts`) mit einer schmalen
  Methode pro Aktion (`createCalendarEvent(...)`, `createCrmNote(...)`), Fake in dev/test, real in prod
  (Factory-Muster `getEmailProvider`, prod ohne Key → wirft).
- **Token:** dasselbe verschlüsselte `enc:`-Token aus dem OAuth-Install (Teil F) — via `decryptString`
  **vor** der Tx aufgelöst, der eigentliche Tool-Call passiert **außerhalb** der Tx (nicht-verhandelbare
  Regel), nur das Ergebnis (`{ externalId, provider }`) wird atomar in `skill_step.detail` + Audit geschrieben.
- **Dry-run bleibt gratis:** `describeEffect` (schon im `StepDef`, → os-analyse.md A.1) liefert die
  Probelauf-Vorschau „was würde geschrieben", ohne zu schreiben — die bestehende Simulation greift automatisch.

### H.2 Governance NICHT lockern — konkret

- **Neuer Effekt = neuer Guardrail-Grund.** Wie `angebot_erstellen` bei *jeder* externen Wirkung eine
  Freigabe erzwingt (Guardrail triggert immer), bekommt jeder Schreib-Konnektor einen sinnvollen Guardrail
  (z. B. „CRM-Schreibzugriff verlässt das System → Freigabe", oder Threshold-basiert). Der **Geld-Failsafe**
  und das Fail-closed-Prinzip bleiben unangetastet (→ os-analyse.md E, Punkt 6).
- **Presets erweitern, nicht umgehen.** Neue Schreib-Skills bekommen Default-Approval-Policies in den
  Industry-Presets (`src/lib/policies/presets.ts`), fail-closed (`handlesMoney`-Analogon für irreversible
  externe Schreibzugriffe → nie `never`).
- **Mehrstufige Autonomie** (mehrere Schreibaktionen in einem Lauf, je einzeln freizugeben) braucht die
  **checkpoint-gebundenen Approvals** aus os-analyse.md C.5/B.4 (Approval an `stepIdx` binden statt run-global).

### H.3 Einordnung im Plan

Schreibende Tool-Aktionen sitzen in **Etappe 4** (→ os-analyse.md), **nach** den checkpoint-gebundenen
Approvals (C.5), damit mehrere Schreibaktionen sauber einzeln freigegeben werden können.

---

## Teil I — Erweiterter Etappenplan (alle vier Blöcke)

Baut auf dem 4-Etappen-Plan aus **os-analyse.md Teil D** auf und ordnet die neuen Blöcke ein. Größenordnung
wie dort: **klein** (Tage) · **mittel** (1–2 Wochen) · **groß** (mehrere Wochen).

> **Ehrliche Zeit-Einordnung zum 27. Juli:** Realistisch bis zum 27.07. liegt **Etappe 1** (der erste
> Deliverable-Skill) und ggf. der **Anfang von Etappe 2**. Alles ab „Kunden-Entität + Artefakt-Speicher +
> request-übergreifende Ausführung" (Rest Etappe 2) und **alle drei neuen Blöcke** (Teil F/G/H, die in
> Etappe 3–4 sitzen) liegen **nach dem 27. Juli**. Das ist keine Schwäche des Plans, sondern die ehrliche
> Folge davon, dass Blocks 1/3b/3c/4 auf der Kunden-Entität und dem robusten Ausführungs-Treiber aufsetzen.

| Etappe | Inhalt (→ os-analyse.md) | **Neu aus diesem Dokument** | Zeit |
|---|---|---|---|
| **1** | Erster Deliverable-Skill `transkript_zu_framework`, Text-Output, bestehende Engine + Approval + Slack (D/Etappe 1) | — | **bis 27.07.** |
| **2** | Kunden-Entität + Artefakt-Speicher (Vercel Blob) + request-übergreifende Ausführung Vercel-nativ (D/Etappe 2) | **Ingestion-Dedup `external_ref` (F.2a)** und **Dokument-Retention (F.2b)** als Vorarbeit mitziehen — sie gehören logisch zur Daten-Ablage | **nach 27.07.** |
| **3** | Checkpoint-Approvals (C.5) + durable Queue + PPTX + strukturierte LLM-Ausgabe (D/Etappe 3) | **Block 1 lesend: erster Push-Konnektor (Linear)** nach dem Slack/Clerk-Muster (Teil F.1); `DocumentSource`-Enum (F.3) | **nach 27.07.** |
| **4** | Closed Loop schmal + schreibende Tool-Anbindung (D/Etappe 4) | **Warn-Flags Stufe A (Teil G)**, **weitere Lese-Konnektoren (F)**, **Schreib-Konnektoren als Effekt-Provider (Teil H)**; Flag-Entität Stufe B nur bei Bedarf | **nach 27.07.** |

**Der schmale erste Beweis pro neuem Block** (falls früher gewünscht, ohne die ganze Etappe):
- Block 1: **ein** Linear-Webhook, der Tickets als `documents` (mit `external_ref`, `restricted`) ingestiert.
- Block 3b/4: **eine** Akzeptanzkriterien-Prüfung am Ende von `transkript_zu_framework` → Flag als Audit-Eintrag
  (Stufe A) + Slack-Post.
- Block 3c: **ein** Schreib-Effekt (z. B. Kalender-Event) als `acts:true`-Step mit Guardrail.

---

## Teil J — Ehrliche Risiken pro neuem Block

Ergänzt os-analyse.md Teil E (dort: die transaktionale Kern-Regel, der Charakter-Bruch, das GDPR-Loch der
Kunden-Entität, Scope des Loops). Hier die Risiken der **neuen** Blöcke.

### Block 1 (lesend) — Risiko: DSGVO-Loch + Datenqualität, weniger Destabilisierung

- **Größtes Risiko (DSGVO):** kontinuierliches Einlesen fremder Tool-Daten **ohne** die Dokument-Retention
  (F.2b) und **ohne** fail-closed-Sichtbarkeit (F.2) reißt genau das „GDPR-native"-Versprechen auf, das
  helix verkauft. **Beide müssen mit dem ersten Konnektor kommen, nicht später.**
- **Datenqualität:** ohne Dedup (F.2a) verschmutzt wiederholtes Pollen die Wissensbasis mit Duplikaten →
  schlechteres Retrieval für *alle* Features (auch den Chat). Ebenfalls Pflicht ab dem ersten Konnektor.
- **Destabilisierung: gering.** Eingehende Konnektoren laufen als eigene Routen/Cron, isoliert vom
  Deliverable-Pfad; sie erben Signatur/Idempotenz/Tenant-Muster. Die 3-Sek-/Timeout-Falle (`deferWork` auf
  Vercel) gilt auch hier — Webhooks müssen ack-then-work nutzen.
- **Scope-Falle:** „alle Tools anbinden" ist unbegrenzt. Diszipliniert **ein** Tool (Linear) als Muster,
  dann inkrementell. Ein generisches Framework auf Vorrat wäre Überbau (F.1: dünn halten).

### Block 3b + 4 (Warn-Flags/Loop) — Risiko: Scope-Explosion + falsches Vertrauen

- **Größtes Risiko (Scope):** der Loop ist der verführerischste Ort für Feature-Creep (→ os-analyse.md E).
  **Gegenmittel:** Stufe A (Flag = Audit-Eintrag) zuerst; harte Grenze bei „melden, nicht nachjustieren"
  (G.4). Keine LLM-als-Richter-Regelgröße.
- **Falsches Vertrauen / Alarm-Müdigkeit:** schlecht kalibrierte Kriterien erzeugen Rausch-Flags → Menschen
  ignorieren sie → das eine *wichtige* Flag geht unter. **Gegenmittel:** nur **struktur-prüfbare** Kriterien
  (G.1 Quelle 1) und **wenige** Prozess-Schwellwerte; Kriterien pro Deliverable-Typ explizit und editierbar.
- **Destabilisierung: gering**, solange Flags rein lesend entstehen (kein Effekt, keine Freigabe). Stufe B
  (Flag-Entität) ist mutabler Zustand → dieselbe Audit-Trennung wie die Kunden-Entität beachten (G.2).

### Block 3c (schreibend) — Risiko: höchstes Destabilisierungs-/Governance-Risiko

- **Größtes Risiko:** ein schreibender Tool-Effekt ist **irreversibel nach außen** (CRM-Eintrag, Kalender-
  Einladung an einen Kunden). Ein Bug hier hat echte Außenwirkung. **Gegenmittel:** strikt hinter dem
  Approval-Gate (H.1), sinnvoller Guardrail pro Aktion (H.2), `describeEffect`-Vorschau im Probelauf, und
  **nie** die Governance-Semantik lockern, „um autonomer zu wirken" (→ os-analyse.md E, Punkt 6).
- **Token-Sicherheit:** Schreib-Scopes sind mächtiger als Lese-Scopes. Minimale OAuth-Scopes pro Konnektor;
  Token immer `enc:` (crypto.ts), nie im Klartext/Log (`maskSecrets` greift). Der Tool-Call **außerhalb** der
  Tx (nicht-verhandelbare Regel), nur das Ergebnis atomar geschrieben.
- **Reihenfolge:** erst checkpoint-gebundene Approvals (os-analyse.md C.5), sonst kann ein mehrstufiger
  Schreib-Lauf nicht sauber einzeln freigegeben werden.

---

## Anhang — Neue Datei-/Modulverweise (ergänzend zu os-analyse.md Anhang)

| Thema (neu behandelt) | Pfad |
|---|---|
| OAuth-Install-Muster (signierter State, injizierbarer Exchange) | `src/lib/slack/oauth.ts` |
| Verschlüsselte Token-Speicherung (AES-256-GCM, generisch) | `src/lib/crypto.ts` · Auflösung `enc:`/`env:`: `src/lib/slack/client.ts` (`resolveBotToken`) |
| Tenant-Auflösung ohne Kontext (Bootstrap-Policy) | `src/lib/slack/team.ts` (`resolveSlackTeam`) · Policy: `prisma/migrations/0006_slack/migration.sql` |
| Zweites Webhook-Muster (Svix, synchroner DB-Sync) | `src/lib/clerk/webhooks.ts` · Verify: `src/lib/clerk/verify.ts` |
| Idempotenz (geteilt von Slack **und** Clerk) | `src/lib/slack/idempotency.ts` (`claimSlackEvent`) |
| Cron-Muster (Blaupause für Poll-Ingestion & Loop-Tick) | `src/app/api/cron/retention/route.ts` |
| Quellen-agnostische Text-Ingestion | `src/lib/rag/ingest.ts` (`ingestDocument`) · `src/lib/rag/chunking.ts` |
| Trace-Blaupause für Akzeptanzkriterien | `src/lib/rag/answer.ts` (`AnswerTrace`, `chat_messages.trace`, Migration 0021) |
| Prozess-Metrik „Erfolgsquote" (fertig) | `src/lib/value.ts` (`computeValueStats().successRate`) |
| Feedback-Signal | `src/lib/rag/feedback.ts` (`chat_feedback`) |
| Warn-Flag-Zustellkanäle | `src/lib/skills/notify.ts` (E-Mail) · `src/lib/slack/client.ts` (`postSlackMessage`) · `src/lib/error-reporter.ts` (Webhook-Sink) |
| Effekt-Provider-Vertrag (Basis für Schreib-Konnektoren) | `src/lib/effects/types.ts` (Effekte nur hinter dem Gate) |
| Dokument-Löschung (cascade; Retention fehlt für Docs) | `src/lib/lifecycle/index.ts` (`deleteDocument`, `runRetentionSweep`) |
