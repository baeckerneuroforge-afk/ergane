# helix als „AI Operating System" — IST-Analyse gegen die Vision

**Stand:** 2026-07-04 · **Art:** Reine Analyse (kein Code geändert) · **Autor:** Claude (Opus 4.8)

---

## Kontext — warum dieses Dokument

helix ist heute eine **GDPR-native, mandantenfähige B2B-Foundation** mit einer disziplinierten
Phasen-Historie (Phase 0–18, je eine SQL-Migration + Tests). Es kann: Wissen ingestieren
(PDF/DOCX/MD/TXT + OCR), rollenbewusst per RAG beantworten, und **deklarative Skills** unter
Governance ausführen (Guardrail → Freigabe → Audit), auslösbar aus dem Dashboard **und** aus Slack.

Die Vision will daraus ein „AI Operating System" machen: die durchgehende Verarbeitungsschicht
**Input → Verarbeitung → Output**, mit angebundenen Tools und einem „Closed Loop"
(überwachen → Soll/Ist → nachjustieren). Fünf konkrete Ziel-Fähigkeiten:

1. **Deliverable-Generierung** (wichtigste): Rohmaterial (mehrere Transkripte) → strukturierte
   Deliverables (Frameworks, Use Cases, am Ende PowerPoint). Läufe dauern **Minuten**, viele LLM-Schritte.
2. **Firmen-/Kunden-Gedächtnis**: pro Kunde merken — mit wem, was gewollt, was rauskam.
3. **Einstellbare Autonomie**: voll autonom bis Human-in-the-Loop (Slack/Mail, Freigabe → weiter).
4. **Tool-Anbindung** (später): Systeme lesen **und** schreiben.
5. **Closed Loop**: kontinuierliches Monitoring + Soll/Ist-Abgleich.

Dieses Dokument prüft den IST-Zustand ehrlich gegen diese fünf Punkte und schlägt einen gestuften Weg vor.

**Kurz-Urteil vorweg:** helix ist **näher dran, als es scheint** — das Run/Step/Approval-Datenmodell,
der request-übergreifende Resume-Pfad und der interaktive Slack-Freigabe-Round-Trip sind bereits die
tragenden Balken für Deliverable-Läufe mit Human-in-the-Loop. Zugleich gibt es **drei harte, klar
benennbare Lücken**: (a) die Ausführung ist synchron-inline im Request mit einem **15-Sekunden-
Transaktions-Timeout pro Step**, (b) es gibt **keine Kunden-/Projekt-Entität** und **keine
Artefakt-Speicherung**, (c) **kein einziger produktiver Skill ruft heute ein LLM auf** — die Engine ist
bewusst eine deterministische Regel-/Effekt-Maschine. Der „Closed Loop" ist der schwächste, vagste
Teil der Vision und braucht eine schmale, messbare Definition von „Soll", sonst bleibt er Handwaving.

---

## Teil A — Was trägt schon?

Pro Ziel-Fähigkeit: was ist wiederverwendbar, und wo ist helix weiter als gedacht.

### A.1 Deliverable-Generierung — **überraschend viel Fundament vorhanden**

Das mentale Bild „das gibt es noch gar nicht" ist falsch. Das **Muster** existiert im Kleinen und
produktiv — `angebot_erstellen` (`src/lib/skills/catalog/angebot_erstellen.ts`) ist der lebende Beweis:

> Input (`kunde`, `leistung`, `betragEur`) → **Kontext aus der Wissensbasis holen** (`konditionen_geholt`,
> nutzt `holeWissen`) → **Dokument entwerfen** (`angebot_entworfen`) → **pausieren für menschliche Freigabe**
> (Guardrail triggert immer, weil externe Wirkung) → nach Freigabe **PDF erzeugen** (`renderBusinessPdf`)
> **und versenden** (`getEmailProvider().send`).

Das ist strukturell schon „Rohmaterial → Verarbeitung → Deliverable mit Human-in-the-Loop". Die
Deliverable-Vision ist **eine Vergrößerung dieses Musters** (mehr Input, längere Schritte, reicheres
Ausgabeformat), nicht etwas Fremdes.

Konkret wiederverwendbar:

| Baustein | Datei | Rolle für Deliverables |
|---|---|---|
| **Run/Step-Persistenz** | `prisma/schema.prisma:258-298` (`SkillRun`, `SkillStep`) | Jeder Step wird als Zeile mit `detail Json` persistiert. Das ist der Ort für Zwischenprodukte (Rohanalyse, Framework-Struktur, Foliengerüst). |
| **Request-übergreifender Resume** | `src/lib/skills/engine.ts:135-223` (`decide`→`executeFrom`) | `state` wird beim Wiederaufsetzen **aus der DB** rekonstruiert (`doneSteps` → `state[name]=detail`). Ein Lauf kann pausieren und in einem **späteren, getrennten Request** weiterlaufen. Genau das braucht ein Langlauf. |
| **Deklaratives Skill-Format** | `src/lib/skills/types.ts` | `SkillDef.steps: StepDef[]`, `acts`-Flag, `describeEffect`. Ein Deliverable-Skill ist „nur" ein weiterer `SkillDef` mit mehr Steps. |
| **Kontext-Beschaffung in Steps** | `src/lib/skills/catalog/wissen.ts` (`holeWissen`) | Rollenbewusstes Retrieval **innerhalb** einer Step-Transaktion (bewusst nicht das RAG-`retrieve()`, um verschachtelte Transaktionen zu vermeiden). Ein Deliverable-Step, der „relevantes Wissen laden" will, hat das schon. |
| **Grounded-LLM-Muster** | `src/lib/rag/answer.ts` (`answerQuestion`) | Das einzige LLM-getriebene Stück im Produkt — mit dem **richtigen** Muster: teurer Call **vor** der DB-Transaktion, dann atomar schreiben, plus Ehrlichkeitsregel + Quellen-Trace. Vorlage für jeden generativen Deliverable-Step. |
| **PDF-Renderer** | `src/lib/effects/pdf.ts` (`renderBusinessPdf`) | Dependency-freier PDF-Assembler, liefert `Uint8Array`. Für strukturierte Text-/Dokument-Deliverables sofort nutzbar (Grenzen: WinAnsi/latin1, geschäftsdokument-zentriert — für PPTX **nicht** geeignet, s. Teil B). |
| **Input-Seite steht** | `src/lib/ingest/extract.ts`, `src/lib/rag/ingest.ts` | Transkripte/Dokumente können **heute schon** rein (`DocumentSource.transcript` existiert; PDF/DOCX/MD/TXT + OCR). Das Rohmaterial für Deliverables ist bereits ingestierbar und durchsuchbar. |

### A.2 Firmen-/Kunden-Gedächtnis — **Teil-Bausteine, aber kein Kunden-Konzept**

Was **vorhanden** ist und trägt: pro Mandant existiert eine durchsuchbare Wissensbasis (`documents`/`chunks`
mit pgvector), eine append-only Historie aller Aktionen (`audit_log`), und die Roh-Läufe
(`skill_runs.input`, `skill_steps.detail`) mit dem, was passiert ist.

Was **fehlt** (siehe B.2): es gibt **keine Kunden-/Projekt-Entität**. „Kunde" existiert nur als
flüchtiger String im Skill-Input (`kunde: string` in `angebot_erstellen`/`rechnung_erstellen`), nie als
Objekt mit Historie. `company_profile` (Migration 0015) ist die **eigene Firma des Mandanten**
(Briefkopf für PDFs), **nicht** ein CRM von Kunden.

### A.3 Einstellbare Autonomie — **auf Skill-Ebene bereits real**

Das ist weiter als gedacht. Die Autonomie-Achse existiert und ist mandantenkonfigurierbar
(`ApprovalPolicy`, `src/lib/policies/`, `src/lib/skills/engine.ts:251-321`):

- `always` = voller Human-in-the-Loop · `threshold` = betragsabhängig autonom · `never` = autonom
  (mit **nicht abschaltbarem Geld-Failsafe**: `never` auf `handlesMoney` wird zur Laufzeit auf „Freigabe" korrigiert und auditiert).
- Steuerbar über **Industry-Presets** (`kanzlei`/`gesundheitswesen`/`handwerk`, `src/lib/policies/presets.ts`)
  und als **portables JSON** exportier-/importierbar (`exportGovernance`/`importGovernance`, Format `helix-governance` v1).

Und der **Freigabe-Round-Trip über Slack existiert vollständig** (`src/lib/slack/handlers.ts`):
`/helix skill …` startet einen Run; pausiert er, postet der Bot **Block-Kit-Buttons** („Approve"/„Reject",
`approvalBlocks`, Zeile 252-284); ein Klick ruft **dieselben** Engine-Funktionen `approve()`/`reject()`
und **lässt den Run automatisch weiterlaufen** bis `completed`, mit Rückmeldung in denselben Thread.
Das ist genau das „Slack mit Zwischenergebnis → Freigabe → helix verarbeitet direkt weiter" aus der
Vision — **schon gebaut**, inkl. Sicherheits-Gates (Signatur → Team→Org → User→Rolle → Idempotenz) und
Rollen-Gate (Vier-Augen). E-Mail-Benachrichtigung bei Freigabebedarf ebenfalls vorhanden
(`notifyApprovalRequested`, `org_settings.approval_notify_email`).

### A.4 Tool-Anbindung (lesen **und** schreiben) — **saubere Abstraktion, ein echter Schreib-Effekt**

- Es gibt bereits eine **Effekt-Provider-Abstraktion** (`src/lib/effects/`), spiegelbildlich zur AI- und
  Embedding-Abstraktion: `getEmailProvider()` liefert real Resend oder einen Fake (prod ohne Key → wirft).
  E-Mail-Versand ist ein **echter, ausgehender Schreib-Effekt**, sauber gekapselt und guardrail-gated.
- Das `acts:true`-Flag + Guardrail/Approval ist genau der richtige Rahmen, um **schreibende** Tool-Aktionen
  (Kalender, CRM, Docs) einzuhängen: jeder neue Effekt ist ein weiterer `acts:true`-Step hinter dem Gate.

Was fehlt: außer E-Mail gibt es keine Konnektoren, und **kein Framework für Tool-Definitionen / Tool-Use**
(der LLM-Adapter kann heute weder Tools aufrufen noch strukturiert antworten, s. B.5).

### A.5 Closed Loop — **die Zutaten für „überwachen" sind da, „nachjustieren" fehlt**

Vorhanden ist die **Beobachtungs-Seite**: append-only `audit_log` mit maschinenlesbaren Verben
(`skill.*`, `approval.*`, `guardrail.triggered`, `policy.*`), der Answer-Trace (`chat_messages.trace`,
Migration 0021: welche Quellen mit welcher Ähnlichkeit, wie viele Treffer die Rolle verborgen hat), das
Feedback-Signal (`chat_feedback`, 👍/👎) und ein **Value-Dashboard** (`src/lib/value.ts`, gesparte Minuten
pro Skill, nur `mode='live'`). Es gibt also reichlich **Ist-Daten**. Was fehlt, ist jede Form von
**Soll-Definition** und **automatischem Abgleich/Nachjustieren** — dazu Teil B.5 und E, ehrlich.

---

## Teil B — Was fehlt / was bricht?

### B.1 Trägt die Engine LANGE, mehrstufige, pausierbare Läufe? — **Nein, nicht in der heutigen Ausführung**

Das Datenmodell trägt es, die **Ausführung** nicht. Zwei harte Wände:

**Wand 1 — 15-Sekunden-Transaktions-Timeout pro Step.** Jeder Step läuft **komplett innerhalb** einer
interaktiven Prisma-Transaktion, und die ist hart begrenzt:

```ts
// src/lib/tenant.ts:47-54
return prisma.$transaction(
  async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_org', ${orgId}, true)`;
    return fn(tx);
  },
  { timeout: 15_000 },   // ← 15s, gepinnte Connection
);
```

Und die Engine ruft `step.run({ orgId, tx, input, state })` **mit dieser offenen Transaktion** auf
(`engine.ts:388-402`). Ein LLM-Schritt, der 30–60 s dauert, würde (a) die Transaktion sprengen → Step
`failed` → Run `failed`, **und** (b) eine DB-Connection minutenlang pinnen. Deshalb ist es kein Zufall,
dass **kein Skill heute ein LLM in einem Step aufruft** — `wissen_zusammenfassen` sagt es explizit im
Kommentar: *„in einer Step-Transaktion soll kein Chat-Modell hängen"*. Das etablierte Muster im Code
(`answerQuestion`, `ingestDocument`) ist konsequent: **teurer Netzwerk-Call VOR der Transaktion, dann
atomar schreiben.** Ein Deliverable-Step muss dasselbe erzwingen — aber die aktuelle `StepDef.run(ctx)`-
Signatur mit offener `ctx.tx` lädt geradezu zum Anti-Pattern ein.

**Wand 2 — synchrone Inline-Ausführung im Request, kein Worker/Queue.** `startRun()` ruft `executeFrom()`
**inline** auf; die Server-Action `await`et den ganzen Lauf (`src/app/dashboard/skills/actions.ts`). Es
gibt **keine** Queue/Worker/Background-Infrastruktur (kein Inngest/BullMQ/Vercel Queue). Auf Vercel
Serverless heißt das: alle Steps ab dem Start müssen zusammen ins **Function-Timeout** passen (Default
heute 300 s, aber `vercel.json` setzt **kein** `maxDuration` und keine Fluid-/Regions-Config). Selbst der
Slack-Pfad, der nach dem 200-Ack via `deferWork()` arbeitet, ist **dieselbe Invocation** — `deferWork`
dokumentiert selbst, dass Vercel die Fire-and-forget-Promise nach der Response abschneidet, wenn man nicht
`after()`/`waitUntil` verdrahtet (`src/lib/slack/defer.ts:14-24`). Und auch mit `waitUntil` gilt das
Function-Timeout. **Ein Lauf, der zuverlässig > ~300 s dauern kann, passt strukturell nicht in eine
einzige Invocation** — egal ob synchron oder deferred.

**Was sich am Run-Modell ändern muss** (Details in Teil C):
- Steps dürfen ihre teure Arbeit (LLM-Call) **nicht** in `ctx.tx` machen. Es braucht eine Step-Form, die
  „erst rechnen (ohne Tx), dann atomar persistieren" strukturell erzwingt — nicht nur per Konvention.
- Ein Langlauf braucht einen **request-übergreifenden Treiber**: einen Zustand „Schritt N fertig, Schritt
  N+1 offen", der **von außen** (Worker-Tick / durable step function) wieder angestoßen wird — statt einer
  einzigen Schleife, die alles am Stück durchläuft. Der gute Teil: der **Resume-Mechanismus dafür existiert
  bereits** (der Freigabe-Pfad beweist request-übergreifendes Fortsetzen aus der DB). Er muss nur von einem
  zweiten Auslöser (nicht nur „Mensch hat freigegeben") bedienbar werden.

**Kein Retry, kein generischer Wartezustand.** Ein Step-Fehler ⇒ Run `failed`, kein Wiederaufsetzen des
gescheiterten Steps. Der einzige Pause-Zustand ist `awaiting_approval`; es gibt kein „warte auf externes
Event / geplante Fortsetzung / Retry mit Backoff". Für flaky LLM-Calls über Minuten ist das zu wenig.

### B.2 Audit vs. mutabler Kunden-Zustand — **zwei getrennte Konzepte, sauber trennen**

Das ist eine der wichtigsten Klärungen. Das `audit_log` ist **hart append-only** und dafür designed, es zu
bleiben:

- Nur `SELECT`/`INSERT`-RLS-Policies; unter `FORCE ROW LEVEL SECURITY` ist UPDATE/DELETE **auch für den
  Owner** verboten. Zusätzlich ein Trigger `audit_log_prevent_mutation()` als zweite Schicht, plus
  Least-Privilege-Grants (`app_user` hat kein UPDATE/DELETE). Die **einzigen** Mutationen sind zwei eng
  umzäunte GDPR-Ausnahmen über SECURITY-DEFINER-Funktionen (Pseudonymisierung `actor_id`/`detail`;
  Tenant-Cascade-Löschung), GUC-gegatet (`src/lib/lifecycle/index.ts`, Migrationen 0008/0011).
- (Randnotiz zur Reife: es gibt **keine** kryptographische Hash-Verkettung / kein `prev_hash` — Tamper-
  Evidenz beruht auf RLS + Trigger + Grants, nicht auf einem verketteten Ledger. Kein Vision-Blocker, aber
  ehrlich zu wissen.)

Das **Kunden-/Deliverable-Gedächtnis** braucht das **Gegenteil**: einen **wachsenden, mutablen** Zustand
pro Kunde (Notizen aktualisieren, Deliverables anhängen, Status ändern). Das **ist nicht dasselbe System**
und darf es nicht sein. **Empfehlung: ein zweites Konzept** — eine eigene **Kunden-/Projekt-Entität** mit
Historie (Details C). Das Audit bleibt die unveränderliche Compliance-Spur *über* dem, was passiert;
die Kunden-Entität ist der veränderliche Arbeitszustand. Beide referenzieren einander (Audit-Einträge
tragen die Kunden-/Projekt-ID im `target`), aber sie vermischen sich nicht.

**Zusätzliche Kollision, die heute niemand adressiert:** Kundeninhalte, die in `skill_runs.input` /
`skill_steps.detail` als JSON liegen, unterliegen **keiner Retention** (nur Chat hat Retention) und werden
von der GDPR-Pseudonymisierung **nicht** erfasst (die fasst ausschließlich `audit_log` an, exact-value auf
Actor-IDs). Eine neue Kunden-Entität mit echten Personendaten muss ihre **eigene** Lösch-/Anonymisierungs-
Logik **von Anfang an** mitbringen, sonst reißt sie ein Loch in das „GDPR-native"-Versprechen.

### B.3 Deliverable-Erzeugung (v.a. PowerPoint) — **Storage fehlt komplett, PPTX braucht eine neue Lib**

Zwei getrennte Lücken:

**Kein Artefakt-Speicher — heute sind Deliverables ephemer.** Verifiziert: keine Storage-Dependency
(kein `@vercel/blob`, kein `@aws-sdk`), keine Blob-/`bytea`-Spalte in einer der 17 Tabellen, keine
Storage-Env. Die erzeugten Angebots-/Rechnungs-PDFs werden **in-memory gerendert → sofort als E-Mail-
Anhang versendet → verworfen**; persistiert wird nur `pdfBytes: pdf.length` (die **Länge**, nicht der
Inhalt). Ein Deliverable, das man später abrufen, versionieren, weiterverarbeiten will, hat **keinen Ort**.
→ Es braucht einen **Blob-Store** (Vercel Blob ist der naheliegende, plattform-native Weg; alternativ S3)
plus eine **`Artifact`-Tabelle** (Metadaten + Referenz auf den Blob, tenant-scoped, RLS wie alle anderen).

**PPTX ist ein neues Format.** Der vorhandene `renderBusinessPdf` ist ein handgeschriebener PDF-1.4-
Assembler für Geschäftsbriefe (WinAnsi/latin1) — für Präsentationen ungeeignet. PowerPoint braucht eine
Bibliothek (z. B. `pptxgenjs`, rein serverseitig, erzeugt `.pptx`-Bytes ohne Office). Das ist ein
überschaubarer, additiver Baustein — **aber** er hängt am Storage (ein 3-MB-PPTX gehört nicht in eine
JSON-Spalte). Realistische Reihenfolge: erst Text-/Markdown-Deliverables (nutzen vorhandenes PDF oder gar
kein Rendering), Storage einführen, **dann** PPTX.

### B.4 Einstellbare Autonomie für MEHRSTUFIGE Pipelines — **Einzel-Gate ok, Zwischen-Freigaben fehlen**

Das bestehende Approval-System ist ein **Single-Gate pro Run**: Es ist zwar strukturell vor *jedem*
`acts:true`-Step, aber ein einmal vorhandenes `approved`-Approval **clean	rt pauschal alle folgenden**
Acting-Steps — die Query ist run-global, nicht step-gebunden:

```ts
// src/lib/skills/engine.ts:257-265 — ein Approval gilt für den GANZEN Run, nicht für Step N
approved: await tx.approval.findFirst({ where: { runId, status: 'approved' } }),
```

Dazu passend: **alle vier Katalog-Skills haben genau einen, finalen Acting-Step.** Ein Skill mit ≥ 2
wirkenden Schritten und *mehreren* einzelnen Zwischen-Freigaben existiert nicht — und wäre so **nicht**
umsetzbar. Die Vision („Zwischenergebnis zur Freigabe → weiter → evtl. nächstes Zwischenergebnis →
Freigabe") braucht aber genau das.

**Was fehlt konkret:** (a) Approvals an einen **konkreten Checkpoint/Step** binden statt run-global zu
clearen; (b) ein Skill-/Pipeline-Modell mit **mehreren definierten Freigabepunkten**; (c) ein benanntes
Autonomie-Konzept *oberhalb* der reinen `ApprovalMode`-Achse (heute existiert kein „ab Stufe X pausieren",
keine Pro-Phase-Autonomie). Der gute Teil: (a) und (b) sind **inkrementelle** Änderungen an vorhandenem
Code (Approval bekommt ein `stepIdx`/`checkpoint`-Feld; die Gate-Query wird step-spezifisch), kein Neubau.

### B.5 Der „Closed Loop" (automatischer Soll/Ist-Abgleich) — **der schwächste Teil, ehrlich**

Hier ist die schonungslose Einschätzung, mit einem realistischen Einstieg (kein Totschweigen).

**Das Grundproblem: Was ist das „Soll" bei einem Deliverable?** Bei einem generativen, kreativen
Output (ein Beratungs-Framework aus Transkripten) gibt es **kein wohldefiniertes, maschinell prüfbares
Soll**. „Ist das Framework gut/richtig/vollständig?" ist eine Urteilsfrage, kein Vergleich gegen einen
Zielwert. Ein „automatischer Soll/Ist-Abgleich" im Wortsinn — wie ein Thermostat, der gegen eine
Zieltemperatur regelt — hat hier schlicht keine Zieltemperatur. Ein LLM-als-Richter kann eine
Qualitäts-**Schätzung** liefern, aber das ist eine weitere generative Meinung, kein objektiver Abgleich,
und als Regelgröße für „selbstständig nachjustieren" gefährlich (der Richter halluziniert genauso).

**Deshalb: den Closed Loop nicht als abstraktes Qualitätsziel bauen, sondern auf schmale, messbare Größen
reduzieren, die tatsächlich ein Soll haben.** Realistischer Einstieg, der die Vision andeutet, ohne etwas
zu versprechen, das nicht trägt:

- **Prozess-Metriken statt Qualitäts-Metriken.** Freigabe-Quote (wie oft wird ein Zwischenergebnis
  angenommen vs. abgelehnt/nachgebessert), Rückfrage-/Iterations-Rate, „vom Menschen editiert vs.
  unverändert übernommen". Diese Größen **haben** ein Soll (z. B. „Freigabe-Quote soll steigen"), sind aus
  vorhandenen Signalen ableitbar (`approval.*`, `chat_feedback`, `audit_log`) und ehrlich messbar.
- **Explizite Akzeptanzkriterien als „Soll".** Statt „gutes Deliverable" definiert der Nutzer/Preset
  *prüfbare* Kriterien pro Deliverable-Typ (z. B. „enthält ≥ 3 Use Cases", „jede Aussage hat eine Quelle
  aus dem Transkript", „Foliensatz hat Executive Summary"). Das sind **struktur-prüfbare** Bedingungen —
  hier ist ein automatischer Ist-Abgleich real möglich (der Answer-Trace-Mechanismus aus 0021 ist die
  Blaupause: „welche Quelle stützt welche Aussage").
- **Der „Loop" ist zunächst ein Mensch mit Metriken, kein Autopilot.** Überwachen (Metriken sichtbar
  machen) und Soll/Ist (gegen Akzeptanzkriterien prüfen, Abweichungen melden) sind wertvoll und machbar.
  **Automatisches Nachjustieren** (helix ändert selbstständig einen fertigen Deliverable, weil eine
  Kennzahl abweicht) ist der spekulativste Schritt und sollte **zuletzt** und **eng begrenzt** kommen
  (z. B. „fehlende Quelle erkannt → automatisch einen Nachbesserungs-Lauf *vorschlagen*", nicht
  ausführen).

**Klartext:** Punkt 5 der Vision ist als „kontinuierlicher automatischer Regelkreis für Deliverable-
Qualität" nicht seriös baubar. Als „messbare Prozess-/Struktur-Kennzahlen + explizite Akzeptanzkriterien +
menschgetriebene Iteration" ist er wertvoll und realistisch. Die Analyse empfiehlt dringend die zweite
Lesart.

---

## Teil C — Architektur-Empfehlung

**Kernempfehlung: Erweiterung, nicht Parallel-Pipeline — aber mit einem klar abgegrenzten neuen
Ausführungs-Modus und drei neuen Datenbausteinen.** Begründung: das Run/Step/Approval-Datenmodell, die
Tenant-Isolation, das Audit, die Governance und der Resume-Pfad sind **genau die Teile, die man für
Deliverable-Läufe wieder braucht** — sie zweimal zu bauen wäre Verschwendung und würde die
Sicherheits-/Compliance-Garantien verdoppeln (und damit gefährden). helix hat diese Garantien teuer
erarbeitet; die Vision soll auf ihnen aufsetzen, nicht neben ihnen.

Was **neu** dazukommt (und worauf es aufsetzt):

**C.1 Ein zweiter Skill-/Run-Typ: „langlaufender, generativer Deliverable-Lauf".** Setzt auf `SkillRun`/
`SkillStep` auf, ändert aber die **Ausführung**:
- Eine Step-Form, die den teuren Teil (LLM) **außerhalb** einer DB-Transaktion ausführt und nur das
  Ergebnis atomar persistiert (das `answerQuestion`/`ingestDocument`-Muster **als erzwungene Struktur**,
  nicht als Konvention). Konkret: der generative Step bekommt **keine** offene `ctx.tx` für den LLM-Call;
  er rechnet, dann öffnet der Motor eine kurze `withTenant`-Transaktion nur zum Schreiben von `skill_step`
  + Audit. Damit bleibt das 15-s-Limit unangetastet (die Transaktion ist wieder Millisekunden).
- Der Lauf wird **request-übergreifend getrieben** (ein Step pro Anstoß), statt in einer Schleife am Stück.
  Der Zustand „welcher Step ist offen" liegt schon in der DB; es braucht nur einen **zweiten Auslöser**
  neben „Mensch hat freigegeben".

**C.2 Ausführungs-Infrastruktur — zwei ehrliche Wege (Entscheidung pro Etappe):**

| | **Vercel-nativ** | **Managed durable Queue (Inngest / Trigger.dev)** |
|---|---|---|
| Wie | Cron-Route als „Worker-Tick" (z. B. minütlich), holt offene Läufe, führt **einen** Step aus, persistiert, fertig. Nutzt vorhandenes `/api/cron/*`-Muster + `waitUntil`. Optional Vercel Queues (Beta). | Durable step functions: jeder Step ist ein eigener, automatisch retrybarer, wiederaufnehmbarer Ausführungsschritt mit eigenem Timeout; Orchestrierung, Retries, Backoff, „warte auf Event" out of the box. |
| Stärke | Keine neue Abhängigkeit, keine neuen Secrets, bleibt in der Plattform. Passt zum Selbst-Host-/GDPR-Anspruch (kein weiterer Datenverarbeiter). | Für **genau dieses Problem** gebaut. Retry/Resume/lange Läufe/Zwischen-Events sind Kernfeatures, nicht Eigenbau. Deutlich weniger selbstgeschriebene Zustands-/Fehlerlogik. |
| Schwäche | Latenz (Tick-Intervall), Eigenbau von Retry/Backoff/Sichtbarkeit, Cron-Granularität. „Ein Step pro Minute" ist für einen 8-Step-Lauf zäh. | Zusätzlicher Dienst = zusätzlicher Datenverarbeiter (AVV/DSGVO prüfen!), zusätzliche Secrets, Vendor-Bindung. Muss in die Tenant-/Audit-Disziplin eingepasst werden. |
| **Empfehlung** | **Etappe 1–2** (ein Deliverable-Skill, wenige Steps): Vercel-nativ reicht und hält die Abhängigkeiten klein. | **Ab Etappe 3** (echte mehrminütige, mehrstufige Läufe mit Zwischen-Freigaben und Retries): dann ist eine durable Queue den Eigenbau wert — vorausgesetzt die AVV-/DSGVO-Prüfung fällt positiv aus. |

Das ist bewusst gestuft: **klein anfangen ohne neue Infra, die Queue erst holen, wenn die Läufe sie
wirklich brauchen.**

**C.3 Neue Kunden-/Projekt-Entität (mutabler Arbeitszustand).** Eine neue Tabelle `client` (oder
`engagement`/`project`), tenant-scoped, RLS ENABLE+FORCE + FK auf `organizations` + Composite-Unique
`(id, org_id)` — **exakt das Muster jeder bestehenden Tabelle** (`documents`, `skill_runs` …). Dazu:
- `skill_runs` bekommt ein optionales `clientId` (FK) → ein Lauf gehört zu einem Kunden.
- Deliverables (`Artifact`, s. C.4) und optional `documents` hängen an `clientId` → „alles zu Kunde X"
  wird eine simple Query statt JSON-Volltextsuche.
- **Eigene Retention/Anonymisierung von Anfang an** (siehe B.2) — nicht dem Audit-Scrub überlassen.

**C.4 Artefakt-Speicherung.** `Artifact`-Tabelle (tenant-scoped, RLS) mit Metadaten (Titel, Typ, `runId`,
`clientId`, Version, Größe) + Referenz auf einen **Blob-Store** (Vercel Blob empfohlen: plattform-nativ,
privat per Default, keine neue Cloud). Die erzeugten Bytes (PDF/PPTX/…) landen im Blob, die Referenz in der
Tabelle. Nutzt die vorhandene Effekt-Provider-Denke (ein `getBlobProvider()` analog zu `getEmailProvider`,
Fake in dev/test, real in prod).

**C.5 Checkpoint-gebundene Approvals (für mehrstufige Autonomie).** `Approval` bekommt ein `stepIdx`/
`checkpoint`-Feld; die Gate-Query in `actingStepCleared` wird step-spezifisch (`findFirst({ runId, stepIdx,
status:'approved' })`). Das ist eine kleine, chirurgische Änderung an vorhandenem Code und macht mehrere
Zwischen-Freigaben pro Lauf möglich — der Slack-Round-Trip funktioniert dann pro Checkpoint unverändert
weiter.

**C.6 LLM-Adapter erweitern (strukturierte Ausgabe / Tool-Use).** Der heutige `ChatProvider.complete()`
liefert nur `string` (kein Streaming, kein JSON-Schema, kein Tool-Use). Deliverable-Generierung braucht
**strukturierte** Zwischenprodukte (Framework als JSON, Foliengerüst als Objekt). Empfehlung: das
`ChatProvider`-Interface um einen strukturierten Aufruf erweitern (Tool-Use / JSON-Schema der Anthropic-
SDK), zusätzlich zur bestehenden Methode — additiv, ohne die RAG-Chat-Nutzung zu ändern. (Streaming ist
für Deliverable-Läufe zweitrangig, weil der Nutzer ohnehin auf Zwischenschritte statt Token wartet.)

**Was NICHT dupliziert wird:** Tenant-Isolation (`withTenant`/RLS), Audit, Governance/Policies, der
Freigabe-Resume-Mechanismus, die RAG-Retrieval-Schicht, die Provider-Abstraktionen. All das wird
wiederverwendet. Das ist der ganze Grund, „Erweiterung" statt „Parallel-Pipeline" zu empfehlen.

---

## Teil D — Gestufter Plan

Vier Etappen von heute zur Vision. Größenordnung: **klein** (Tage), **mittel** (1–2 Wochen), **groß**
(mehrere Wochen). Jede Etappe ist für sich lieferbar und wertvoll.

### Etappe 1 — **Der erste Deliverable-Skill** · Größe: **klein–mittel** · *← der kleine erste Schritt*

**Ziel:** Die Vision andeuten, ohne irgendetwas umzubauen. Ein einzelner Skill
`transkript_zu_framework`: nimmt ein (oder wenige) bereits ingestierte Transkript(e), macht **einen bis
zwei LLM-Schritte** (Rohanalyse → strukturiertes Framework), gibt das Ergebnis als **Text/Markdown**
zurück (kein neues Format, kein Storage nötig — Ausgabe im `skill_steps.detail` + optional als vorhandenes
PDF).

**Setzt auf:** dem kompletten vorhandenen Stack — `SkillDef`/Engine, `holeWissen` für Kontext,
`getChatProvider()` für den LLM-Call, das `answerQuestion`-Muster (LLM **vor** der Transaktion). Läuft in
**einem** Request, wenn er unter dem Function-Timeout bleibt (1–2 LLM-Calls sind machbar). Human-in-the-Loop
über das **bestehende** Approval-Gate + Slack-Round-Trip — „geschätzt fertig" pausiert, Mensch gibt frei.

**Was neu ist:** nur der eine `SkillDef` + eine Step-Hilfe „LLM-Call ohne offene Tx" (kleine Ergänzung an
der Engine, damit generative Steps das etablierte Muster erzwingen statt es nur zu kommentieren). **Keine**
neue Infra, **keine** neue Tabelle. Das ist der ehrlichste „Machbarkeitsbeweis" und deckt sofort auf, wo
das Timeout wirklich beißt.

### Etappe 2 — **Mehrschritt-Läufe + Kunden-Entität + Artefakt-Speicher** · Größe: **mittel–groß**

**Ziel:** Aus „ein, zwei Steps" werden echte mehrstufige Läufe, und die Ergebnisse bekommen ein Zuhause.

- **Kunden-/Projekt-Entität** (`client`, C.3) + `skill_runs.clientId` → das Firmen-/Kunden-Gedächtnis
  entsteht: „alle Läufe/Deliverables zu Kunde X". Mit **eigener** Retention/Anonymisierung (B.2).
- **Artefakt-Speicher** (`Artifact` + Vercel Blob, C.4) → Deliverables werden persistent, abrufbar,
  versionierbar. Erst damit lohnt sich mehr als flüchtiger Text.
- **Request-übergreifende Ausführung, Vercel-nativ** (C.2, linke Spalte): Cron-Tick treibt offene Läufe
  Step für Step. Damit sind Läufe möglich, die das Function-Timeout **überschreiten** — der einzelne Step
  bleibt klein, der Lauf zieht sich über mehrere Ticks.

**Setzt auf:** Etappe 1 + vorhandenem Cron-Muster (`/api/cron/retention`), vorhandener Effekt-Provider-
Denke, vorhandenem Tenant-/RLS-Muster für die neuen Tabellen.

### Etappe 3 — **Mehrstufige Autonomie + durable Ausführung + PPTX** · Größe: **groß**

**Ziel:** Die volle „einstellbare Autonomie über mehrere Zwischen-Freigaben" und robuste Langläufe.

- **Checkpoint-gebundene Approvals** (C.5) → mehrere Zwischen-Freigaben pro Lauf; der Slack-Round-Trip
  funktioniert pro Checkpoint.
- **Durable Queue** (C.2, rechte Spalte, Inngest/Trigger.dev) **statt** Cron-Tick — für Retries, Backoff,
  „warte auf Freigabe/Event", saubere Beobachtbarkeit. **Nur wenn** die AVV/DSGVO-Prüfung des Dienstes
  positiv ist; sonst beim Vercel-Tick bleiben und Retry selbst bauen.
- **PPTX-Deliverables** (`pptxgenjs`, B.3) → Präsentationen als echtes Ausgabeformat, abgelegt im
  Artefakt-Speicher.
- **Strukturierte LLM-Ausgabe / Tool-Use** (C.6) → zuverlässige, maschinenlesbare Zwischenprodukte.

### Etappe 4 — **Closed Loop (schmal) + schreibende Tool-Anbindung** · Größe: **groß**

**Ziel:** Die zwei spekulativsten Vision-Teile — bewusst zuletzt, bewusst eng.

- **Closed Loop als Prozess-/Struktur-Metriken** (B.5): Freigabe-Quote, Iterations-Rate, explizite
  Akzeptanzkriterien pro Deliverable-Typ, automatischer **Struktur**-Abgleich (Blaupause: Answer-Trace).
  „Überwachen + Soll/Ist melden" — **nicht** autonomes Nachjustieren. Nutzt vorhandene Signale
  (`approval.*`, `chat_feedback`, `audit_log`, Value-Dashboard).
- **Schreibende Tool-Konnektoren** (Kalender/CRM/Docs) als weitere `acts:true`-Effekte hinter dem
  bestehenden Guardrail/Approval-Gate, über die Effekt-Provider-Abstraktion.

**Reihenfolge-Logik:** Jede Etappe liefert für sich Wert und lässt sich stoppen, ohne einen Torso zu
hinterlassen. Etappe 1 ist bewusst so klein, dass sie in Tagen steht und die Vision *zeigt*, bevor
irgendetwas Großes gebaut wird.

---

## Teil E — Risiken & ehrliche Einschätzung

### Das größte technische Risiko: die Vermischung von Langlauf-Ausführung mit dem transaktionalen Kern

Der gefährlichste Fehler wäre, LLM-Calls **in** die bestehende Step-Transaktion zu setzen (naiv:
`getChatProvider().complete()` in einem `step.run` mit offener `ctx.tx`). Das sprengt nicht nur das
15-s-Limit, es **pinnt DB-Connections über Minuten** — unter Last führt das zu Connection-Pool-Erschöpfung
und trifft dann **auch die funktionierenden, kurzen Läufe** (Kontierung, Rechnung, RAG-Chat). Die
Timeout-Wände sind nicht nur Grenzen des Neuen, sie sind **Schutz des Bestehenden**. Die
Architektur-Empfehlung (LLM außerhalb der Tx, request-übergreifender Treiber) ist genau darauf ausgelegt —
diese Trennung ist **nicht verhandelbar**, sonst destabilisiert das Neue das Alte.

### Wo die Vision das funktionierende Produkt verwässern/destabilisieren könnte

- **Der Charakter-Bruch:** helix ist heute eine **deterministische, prüfbare, governance-lastige** Maschine
  (kein Skill ruft ein LLM, jede Aktion ist auditiert, jede Wirkung guardrail-gated). Die Deliverable-
  Vision bringt **nicht-deterministische, generative** Läufe hinein. Das ist legitim, aber es ist ein
  anderes Wesen. Risiko: die Sorgfalt, die das Produkt auszeichnet (Fail-closed, exakte Audit-Verben,
  Disclosure-Invarianten), wird im „schnell ein Framework generieren"-Modus verwässert. **Gegenmittel:**
  der neue Lauf-Typ muss dieselben Invarianten erben (Tenant-Isolation, Audit jeder Transition, Approval-
  Gate) — deshalb Erweiterung statt Parallel-Pipeline.
- **Das GDPR-Loch:** eine Kunden-Entität mit echten Personendaten, die **ohne** eigene Retention/
  Anonymisierung gebaut wird, bricht das „GDPR-native"-Kernversprechen (heute unterliegen `skill_runs.input`/
  `skill_steps.detail` schon keiner Retention und keinem Scrub — das skaliert schlecht mit „wachsendem
  Kunden-Gedächtnis"). Muss von Etappe 2 an mitgebaut werden, nicht nachgerüstet.
- **Scope-Explosion durch den Closed Loop:** Punkt 5 kann beliebig viel Zeit fressen für einen zweifelhaften
  Nutzen. Nicht als „Qualitäts-Autopilot" bauen (siehe B.5).

### Was ich an deiner Stelle NICHT tun würde

1. **Keine zweite, separate Verarbeitungs-Pipeline neben der Engine bauen.** Das dupliziert die Sicherheits-/
   Compliance-Schicht und verdoppelt die Angriffsfläche. Erweitern.
2. **Keine LLM-Calls in `withTenant`-Transaktionen.** Nie. Das ist der eine Fehler, der das laufende Produkt
   umbringt.
3. **Nicht mit PowerPoint anfangen.** PPTX ist sichtbar und verführerisch, hängt aber am Storage und ist das
   *letzte* Glied. Erst Text-Deliverable + Kunden-Entität + Storage; PPTX ist dann ein kleiner Aufsatz.
4. **Den „Closed Loop" nicht als automatischen Qualitäts-Regelkreis versprechen/bauen.** Es gibt kein Soll.
   Auf messbare Prozess-/Struktur-Kennzahlen reduzieren, Nachjustieren dem Menschen lassen.
5. **Nicht sofort eine managed Queue einführen.** Etappe 1–2 gehen Vercel-nativ; die Queue (mit AVV-/DSGVO-
   Prüfung) erst, wenn die Läufe sie beweisbar brauchen — nicht auf Vorrat.
6. **Nicht die Governance/Approval-Semantik lockern, um „autonomer" zu wirken.** Der Geld-Failsafe und das
   Fail-closed-Prinzip sind Verkaufsargumente in regulierten Branchen (die Presets heißen `kanzlei`/
   `gesundheitswesen` — genau die Kunden, die das brauchen). Autonomie kommt über **checkpoint-gebundene
   Freigaben**, nicht über weniger Kontrolle.

### Positiv-Fazit

helix ist eine ungewöhnlich disziplinierte Codebasis, und die Vision passt besser auf das Fundament, als
es auf den ersten Blick wirkt: Run/Step-Persistenz, request-übergreifender Resume, interaktiver Slack-
Freigabe-Round-Trip, Effekt-/AI-Provider-Abstraktion, rollenbewusstes RAG — das sind exakt die Teile, die
ein Deliverable-Betriebssystem braucht. Die Lücken (Ausführungs-Treiber, Kunden-Entität, Artefakt-Speicher,
generative Steps) sind real, aber **additiv und klar umrissen**. Der kleine erste Schritt (ein
`transkript_zu_framework`-Skill) ist in Tagen machbar und zeigt die Vision, bevor eine einzige neue Tabelle
angelegt werden muss. Der größte Fehler wäre nicht, zu wenig zu bauen — sondern das Neue so zu bauen, dass
es die Sorgfalt des Bestehenden verwässert.

---

## Anhang — Zentrale Datei-/Modulverweise

| Thema | Pfad |
|---|---|
| Skill-Engine (Ausführung, Gate, Resume) | `src/lib/skills/engine.ts` |
| Skill-Format (deklarativ) | `src/lib/skills/types.ts` · Katalog: `src/lib/skills/catalog/*.ts` |
| Deliverable-Vorbild (Kontext→Entwurf→Freigabe→PDF→Versand) | `src/lib/skills/catalog/angebot_erstellen.ts` |
| Kontext-Retrieval in Steps | `src/lib/skills/catalog/wissen.ts` (`holeWissen`) |
| **15-s-Transaktions-Timeout** (Kernrestriktion) | `src/lib/tenant.ts:47-54` |
| Grounded-LLM-Muster (LLM vor der Tx) | `src/lib/rag/answer.ts` (`answerQuestion`) |
| LLM-Adapter (nur `complete()`, kein Tool-Use) | `src/lib/ai/anthropic.ts` · Interface: `src/lib/ai/types.ts` |
| RAG-Retrieval (pgvector, Disclosure in SQL) | `src/lib/rag/retrieve.ts` · Ingestion: `src/lib/rag/ingest.ts` |
| Ingestion/Extraktion (PDF/DOCX/MD/TXT + OCR) | `src/lib/ingest/extract.ts`, `src/lib/ingest/ocr.ts` |
| Approval-System / Governance / Presets | `src/lib/policies/{index,governance,presets}.ts` |
| Slack (interaktiver Freigabe-Round-Trip) | `src/lib/slack/handlers.ts` (`approvalBlocks`, `handleSlackInteractions`) |
| Ack-then-work (Vercel-Timeout-Hinweis) | `src/lib/slack/defer.ts` |
| Audit (append-only) | `src/lib/audit.ts` · Enforcement: `prisma/migrations/0001_init/migration.sql` |
| GDPR/Retention/Lifecycle | `src/lib/lifecycle/index.ts` · Migrationen 0008/0011/0016 |
| Effekt-Provider (E-Mail-Versand, PDF-Renderer) | `src/lib/effects/{index,resend,pdf}.ts` |
| Firmenprofil (eigene Firma, **kein** Kunde) | `src/lib/company.ts` · Migration 0015 |
| Datenmodell (17 Modelle, `org_id` als einzige Tenancy-Ebene) | `prisma/schema.prisma` |
| Value-Dashboard (Ist-Signale) | `src/lib/value.ts` |
