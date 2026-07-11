# UI-Struktur-Konzept: Informationsarchitektur für das volle OS

Stand: 2026-07-04. Reine Planungsarbeit — kein Code, kein Branch, kein Commit.

**Grundlage:** `docs/helix-os-bauplan-us.md` (OS-Vision + Etappenplan), `docs/ui-bestandsaufnahme.md` (UI-Ist-Zustand), `src/app/dashboard/shell.tsx` (heutige Navigation).

---

## 1. Bestandsaufnahme der heutigen Navigation

Die Sidebar (`shell.tsx`, Zeile 45–113) gruppiert 10 Punkte in 3 Sektionen:

| Sektion (titleKey) | Punkte | Semantik |
|---|---|---|
| **Arbeitsbereich** (`workspace`) | Übersicht · Chat · Wissensbasis | „Wissen nutzen" — liest |
| **Automatisierung** (`automation`) | Skills · Runs · Freigaben · Value | „Skills laufen lassen, Mensch entscheidet" — handelt |
| **Governance** (`governance`) | Audit · Security* · Settings* | „Nachvollziehen, steuern" — verantwortet |

\* = `adminOnly: true`

### Was an der heutigen Struktur funktioniert

- Die Dreiteilung spiegelt die Produkt-Semantik (liest → handelt → verantwortet) und die Farbcodierung (Indigo → Orange → neutral).
- 10 Punkte sind für eine Sidebar handhabbar. Scrollbar ist nicht nötig.
- Die Gruppen-Überschriften als Mono-Eyebrow (`.nav-section-label`) sind dezent und stören nicht.
- Das Approval-Badge (`.nav-badge`) zeigt offene Freigaben — ein gutes Aufmerksamkeitssignal.

### Was nicht mehr tragen wird

- **Value** sitzt in „Automatisierung", obwohl es eine Auswertung ist, keine Ausführung. Es ist dort gelandet, weil es sich auf Skills/Runs bezieht — aber konzeptionell ist es eher Reporting.
- **Es gibt keinen Bereich für die Kern-Entität „Kunde".** Kunden sind im Code bereits als Konzept da (Tenant = Org = Mandant), aber als Arbeitsgegenstand gibt es sie in der Navigation nicht. Das OS wird Kunden aber zum zentralen Ordnungsprinzip machen.
- **Alle künftigen Bereiche (Deliverables, Flags, Konnektoren) haben heute keinen logischen Platz.** Die Dreiteilung müsste gedehnt werden, was die klare Semantik verwässert.

---

## 2. Was laut OS-Plan noch dazukommt

Abgeleitet aus `docs/helix-os-bauplan-us.md`:

### 2a. Kunden / Clients (Etappe 2)

Die Kunden-Entität ist die größte strukturelle Lücke. Der OS-Plan beschreibt ein „Kunden-Gedächtnis" — pro Kunde gibt es Kontexthistorie, Deliverables, Aktivitäten, Flags. Das braucht:

- **Kunden-Liste** — alle Kunden mit Schnell-Status (letzte Aktivität, offene Flags, laufende Deliverables).
- **Kunden-Detail** — ein Kunden-Profil mit: Kontakt/Stammdaten, Deliverable-Timeline, Aktivitäts-Historie, Flags, verknüpfte Dokumente aus der Wissensbasis.

### 2b. Deliverables / Artefakte (wird GERADE gebaut, Etappe 1–2)

Das andere Fenster baut gerade den Artefakt-Speicher. Aus OS-Plan-Sicht:

- **Deliverables-Liste** — alle erzeugten Artefakte (Frameworks, Use Cases, Angebote, Slides), filterbar nach Kunde/Typ/Status.
- **Deliverable-Detail** — Inhalt, Trace (welche Quellen stützten welche Aussage), Status (Entwurf/in Freigabe/final), Download/Teilen.
- **Deliverables pro Kunde** — als Unterpunkt auf der Kunden-Detail-Seite (keine separate Navigation, sondern natürlicher Kontext).

### 2c. Loop / Warn-Flags (Etappe 4)

Der OS-Plan definiert zwei Stufen: Flags als Audit-Einträge (Stufe A) und später als eigene Entität (Stufe B).

- **Stufe A (erster Schritt):** Kein eigener Nav-Punkt nötig — Flags erscheinen im Audit-Log (Action `flag.*`) und auf dem Cockpit/Dashboard. Ein Filter-Chip „Flags" im Audit reicht.
- **Stufe B (wenn eigene Entität):** Ein eigener View „Flags" (offene/quittierte/erledigte Flags, pro Kunde gruppierbar). Dann braucht es einen Nav-Punkt — aber dieser gehört in den Bereich „Kontrolle", nicht „Arbeit".

### 2d. Tool-Anbindung / Konnektoren (Etappe 3–4)

ConnectorDef-Architektur (Push/Pull), OAuth-Installs, Token-Status:

- **Konnektoren-Verwaltung** — Liste der angebundenen Tools (Linear, GitHub, Google Workspace, Slack), Installations-Status, letzte Synchronisation, Fehler.
- **Konnektor-Detail** — OAuth re-install, Sync-Status, Logs.

Das ist eine Admin-Funktion, nicht tägliche Nutzung. Es gehört in den Bereich „Einrichtung/Verwaltung", nicht in die Kern-Navigation.

---

## 3. Die Ziel-Struktur

### Design-Prinzipien

1. **Maximal 4 Gruppen.** Mehr fragmentiert die Sidebar, weniger verliert die Ordnung.
2. **Gruppen spiegeln Aktivitäts-Muster.** Tägliche Arbeit (häufig) oben, Einrichtung (selten) unten.
3. **Die Kunden-Ebene wird die primäre Ordnung.** Nicht als eigene Gruppe, sondern als zentraler Einstieg im Cockpit + eigener Bereich. Deliverables, Flags, Historie werden pro Kunde sichtbar, nicht als isolierte Listen.
4. **Value und Flags wandern zu Governance/Kontrolle.** Sie sind Auswertungen und Überwachung, keine Ausführung.
5. **Konnektoren wandern in Settings.** Sie sind Einrichtung, nicht tägliche Arbeit.

### Vorgeschlagene Ziel-Nav-Struktur

```
──────────────────────────
  helix.ai ← Logo/Home

  COCKPIT
    ◈ Übersicht              ← das neue Dashboard (Abschnitt 4)

  ARBEIT
    💬 Chat                   ← RAG, unverändert
    📚 Wissensbasis            ← Dokumente, unverändert
    👥 Kunden                  ← NEU: Kunden-Liste
    📦 Deliverables            ← NEU: Artefakte (alle, oder gefiltert)

  AUSFÜHRUNG
    ⚡ Skills                  ← Skill-Katalog + Start-Flow
    🔄 Runs                    ← Lauf-Liste
    🛡 Freigaben               ← Approvals mit Badge

  KONTROLLE
    📊 Value                   ← war: Automatisierung → jetzt: Kontrolle
    📋 Audit                   ← unverändert
    🚩 Flags                   ← NEU (erst ab Stufe B, s. Migrationspfad)
    🔒 Security*               ← unverändert, adminOnly

  ──────────────────────────
  ⚙ Settings*                ← am unteren Rand, adminOnly
  ──────────────────────────
  [Tenant-Card]
  [UserButton]
```

\* = adminOnly

### Begründung der Gruppierung

**COCKPIT (1 Punkt):** Der zentrale Einstieg. Heute ist „Übersicht" der erste Punkt in „Arbeitsbereich". Im OS wird es zum Cockpit, das den Systemzustand zeigt (siehe Abschnitt 4). Es steht allein, weil es keiner Kategorie gehört — es ist die Klammer über alle.

**ARBEIT (4 Punkte):** Alles, was mit dem täglichen Arbeitsgegenstand zu tun hat — Wissen nutzen, Kunden betreuen, Ergebnisse sehen. Chat und Wissensbasis bleiben hier (Indigo-Semantik: liest/Wissen). Kunden und Deliverables kommen dazu, weil sie das sind, woran der Nutzer täglich arbeitet. Die Reihenfolge folgt dem Arbeitsfluss: Wissen einholen (Chat, Wissensbasis) → Kunden bearbeiten → Ergebnisse sehen (Deliverables).

**AUSFÜHRUNG (3 Punkte):** Was die Maschine tut und wo der Mensch eingreift. Skills starten, Runs beobachten, Freigaben erteilen. Entspricht der Orange-Semantik (handelt). Value wandert raus, weil es Rückblick ist, nicht Ausführung.

**KONTROLLE (3–4 Punkte):** Transparenz, Nachvollziehbarkeit, Vertrauen. Value (Wert der Automatisierung = Kontrollfrage „bringt das was?"), Audit (was ist passiert), Flags (was weicht ab), Security (wie sicher ist das). Das ist die Antwort auf die Governance-Frage, erweitert um die Loop-Perspektive.

**Settings (1 Punkt, abgesetzt):** Einrichtung und Verwaltung. Steht am unteren Sidebar-Rand, visuell getrennt von der Navigation. Konnektoren (Tool-Anbindungen) werden ein neuer Tab innerhalb von Settings — sie sind Einrichtung, kein täglicher Arbeitsbereich. Das folgt dem Muster: Slack-Integration ist heute schon ein Settings-Tab.

### Punkt-Zählung

- Nicht-Admin sieht: 1 + 4 + 3 + 2 + 0 = **10 Punkte** (genau wie heute, nur besser sortiert)
- Admin sieht: 1 + 4 + 3 + 4 + 1 = **13 Punkte** (heute: 10)
- Flags kommt erst mit Stufe B dazu (zunächst 12 Punkte für Admin)

Das ist handhabbar. Die Gruppen verhindern, dass 13 Punkte als flache Liste wirken. Der Sprung von 10 auf 13 ist moderat, weil 3 der „neuen" Punkte (Kunden, Deliverables, Flags) echte neue Entitäten repräsentieren, nicht Feature-Creep.

---

## 4. Der zentrale Einstieg: das Cockpit

Der OS-Plan beschreibt helix als „durchgehende Verarbeitungsschicht" mit geschlossenem Loop. Die Dashboard-Übersicht wird zum Cockpit — die visuelle Entsprechung des Operating-System-Gedankens.

### Was das Cockpit zeigt

Das heutige Dashboard (`dashboard/page.tsx`) hat: Onboarding-Card, KPI-Grid (5 Karten), Activity-Tabelle (8 Einträge), Quick-Actions (3 Karten). Das ist ein guter Startpunkt, aber es fehlt die Kunden-Dimension und die Loop-Perspektive.

**Ziel-Cockpit (Skizze):**

```
┌─────────────────────────────────────────────────────────┐
│ AUFMERKSAMKEITS-LEISTE (amber, nur wenn nötig)          │
│ 🛡 3 Freigaben warten · 🚩 1 Flag offen · ⚡ 2 Runs laufen │
└─────────────────────────────────────────────────────────┘

┌─────────── KPI-GRID (4–5 Karten) ──────────────────────┐
│  Aktive Kunden    Deliverables     Erfolgsquote    Wert │
│     12              7 (3 offen)     94%           $42k  │
└─────────────────────────────────────────────────────────┘

┌─────────── KUNDEN-ÜBERSICHT (kompakte Tabelle/Cards) ──┐
│ Acme Inc      letzte Akt: gestern   2 Deliverables  ──→│
│ Initech       letzte Akt: heute     1 Flag offen    ──→│
│ Umbrella      letzte Akt: vor 3d    0 offen         ──→│
│ + alle Kunden anzeigen                                  │
└─────────────────────────────────────────────────────────┘

┌─── LETZTE AKTIVITÄT ──┐  ┌─── SCHNELL-AKTIONEN ──────┐
│ (wie heute, 6–8 Zeilen)│  │ 💬 Chat öffnen            │
│ Audit-Einträge         │  │ ⚡ Skill starten           │
│                        │  │ 📚 Dokument hochladen     │
└────────────────────────┘  └───────────────────────────┘
```

### Designprinzipien des Cockpits

1. **Aufmerksamkeit zuerst.** Die Leiste oben zeigt nur, was Handlung erfordert (offene Freigaben, Flags, laufende Runs). Sie verschwindet, wenn alles erledigt ist. Amber-Semantik (wartet auf Mensch).
2. **Kunden als primäre Ordnung.** Die Kunden-Übersicht ist der Kern — nicht abstrakte KPIs, sondern „wo stehe ich mit meinen Kunden?". Jede Zeile ist klickbar → Kunden-Detail.
3. **KPIs werden kundenübergreifend.** Aktive Kunden (statt nur Dokumente), Deliverables (statt nur Runs), Erfolgsquote und Wert bleiben.
4. **Die Quick-Actions bleiben.** Sie sind ein guter Einstieg für Power-User.
5. **Onboarding-Card bleibt.** Sie verschwindet ohnehin automatisch.

### Was das Cockpit NICHT ist

- Kein Dashboard im BI-Sinn (Charts, Trends). Dafür gibt es den Value-View.
- Kein Posteingang. helix ist kein Kommunikationstool.
- Kein vollständiger Kunden-View. Die Tabelle auf dem Cockpit zeigt 5–8 Kunden als Schnellzugang; die vollständige Kunden-Liste lebt unter „Arbeit → Kunden".

---

## 5. Migrationspfad

### Phase A: Sofort machbar (ohne neue Features)

**Was:** Die bestehenden 10 Nav-Punkte in die neue Vier-Gruppen-Struktur umordnen. Kein neuer View, nur Umgruppierung.

```
  COCKPIT
    Übersicht         ← war: Arbeitsbereich > Übersicht

  ARBEIT
    Chat              ← war: Arbeitsbereich > Chat
    Wissensbasis      ← war: Arbeitsbereich > Wissensbasis

  AUSFÜHRUNG
    Skills            ← war: Automatisierung > Skills
    Runs              ← war: Automatisierung > Runs
    Freigaben         ← war: Automatisierung > Freigaben

  KONTROLLE
    Value             ← war: Automatisierung > Value (umgruppiert!)
    Audit             ← war: Governance > Audit
    Security*         ← war: Governance > Security

  Settings*           ← war: Governance > Settings (abgesetzt)
```

**Aufwand:** Änderung an `SECTIONS` in `shell.tsx` (~30 Zeilen), Dictionary-Keys für die neuen Section-Titles, fertig. Keine Route-Änderung, kein neues Feature. Die Vier-Gruppen-Struktur kann an einem Tag stehen.

**Was das bringt:** Die Struktur steht, in die alle kommenden Bereiche eingefügt werden, ohne dass die Navigation nochmal umgebaut werden muss. Value wandert jetzt schon an den richtigen Platz.

### Phase B: Mit Deliverables (wenn der Artefakt-Speicher steht, ~Etappe 1–2)

**Was:** Nav-Punkt „Deliverables" unter ARBEIT einfügen.

```
  ARBEIT
    Chat
    Wissensbasis
    Deliverables       ← NEU: /dashboard/deliverables
```

Die Deliverables-Liste zeigt alle Artefakte, filtert nach Typ/Status. Detail-Seite zeigt Inhalt + Trace + Status.

**Voraussetzung:** artifact-Tabelle + Deliverables-Route (wird gerade gebaut). Die Navigation ist sofort bereit, weil Phase A die Gruppenstruktur bereits etabliert hat.

### Phase C: Mit Kunden-Entität (Etappe 2)

**Was:** Nav-Punkt „Kunden" unter ARBEIT einfügen, Cockpit um Kunden-Übersicht erweitern.

```
  ARBEIT
    Chat
    Wissensbasis
    Kunden             ← NEU: /dashboard/clients
    Deliverables
```

Die Kunden-Detail-Seite (`/dashboard/clients/[id]`) enthält Deliverables dieses Kunden als Unterpunkt — keine separate Route, sondern Tab oder Sektion auf der Detail-Seite.

**Voraussetzung:** Kunden-Entität in der DB (Etappe 2). Das Cockpit bekommt die Kunden-Übersichts-Tabelle.

### Phase D: Mit Konnektoren (Etappe 3)

**Was:** Neuer Tab „Konnektoren" in Settings.

```
  Settings
    → Tab: Konnektoren    ← NEU (neben Slack, Language, etc.)
```

Kein neuer Nav-Punkt in der Sidebar. Konnektoren sind Einrichtung — sie gehören in Settings, wie Slack-Integration heute schon dort ist. Der Settings-Tab-Leiste wird ein Tab hinzugefügt.

**Voraussetzung:** ConnectorDef-Architektur (Etappe 3). Kein Nav-Umbau nötig.

### Phase E: Mit Flags (Etappe 4)

Zwei Stufen, wie der OS-Plan vorgibt:

**Stufe A (Flags als Audit-Einträge):** Kein Nav-Änderung. Ein neuer Filter-Chip „Flags" auf der Audit-Seite, dazu Flags im Cockpit-Aufmerksamkeitsstreifen. Fertig.

**Stufe B (Flags als eigene Entität):** Nav-Punkt „Flags" unter KONTROLLE.

```
  KONTROLLE
    Value
    Audit
    Flags              ← NEU: /dashboard/flags (erst Stufe B)
    Security*
```

**Voraussetzung:** Flag-Tabelle mit eigenem Status-Lifecycle (offen/quittiert/erledigt). Erst bauen, wenn der Bedarf klar ist — Stufe A reicht möglicherweise lange.

---

## 6. Zusammenfassung: Die Ziel-Navigation auf einen Blick

```
┌──────────────────────────────────────┐
│  helix.ai                            │
│                                      │
│  COCKPIT                             │
│    ◈ Übersicht                       │
│                                      │
│  ARBEIT                              │
│    💬 Chat                            │
│    📚 Wissensbasis                     │
│    👥 Kunden             ← Etappe 2  │
│    📦 Deliverables       ← Etappe 1  │
│                                      │
│  AUSFÜHRUNG                          │
│    ⚡ Skills                          │
│    🔄 Runs                            │
│    🛡 Freigaben  [3]                  │
│                                      │
│  KONTROLLE                           │
│    📊 Value                           │
│    📋 Audit                           │
│    🚩 Flags              ← Etappe 4  │
│    🔒 Security*                       │
│                                      │
│  ────────────────────                │
│  ⚙ Settings*                         │
│    (inkl. Tab: Konnektoren ← Etappe 3)│
│  ────────────────────                │
│  [Tenant-Card]                       │
│  [UserButton]                        │
└──────────────────────────────────────┘
```

### Warum diese Struktur tragfähig ist

1. **Addiert, bricht nicht.** Jeder OS-Baustein (Kunden, Deliverables, Flags, Konnektoren) hat einen vordefinierten Platz. Kein Umbau nötig, nur Einfügen.
2. **Gruppen folgen dem Arbeitsrhythmus.** Cockpit = „was braucht meine Aufmerksamkeit?", Arbeit = „woran arbeite ich?", Ausführung = „was tut die Maschine?", Kontrolle = „funktioniert das?".
3. **Die Farbsemantik bleibt.** Arbeit = Indigo (liest/Wissen), Ausführung = Orange (handelt), Kontrolle = neutral/übergreifend, Cockpit = Amber für Aufmerksamkeit. Keine neue Farbe nötig.
4. **Skaliert nicht über 14 Punkte.** Selbst mit allen Etappen sind es maximal 13 Punkte für Admins (14 mit Flags). Das ist die Obergrenze — darüber hinaus sollten neue Features in bestehende Views integriert werden (z.B. als Tabs auf Detail-Seiten), nicht als neue Nav-Punkte.
5. **Phase A kann sofort.** Die Umgruppierung der bestehenden 10 Punkte in die Vier-Gruppen-Struktur ist eine reine shell.tsx-Änderung. Die Struktur steht, bevor der erste neue View gebaut wird.
