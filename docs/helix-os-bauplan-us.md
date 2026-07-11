# helix als „AI Operating System" — Vollständiger Bauplan (US-Ausrichtung)

**Stand:** 2026-07-04 · **Art:** Planung, kein Code geändert · **Bezug:** YC Fall 2026

> Dieser Plan fasst die drei zugrundeliegenden Analysen zu einer Landkarte zusammen und arbeitet die
> strategische Neuausrichtung auf den US-Markt ein. Er ersetzt die DACH/DSGVO-zentrierte Rahmung der
> früheren Dokumente, ohne die zugrundeliegende Sicherheits-Architektur anzutasten.

---

## 0 — Die eine strategische Verschiebung: DSGVO ist nicht mehr der USP

**Alt (Klymeo-Erbe):** „DSGVO-native, EU-hosted, kein US-Cloud" als Haupt-Verkaufsargument.
Das ist für Klymeo (DACH-Qualitativ-Research) richtig. Für helix als US-orientiertes OS ist es **nicht** der USP.

**Neu (helix):** Der USP ist die **Fähigkeit**, nicht die Compliance:
Company Brain → ausführbare, sichere Skills → geschlossener Loop. Das ist exakt, was Blomfields
„Company Brain"-RFS und Hus „AI Operating System"-RFS beschreiben — und keiner der beiden erwähnt Datenschutz.

**Konsequenz — was sich trennt:**

| Ebene | Alt | Neu |
|---|---|---|
| **Story / Schlagzeile** | „DSGVO-native" | „Company Brain, das handelt, mit geschlossenem Loop" |
| **Sicherheits-Substanz** | „DSGVO-konform" | „enterprise-grade / SOC-2-ready" (dieselbe Substanz, anderes Etikett) |
| **Hosting** | EU-Region Pflicht (eu-central-1) | **US-Region erlaubt** (näher an Nutzern, Tool-APIs, beste Dienste) |
| **Compliance-Maschinerie** | Retention/Anonymisierung als Blocker | herabgestuft zu „gute Datenhygiene, später" |

**Wichtig — was NICHT fällt:** Mandantentrennung (RLS), verschlüsselte Token-Speicherung (AES-256-GCM),
fail-closed-Sichtbarkeit, Geld-Failsafe, Fail-closed-Governance. Das ist **Enterprise-Sicherheit**, kein
EU-Ding — US-Käufer zahlen dafür genauso. Es ist bereits gebaut; es zu schwächen wäre ein Fehler.

---

## Die nicht verhandelbare Regel (gilt für JEDEN Baustein)

**Niemals einen LLM-Call oder einen langsamen externen Tool-Call innerhalb einer `withTenant`-Transaktion.**
Teurer Netzwerk-Call VOR der Transaktion, dann Ergebnis in einer kurzen Transaktion atomar schreiben
(skill_step / document / Flag + Audit).

Begründung: 15-Sekunden-Transaktions-Timeout in `src/lib/tenant.ts:47-54`. Ein LLM-Schritt (30–60s) würde
die Transaktion sprengen (Run failed) UND eine DB-Connection minutenlang pinnen → unter Last
Connection-Pool-Erschöpfung, die auch die kurzen, laufenden Skills (Kontierung, Rechnung, RAG-Chat) trifft.
Die Timeout-Wände sind nicht nur Grenzen des Neuen, sie sind Schutz des Bestehenden.

Etabliertes Muster im Code: `answerQuestion` / `ingestDocument` (teurer Call außerhalb der Tx, dann atomar).
Jeder neue Konnektor, jede Metrik-Berechnung, jeder Flag-Check hält sich daran.

---

## Die Vision in vier Blöcken (die verbindliche Richtlinie)

helix = die durchgehende Verarbeitungsschicht der Firma: **Input → Kern → Output, geschlossener Loop.**

**Block 1 — Inputs (die Artefakte der Firma, aus den Tools):**
Transkripte, E-Mails, Tickets, Code, Dokumente, Kundenkontakt. Kommen aus bestehenden Tools
(Call-Recorder, Mail, Linear, GitHub, Google Workspace). helix nimmt sie auf und liest laufend.

**Block 2 — Der Kern (helix denkt über alles hinweg):**
Wissensbasis (RAG/Retrieval) · Skills (ausführen) · Governance (Freigaben/Audit) · Gedächtnis (pro Kunde).

**Block 3 — Outputs (zurück in die Tools):**
(a) Deliverables (Frameworks, Use Cases, Slides) · (b) Warn-Flags („ihr baut das Falsche") ·
(c) Tool-Aktionen (schreibend zurück in die Systeme).

**Block 4 — Der Loop (das Herzstück):**
beobachten → mit dem **Soll** vergleichen → nachjustieren → Output verändert Artefakte → von vorn.
Das „Soll" = explizite Akzeptanzkriterien + Prozess-Metriken, **nicht** ein abstraktes Qualitätsziel.
Nachjustieren bleibt beim Menschen. Kein autonomer Qualitäts-Regelkreis.

---

## Was schon trägt (das Fundament ist stärker als erwartet)

**Deliverable-Muster existiert produktiv:** `angebot_erstellen` ist der lebende Beweis — Input → Kontext aus
Wissensbasis → Dokument entwerfen → für Freigabe pausieren → nach Freigabe PDF + Versand. Die
Deliverable-Vision ist eine **Vergrößerung** dieses Musters, kein Fremdkörper.

**Request-übergreifender Resume existiert:** Ein Lauf kann pausieren und in einem späteren, getrennten
Request weiterlaufen (durch den Slack-Freigabe-Pfad bewiesen). Genau das braucht ein Langlauf.

**Tool-Sicherheit ist zu ~90% als Vorlage gebaut:** OAuth-Install (`src/lib/slack/oauth.ts`), verschlüsselte
Token (`src/lib/crypto.ts`, AES-256-GCM), Signatur-Verifikation, und das Kniffligste — Tenant-Auflösung ohne
Kontext (`resolveSlackTeam`, welcher Mandant gehört zu diesem eingehenden Event). Tool-Anbindung ist damit
**Kopieren eines bewährten Musters**, kein Sprung ins Unbekannte. Das senkt das Risiko der OS-Vision erheblich.

**Einstellbare Autonomie ist real:** ApprovalMode (always/threshold/never) mit Geld-Failsafe, Industry-Presets,
Slack-Freigabe-Round-Trip inkl. Sicherheits-Gates. Das „Slack → Freigabe → helix verarbeitet weiter" aus der
Vision ist bereits gebaut.

**Die drei harten Lücken (real, aber additiv und klar umrissen):**
1. Ausführung ist synchron-inline mit 15s-Tx-Timeout — trägt keine minutenlangen Läufe (Treiber fehlt).
2. Keine Kunden-/Projekt-Entität, keine Artefakt-Speicherung — Deliverables haben kein Zuhause.
3. Kein Skill ruft heute ein LLM auf — die Engine ist bewusst deterministisch (generative Steps fehlen).

---

## Was der US-Fokus konkret verändert

### Wird leichter oder fällt weg
- **Dokument-Retention:** von „Blocker, muss mit erstem Konnektor kommen" → „gute Datenhygiene, später".
  Die *Fähigkeit* zu löschen bleibt (`deleteDocument`), die automatische Retention-Maschinerie muss nicht
  vorgezogen werden. Entlastet Etappe 3 spürbar.
- **EU-Hosting-Zwang:** Neon + Vercel dürfen in **US-Region** laufen (Latenz, Nähe zu Tool-APIs).
- **AVV/DSGVO-Prüfung für durable Queue:** entfällt. **Inngest / Trigger.dev frei wählbar** — nimm den besten
  Dienst, keine Vorbedingung mehr.
- **Tool-Auswahl:** US-Stack (Slack, Linear, GitHub, Notion, Google Workspace) hat die besten APIs und
  klarsten OAuth-Flows. Konnektoren für ein Ökosystem, das *für* Integrationen gebaut ist. Kein DATEV-Kampf.
- **Deliverable-Formate:** Google Slides / Notion-Docs statt PowerPoint-per-Mail (Google-Workspace-API ist
  erstklassig). Notiz für Etappe 3.
- **Währung:** Dollar (`money.ts`, `CURRENCY='USD'`) war im Nachhinein goldrichtig — passt jetzt perfekt.

### Bleibt (jetzt als Enterprise-Sicherheit statt „DSGVO")
- Mandantentrennung (RLS + FORCE, prod-verifiziert) — Grundlage jedes B2B-SaaS.
- Token verschlüsselt (AES-256-GCM), nie Klartext/Log.
- Fail-closed-Sichtbarkeit — Datenqualität **und** Sicherheit; jeder US-Kunde will das.
- Geld-Failsafe + Fail-closed-Governance — Verkaufsargument, kein EU-Ding.
- **Dedup-Schutz** wird jetzt aus dem *richtigen* Grund gebaut: reine **Datenqualität** (ohne ihn verschmutzt
  wiederholtes Tool-Einlesen die Wissensbasis mit Duplikaten → schlechteres Retrieval für alle). Nicht mehr
  als Compliance-Pflicht gerahmt, sondern als gutes Engineering. Gleiche Arbeit, klarerer Grund.

---

## Teil F — Block 1 (lesend): kontinuierliche Tool-Anbindung

**Empfehlung: eine dünne Konnektor-Schicht, kein schweres Framework.** Ein `ConnectorDef`-Vertrag
(`src/lib/connectors/types.ts`, neu): `key` · `oauthScopes` · `verifyWebhook(req)` · `resolveTenant(externalId)`
· `normalize(event) → { externalId, title, text, source, occurredAt }`.

**Zwei Betriebsarten pro Konnektor:**
- **Push (Webhook):** `POST /api/connectors/<key>/webhook` → Gate-Sequenz exakt wie Slack/Clerk
  (Signatur → Tenant → Idempotenz → ack-then-work → normalisieren → `ingestDocument`). Bevorzugt für Linear, GitHub.
- **Pull (Poll):** Cron nach dem `/api/cron/retention`-Muster (Bearer-Auth, fail-closed), pro Tick pro Tenant
  offene Deltas holen (Token via `decryptString` VOR der Tx), normalisieren, `ingestDocument` (kurze Tx).
  Poll-Cursor in der Konnektor-Installations-Zeile.

**Wiederverwendbare Vorlagen (bereits produktiv):**

| Baustein | Vorlage |
|---|---|
| OAuth-Install (signierter State, injizierbarer Exchange) | `src/lib/slack/oauth.ts` |
| Verschlüsselte Token (AES-256-GCM, generisch) | `src/lib/crypto.ts` · `resolveBotToken` |
| Eingehende Events verifizieren | `src/lib/slack/verify.ts` · `src/lib/clerk/verify.ts` |
| Tenant-Auflösung ohne Kontext (Bootstrap-Policy) | `resolveSlackTeam` · Migration 0006 |
| Idempotenz (geteilt Slack + Clerk) | `claimSlackEvent` (`src/lib/slack/idempotency.ts`) |
| ack-then-work | `deferWork` + `waitUntil` |
| Quellen-agnostische Text-Ingestion | `ingestDocument` (nimmt beliebigen `text: string`) |

**Zwei Bausteine, die mitkommen müssen — jetzt als Datenqualität, nicht Compliance:**
- **(a) Ingestion-Dedup:** Spalte `external_ref` (z. B. `linear:issue:ABC-123`) + `@@unique([orgId, external_ref])`
  auf `documents`; `ingestDocument` bekommt einen `externalRef`-Upsert-Pfad. Ohne ihn: Duplikate → schlechteres
  Retrieval für **alle** Features. Größe: klein–mittel.
- **fail-closed-Sichtbarkeit:** Extern gelesene Dokumente NIE `visibility='open'` (Leak-Risiko). Default
  fail-closed auf `restricted`/`confidential` je Konnektor. Sicherheit, marktunabhängig.

**Herabgestuft durch US-Fokus:** Dokument-Retention (`documentRetentionDays` + zweiter Sweep-Zweig) ist jetzt
optional/später statt Blocker. Die Lösch-*Fähigkeit* bleibt.

**Neue Enum-Werte** `DocumentSource` (`ticket`/`email`/`code`/`doc`) — reines Metadatum, kleine Migration.

**Einordnung:** Etappe 3–4 (hängt an Kunden-Entität). Ein einzelner Linear-Push-Konnektor als schmaler
erster Beweis ist schon nach Etappe 2 machbar.

---

## Teil G — Block 3b + Block 4: Warn-Flags und der Loop-Mechanismus

**Zwei Soll-Quellen, beide maschinell prüfbar (kein LLM als Richter):**

**Soll-Quelle 1 — Akzeptanzkriterien pro Deliverable-Typ (Struktur-Abgleich).**
Pro Typ definiert ein Preset prüfbare Bedingungen (Daten, kein Freitext), z. B. für `transkript_zu_framework`:
mind. 3 Use Cases · jede Kernaussage trägt eine Transkript-Quelle · Executive Summary vorhanden.
**Blaupause existiert:** der Answer-Trace (`chat_messages.trace`, Migration 0021) hält „welche Quelle stützt
welche Aussage". Ein Deliverable-Step erzeugt analog einen Deliverable-Trace; die Kriterien-Prüfung ist eine
reine Funktion darüber — deterministisch, testbar, kein LLM in der Prüfung.

**Soll-Quelle 2 — Prozess-Metriken (aus vorhandenen Signalen):**

| Metrik | Woraus (vorhanden) | „Soll" |
|---|---|---|
| Erfolgsquote | `computeValueStats().successRate` (fertig) | ≥ Schwelle |
| Freigabe-Quote | `audit_log` `approval.approved`/`.rejected` | steigt |
| Iterations-Rate | Läufe pro Kunde/Typ bis Freigabe | sinkt |
| Feedback | `chat_feedback` 👍/👎 | 👎 niedrig |

**Was ein Warn-Flag technisch IST — zwei Stufen:**
- **Stufe A (Einstieg, empfohlen): Flag = Audit-Eintrag.** `logAudit(tx, { action: 'flag.<typ>', actorType:
  'agent', target, detail: { kriterium, ist, soll, schwere } })`. Append-only, tenant-scoped, **sofort in der
  bestehenden Audit-UI sichtbar** — keine neue Tabelle, keine neue UI.
- **Stufe B (später, nur bei Bedarf): Flag = eigene Entität** mit Status (offen/quittiert/erledigt). Mutabler
  Arbeitszustand → wie die Kunden-Entität NICHT ins append-only Audit.

**Entstehung (zwei Auslöser, regel-basiert):**
- Am Ende eines Deliverable-Laufs: ein lesender `acts:false`-Step prüft die Akzeptanzkriterien → Verletzung → Flag.
- Periodisch (der „Loop-Tick"): Cron rechnet Prozess-Metriken pro Tenant, vergleicht gegen Schwellen → Abweichung → Flag.

**Zustellung (Kanäle existieren alle):** Slack-Post (`postSlackMessage`, Block-Kit) · E-Mail (`notifyApprovalRequested`-Muster) · Webhook-Sink (`error-reporter.ts`).

**Die harte Grenze:**
- **In-Scope (baubar):** beobachten → vergleichen → Flag + Mensch benachrichtigen. helix meldet „ihr baut das Falsche". Punkt.
- **Bewusst NICHT jetzt:** helix ändert selbstständig einen Deliverable. Maximal vertretbar: ein Flag *schlägt vor*
  („Korrektur starten"-Button), der Mensch löst aus → normales Approval-Gate. Loop geschlossen, kein Autopilot.

**Einordnung:** Etappe 4. Stufe A ist der schmale, ehrliche Einstieg.

---

## Teil H — Block 3c: schreibende Tool-Aktionen

**Der Rahmen ist gebaut.** `src/lib/effects/types.ts`: *Effekte laufen NUR in acting steps, strikt NACH dem
Guardrail/Approval-Gate.* Ein schreibender Tool-Effekt ist damit „nur" ein `acts:true`-Step — er läuft nie ohne
Freigabe.

**Muster pro Schreib-Konnektor** (spiegelbildlich zu `getEmailProvider`): ein `ToolActionProvider`-Interface
mit schmaler Methode pro Aktion (`createCalendarEvent`, `createCrmNote`), Fake in dev/test, real in prod.
Token: dasselbe `enc:`-Token aus dem OAuth-Install, via `decryptString` VOR der Tx aufgelöst; Tool-Call
außerhalb der Tx, nur das Ergebnis atomar geschrieben. Dry-run gratis über `describeEffect`.

**Governance NICHT lockern:** neuer Effekt = neuer Guardrail-Grund (irreversible externe Schreibzugriffe → nie
`never`); Presets fail-closed erweitern; mehrstufige Autonomie braucht checkpoint-gebundene Approvals.

**Einordnung:** Etappe 4, nach den checkpoint-gebundenen Approvals.

---

## Der gestufte Etappenplan (alle vier Blöcke)

> **Ehrliche Zeit-Einordnung zum 27. Juli:** Realistisch liegt bis zur Deadline **nur Etappe 1** (der erste
> Deliverable-Skill), ggf. der Anfang von Etappe 2. Alles ab Kunden-Entität + Speicher + robustem Treiber und
> alle drei neuen Blöcke (F/G/H) liegen **nach** dem 27. Juli. Das ist keine Schwäche — es ist die Folge davon,
> dass Blocks 1/3b/3c/4 auf der Kunden-Entität und dem Ausführungs-Treiber aufsetzen.

| Etappe | Inhalt | Zeit |
|---|---|---|
| **1** | Erster Deliverable-Skill `transkript_zu_framework`, Text-Output, bestehende Engine + Approval + Slack | **bis 27.07.** |
| **2** | Kunden-Entität + Artefakt-Speicher (Vercel Blob, **US-Region**) + request-übergreifende Ausführung (Vercel-nativ). Dedup `external_ref` als Datenqualität mitziehen. | nach 27.07. |
| **3** | Checkpoint-Approvals + **durable Queue (frei wählbar)** + Slides-Output + strukturierte LLM-Ausgabe. Block 1: erster Linear-Konnektor. | nach 27.07. |
| **4** | Loop schmal (Warn-Flags Stufe A) + schreibende Tool-Anbindung + weitere Konnektoren | nach 27.07. |

**Schmaler erster Beweis pro Block** (falls früher gewünscht): Block 1 = ein Linear-Webhook → Tickets als
`documents` (mit `external_ref`, `restricted`). Block 3b/4 = Akzeptanzkriterien-Prüfung am Ende von
`transkript_zu_framework` → Flag als Audit-Eintrag + Slack-Post. Block 3c = ein Kalender-Event als `acts:true`-Step mit Guardrail.

---

## Ehrliche Risiken pro Block

**Block 1 (lesend):**
- **Datenqualität (größtes Risiko):** ohne Dedup verschmutzt wiederholtes Pollen die Wissensbasis → schlechteres
  Retrieval für **alle** Features. Pflicht ab dem ersten Konnektor.
- **fail-closed-Sichtbarkeit:** vertrauliche Tickets dürfen nicht `open` sein. Pflicht ab dem ersten Konnektor.
- **Destabilisierung:** gering (isolierte Routen/Cron, erben Signatur/Idempotenz/Tenant-Muster). ack-then-work Pflicht.
- **Scope-Falle:** „alle Tools" ist unbegrenzt. Diszipliniert **ein** Tool (Linear) als Muster, dann inkrementell.

**Block 3b + 4 (Warn-Flags/Loop):**
- **Scope-Explosion (größtes Risiko):** der verführerischste Ort für Feature-Creep. Gegenmittel: Stufe A zuerst,
  harte Grenze „melden, nicht nachjustieren", kein LLM-als-Richter.
- **Alarm-Müdigkeit:** schlecht kalibrierte Kriterien → Rausch-Flags → das eine wichtige geht unter. Nur
  struktur-prüfbare Kriterien + wenige Schwellen, pro Deliverable-Typ editierbar.

**Block 3c (schreibend) — höchstes Risiko:**
- **Außenwirkung:** ein Schreib-Effekt ist irreversibel (CRM-Eintrag, Kalender-Einladung an Kunden). Ein Bug hat
  echte Außenwirkung. Strikt hinter dem Approval-Gate, Guardrail pro Aktion, `describeEffect`-Vorschau, Governance nie lockern.
- **Reihenfolge:** erst checkpoint-gebundene Approvals, sonst kein sauberes Einzel-Freigeben mehrstufiger Läufe.

---

## Der nächste Schritt: bauen

Der Plan ist vollständig. Alle vier Blöcke sind durchgeplant, die Risiken bekannt und gemanagt, die
Bau-Reihenfolge klar. **Ab hier ist Schluss mit Planen.**

**Nächster konkreter Schritt: Etappe 1 — der `transkript_zu_framework`-Skill.** Er füllt im Blueprint sichtbar
den Kernpfad (Transkript → Kern → Deliverable), ist in Tagen baubar, setzt komplett auf dem bestehenden Stack
auf (SkillDef/Engine, `holeWissen` für Kontext, `getChatProvider`, das `answerQuestion`-Muster), nutzt
Human-in-the-Loop über das bestehende Approval-Gate + Slack — und fasst nichts vom laufenden Produkt an.

Er ist von der ganzen US-Diskussion unberührt: kein Tool-Lesen, keine Retention, keine Hosting-Region, keine
Compliance. Der ehrliche Machbarkeitsbeweis, der die Vision zeigt, bevor eine einzige neue Tabelle entsteht.

**Für die Bewerbung/das Video:** Etappe 1 wird gebaut und gezeigt; die vollständige Landkarte (dieser Plan)
wird als Vision erzählt. Gebaut + visioniert — die Kombination, die YC will. Schlagzeile ist die **Fähigkeit**
(Company Brain, das handelt, mit Loop), die Sicherheits-Substanz heißt **„enterprise-grade"**, nicht „DSGVO".
