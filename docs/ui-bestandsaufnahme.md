# UI/UX-Bestandsaufnahme helix.ai

Stand: 2026-07-04. Reine Analyse des Code-Ist-Zustands, keine Wertung gegen ein Soll-Design.

---

## 1. Seiten-Inventar

### Öffentliche Seiten

**Landing Page** (`src/app/page.tsx`)
Minimalistischer Hero mit Headline, Subtext, zwei CTAs (Sign Up / Sign In) und drei Feature-Cards. Nutzt `PublicShell` (Header mit Logo + Language-Switcher + CTA, Footer mit Rechtslinks). Sauber gebaut, nutzt das Design-System konsequent. Einziger Inhalt: Text und Buttons -- keine Grafiken, keine Screenshots, keine Social Proof. Für einen YC-Besucher wirkt das sachlich, aber auch leer.

**Auth-Seiten** (`src/app/sign-in/`, `src/app/sign-up/`, `src/app/select-org/`)
Sign-In/Sign-Up delegieren an Clerk-Komponenten, eingebettet in `.auth-page` (zentriertes Grid mit subtilen Radial-Gradienten). Select-Org zeigt Clerks `OrganizationList`. Visuell stimmig, aber die Clerk-Widgets bringen ihr eigenes Styling mit, das nicht an das helix-Branding angepasst ist (Standard-Clerk-Look).

**Rechtsseiten** (`impressum`, `imprint`, `datenschutz`, `privacy`, `dpa`, `avv`)
Alle in `PublicShell` + `.legal`-Klasse. Sauber formatiert, max-width 720px. Die deutschen Seiten (Impressum, Datenschutz, AVV) enthalten **sichtbare Platzhalter** (`LegalPlaceholder`-Komponente) -- gelb markierte `[Firmenname]`-Felder. Das ist technisch sauber gelöst (auffällig, damit man es nicht vergisst), aber: ein externer Besucher, der auf "Impressum" klickt, sieht eine unausgefüllte Seite.

### Dashboard

**Dashboard-Übersicht** (`src/app/dashboard/page.tsx`)
Umfangreichste Seite: Onboarding-Card (verschwindet nach Abschluss), Pending-Approvals-Banner, KPI-Grid (5 Karten: Dokumente, Skills, Runs 7d, Freigaben, Wert 30d), Activity-Tabelle (letzte 8 Audit-Einträge), Quick-Action-Grid (3 Karten: Chat, Upload, Skill). Alle Elemente nutzen das Design-System konsistent. Gut strukturiert, klare Hierarchie.

**Chat / RAG** (`src/app/dashboard/chat/page.tsx`)
Bubble-Chat-Interface mit sticky Input am unteren Rand. User-Bubbles dunkel (Graphit), Assistant-Bubbles hell (Card). Source-Chips in Indigo. Answer-Trace als aufklappbares `<details>`. Feedback-Buttons (Daumen hoch/runter) pro Antwort. Empty-State mit Icon + Text. Funktional vollständig. Schwäche: kein visueller Ladezustand beim Absenden (Form ist ein Server Action, Seite rendert nach Response neu -- kein Streaming, kein Spinner).

**Wissensbasis** (`src/app/dashboard/knowledge/page.tsx` + `upload.tsx`)
Drei Sektionen: Upload-Dropzone (Drag & Drop, Client-Komponente mit Fortschrittsanzeige), manuelles Formular (Titel/Text/Visibility), Dokumententabelle. Die Dropzone ist gut gebaut (Hover-State, Busy-State, pro-Datei-Ergebnisanzeige). Die Admin-Aktionen in der Tabelle (Visibility-Dropdown + Reupload + Delete) sind als Inline-Forms realisiert -- funktional, aber visuell gedrängt: in einer Tabellenzeile stehen ein Badge, ein Select, ein Button, ein File-Input, noch ein Button, noch ein Delete-Button. Auf schmaleren Screens wird das unübersichtlich.

**Skills** (`src/app/dashboard/skills/page.tsx`)
Grid aus Skill-Cards. Jede Card: Name + Typ-Badge (liest/handelt) + Key-Badge + Guardrail-Info + Formular. Die Formulare sind per Skill unterschiedlich (beleg_kontieren hat 3 Felder, rechnung_erstellen hat 3, wissen_zusammenfassen hat 1, Fallback zeigt JSON-Textarea). Dry-Run-Checkbox mit Hinweistext. Konsistente Nutzung des Design-Systems. Schwäche: die Formulare sind direkt auf der Katalog-Seite -- kein separater "Skill starten"-Dialog. Bei 4+ Skills wird die Seite lang und scrolllastig.

**Runs** (`src/app/dashboard/runs/page.tsx`)
Einfache Tabelle: Skill, Betrag, Status (Chip), Datum. Empty-State mit Link zu Skills. Sauber, unspektakulär. Nutzt das Design-System konsequent.

**Run-Detail** (`src/app/dashboard/runs/[id]/page.tsx`)
Header-Card (Skill + Status + ID + Betrag), optionales Simulation-Banner, optionale Awaiting-Card, Timeline der Steps (mit Dot-Markern: grün/rot/grau), Approvals-Section, Result als JSON. Die Timeline ist visuell das aufwändigste Custom-Element im ganzen Dashboard -- sauber umgesetzt mit CSS-Pseudoelementen und Farbcodierung.

**Freigaben** (`src/app/dashboard/approvals/page.tsx` + `approval-actions.tsx`)
Pending: Karten mit Amber-Left-Border, Skill-Name, Zeitstempel, Betrag, Reason, Approve/Reject-Buttons. Decided: Tabelle der letzten 20. Client-seitige `window.confirm()`-Dialoge vor Approve/Reject. Visuell klar, die Amber-Semantik (Mensch gefragt) trägt.

**Value-Dashboard** (`src/app/dashboard/value/page.tsx`)
Period-Tabs (7/30/90/365 Tage), KPI-Grid (Runs, Success-Rate, Saved Hours, Saved Value), Per-Skill-Tabelle, Monthly-Tabelle. Reines Daten-Display, kein Chart/Graph. Sauber gebaut, aber visuell nüchtern -- ein CFO erwartet hier eventuell eine Grafik.

**Audit-Log** (`src/app/dashboard/audit/page.tsx`)
Filter-Chips (all/skill/policy/chat/slack/lifecycle) + Actor-Suchfeld, Tabelle (Zeit/Event/Actor/Detail), Pagination. JSON-Details per `<details>`. Funktional komplett. Filter-Chips nutzen das Design-System sauber.

**Security** (`src/app/dashboard/security/page.tsx`)
Admin-only. Honesty-Banner (Amber-getönt), Grid aus Property-Cards (Titel + Status-Chip + Body + Evidence/Basis-Zeilen), Proof-Footer. Unterscheidet visuell zwischen live-geprüft (grüner Dot) und test/architektur-gesichert (Indigo ohne Dot). Durchdacht und ehrlich -- eines der stärksten UI-Elemente.

**Settings** (`src/app/dashboard/settings/page.tsx`)
9 Tabs (Approvals, Visibility, Members, Governance, Company, Value, Slack, Language, Data). Jeder Tab ist ein eigener Abschnitt mit Cards und Formularen. **Umfangreichste Seite im Projekt** (849 Zeilen). Die Tab-Navigation nutzt `.tabs`/`.tab`-Klassen aus dem Design-System. Inhaltlich ist alles da, visuell sind die einzelnen Tabs unterschiedlich poliert:
- *Approvals*: Policy-Tabelle mit Inline-Forms pro Zeile -- funktional, aber komplex.
- *Visibility*: Checkbox-Matrix (Level x Rolle) -- klar, aber klein.
- *Members*: Tabelle mit Role-Dropdown -- sauber.
- *Governance*: Preset-Cards + Export-Button + Import-Textarea + File-Upload -- viel auf einmal.
- *Company*: Standard-Formular -- sauber.
- *Value*: Tabelle mit Minuten-Inputs pro Skill -- funktional.
- *Slack*: OAuth-Flow + manuelle Installation + User-Link-Tabelle -- funktional, aber visuell dicht.
- *Language*: Zwei Selects -- schlicht, sauber.
- *Data*: Export, Retention, Erase (rot umrandet) -- die Danger-Zone ist visuell markiert.

**Demo: Tenant-Isolation** (`src/app/demo/isolation/`)
Standalone-Seite ohne Dashboard-Chrome. Eigenes Layout mit Branding. Zwei Tenant-Panels nebeneinander, Button "Versuch Cross-Tenant-Zugriff", animiertes Verdict mit Evidence-Liste. Visuell das pollierteste Element im Projekt -- bewusst screenshot-tauglich gestaltet.

---

## 2. Design-System

### Fundament (definiert in `src/app/globals.css`, 1786 Zeilen)

**Farben (CSS Custom Properties):**
- Canvas: `--bg` (#f5f6f4 warmes Papier), `--bg-deep`, `--card` (weiß), `--border`, `--border-strong`
- Text-Stufen: `--text` (fast schwarz), `--text-2` (grau), `--text-3` (helles grau)
- Sidebar: `--graphite` (fast schwarz), `--graphite-2`, `--sidebar-text`
- Semantik: `--indigo` (Wissen/liest), `--orange` (Handlung/ausführt), `--amber` (wartet auf Mensch), `--green` (erledigt), `--red` (abgelehnt/fehlgeschlagen)
- Jede Semantik-Farbe hat Varianten (deep, bright, bg-Töne)

**Typografie:**
- `--font-display` (Fraunces): Wortmarke, Überschriften -- Serifen, warm, Charakter
- `--font-sans` (Inter): Fließtext, Zahlen -- clean, tabular-nums
- `--font-mono` (JetBrains Mono): IDs, Timestamps, Events, Eyebrow-Labels
- Font-Loading: `next/font/google` mit `display: 'swap'`, korrekt als CSS-Variablen auf `<body>` gesetzt

**Geometrie:**
- `--radius` (14px), `--radius-sm` (10px) -- einheitlich, eher großzügig
- `--sidebar-w` (248px)
- `--shadow: none` (Default), `--shadow-lift` nur bei Hover -- bewusst flach

**Animationen:**
- `rise-in`: sanftes Aufgleiten beim Seitenaufruf (gestaffelt per nth-child)
- `skeleton-shimmer`: Loading-Skelette
- Beides respektiert `prefers-reduced-motion`

### Komponentenklassen (alle in globals.css, keine Component Library)

| Klasse | Zweck | Qualität |
|---|---|---|
| `.card`, `.card--table`, `.card--sim`, `.card--awaiting` | Karten mit Varianten | Konsistent, gut |
| `.kpi-grid`, `.kpi-card`, `.kpi-value`, `.kpi-label` | Kennzahlen-Karten | Sauber, Eyebrow-Pattern |
| `.chip`, `.chip--indigo/orange/amber/green/red/gray/sim` | Status-Badges | Vollständig, semantisch |
| `.btn`, `.btn--primary`, `.btn--ghost` | Buttons | Funktional, 3 Varianten |
| `.table`, `.card--table` | Tabellen | Sauber, th nutzt Mono-Eyebrow |
| `.timeline`, `.tl-dot` | Step-Timeline | Handwerklich gut |
| `.bubble`, `.bubble--user/assistant/empty` | Chat-Bubbles | Klar differenziert |
| `.dropzone` | Upload-Zone | Hover/Drag/Busy-States |
| `.tabs`, `.tab` | Tab-Navigation | Funktional |
| `.filter-chips`, `.filter-chip` | Audit-Filter | Sauber |
| `.nav-item`, `.nav-section`, `.nav-badge` | Sidebar-Navigation | Poliert |
| `.empty` | Leerzustände | Einheitlich, dashed border |
| `.skeleton` | Loading-States | Shimmer-Animation |
| `.approval-card` | Freigabe-Karten | Amber-Left-Border |
| `.sec-grid`, `.sec-card`, `.sec-meta` | Security-Properties | Durchdacht |
| `.leak-*` | Isolation-Demo | Eigenes Subsystem, poliert |

### Shared UI-Komponenten (`src/app/dashboard/ui.tsx`)

Reine Server-Components: `RunStatusChip`, `ApprovalStatusChip`, `VisibilityBadge`, `ActorChip`, `SimulationBadge`, `SecurityStatusChip`, `JsonView`, plus exportierte Formatierungs-Helfer. Alle locale-aware. Kein eigenes Styling -- nutzen ausschließlich die CSS-Klassen.

### Marke (`src/app/brand.tsx`)

SVG-Helix-Mark als React-Komponente. Zwei Varianten (light/dark) mit den Semantik-Farben (Indigo = Wissen, Orange = Handlung, Grau = Governance-Sprossen). Konsistent in Sidebar, Public-Shell und Demo-Seite verwendet.

---

## 3. Konsistenz: Wo es funktioniert, wo es bricht

### Stark konsistent

- **Farbsemantik** wird durchgängig eingehalten: Indigo = liest, Orange = handelt, Amber = wartet, Grün = erledigt, Rot = abgelehnt. Kein einziger Bruch im gesamten Codebase.
- **Chip-System** ist vollständig und wird überall korrekt eingesetzt (RunStatusChip, ApprovalStatusChip, VisibilityBadge, ActorChip, SimulationBadge, SecurityStatusChip).
- **Eyebrow-Pattern** (Mono, klein, uppercase, letter-spacing) ist konsistent bei KPI-Labels, Table-Headers, Nav-Sections, Security-Meta-Labels.
- **Leerzustände** nutzen einheitlich `.empty` mit dashed border, Icon und Text.
- **Loading-States**: Jede Dashboard-Route hat eine `loading.tsx` mit passenden Skeleton-Komponenten.
- **Typografie-Rollen** sind durchgängig korrekt: Fraunces für Überschriften, Inter für Text, JetBrains Mono nur für IDs/Events/Timestamps.
- **Responsive**: Sidebar collapsed auf < 1024px (Labels verschwinden, nur Icons). Demo-Seite hat eigenen mobile Breakpoint.

### Inkonsistenzen und Brüche

1. **Inline-Styles statt Klassen**: Viele Seiten nutzen `style={{ ... }}` direkt im JSX, statt CSS-Klassen zu definieren. Beispiele:
   - `page.tsx:162` (Dashboard): `style={{ whiteSpace: 'nowrap' }}`
   - `settings/page.tsx:764`: `style={{ borderColor: '#c0392b' }}` (Danger-Zone-Card) -- hardcoded Farbwert statt CSS-Variable
   - `skills/page.tsx:188-192`: Label-Checkbox-Kombination mit 5 inline Style-Properties
   - `settings/page.tsx:368`: Grid-Layout als inline style statt CSS-Klasse
   - Das ist kein visueller Bruch (die Seiten sehen konsistent aus), aber es ist technische Schuld: die gleichen Patterns wiederholen sich ohne eine Klasse.

2. **Icon-Duplikation**: Die `Icon`-Hilfskomponente (SVG-Wrapper) ist in `shell.tsx` UND in `dashboard/page.tsx` separat definiert -- identischer Code, zwei Stellen. Die SVG-Path-Daten für die gleichen Icons (knowledge, skills, runs, etc.) sind ebenfalls dupliziert zwischen Shell und Dashboard-Seite.

3. **Formulare auf der Skills-Seite**: Die Skill-Formulare sind als großer if/else-Block in der Page-Komponente implementiert (`skills/page.tsx:87-184`). Jeder Skill hat seine eigene Formular-Logik inline. Das funktioniert bei 4-5 Skills, skaliert aber schlecht. Es gibt keine Form-Validierung jenseits von HTML `required`.

4. **Admin-Aktionen in der Knowledge-Tabelle**: In einer Tabellenzeile stehen bis zu 6 Interaktionselemente (Badge, Select, Change-Button, File-Input, Reupload-Button, Delete-Button). Kein Responsive-Handling dafür -- auf < 1024px überlappt das.

5. **Hardcoded Strings**: Die Erase-Card in Settings nutzt `style={{ borderColor: '#c0392b' }}` und `style={{ color: '#c0392b' }}` -- die einzigen hardcoded Farben im Projekt. Der Rest nutzt CSS-Variablen.

6. **Kein Dark Mode**: Das Design-System definiert keinen Dark Mode. Angesichts der bewussten "Werkstatt"-Ästhetik (warmes Papier, Graphit-Sidebar) ist das eine Design-Entscheidung, kein Versäumnis -- aber es ist ein Bruch mit modernen Erwartungen.

---

## 4. UX-Schwachstellen

### Was einem YC-Partner / Piloten auffallen würde

1. **Landing Page ist karg**: Nur Text + 3 Feature-Cards. Keine Screenshots, keine Demo-GIFs, kein Social Proof, keine Metriken. Ein YC-Partner, der die URL öffnet, sieht eine funktionale, aber leere Seite. Die Isolation-Demo (`/demo/isolation`) ist das stärkste visuelle Asset -- aber sie ist nicht von der Landing Page verlinkt.

2. **Skills-Seite zeigt Formulare direkt**: Es gibt keine Übersichtsseite, die nur den Katalog zeigt und dann in einen separaten Start-Flow führt. Stattdessen ist jede Skill-Card gleichzeitig der Start-Dialog. Bei einem ersten Besuch sieht der Nutzer sofort Formularfelder, bevor er versteht, was der Skill tut. Es fehlt eine Beschreibung pro Skill (nur Titel + Typ-Badge + Guardrail).

3. **Chat hat kein Streaming/Lade-Feedback**: Der Chat nutzt Server Actions -- die Frage wird abgeschickt, die Seite rendert komplett neu mit der Antwort. Kein Spinner, kein "tippt..."-Indikator, kein Streaming. Bei einem LLM-gestützten RAG-System erwartet ein Nutzer sofortiges visuelles Feedback.

4. **Value-Dashboard ohne Visualisierung**: Nur KPI-Karten und Tabellen. Kein Chart, keine Trend-Linie, kein Balkendiagramm. Der Wert der Automatisierung wird in Zahlen kommuniziert, aber nicht visualisiert. Für einen "CFO-Blick" fehlt der Wow-Effekt.

5. **Settings-Seite ist überladen**: 9 Tabs, davon einige komplex (Approvals hat eine Policy-Tabelle mit Inline-Forms, Governance hat Import/Export, Slack hat OAuth + manuelle Konfiguration + User-Links). Die Tab-Labels (`settings/page.tsx:120-129`) sind klein und die Leiste scrollt horizontal. Kein visueller Hinweis, dass es mehr Tabs gibt als sichtbar.

6. **Rechtsseiten haben Platzhalter**: Impressum, Datenschutz, AVV zeigen gelb markierte Platzhalter. Für einen YC-Partner oder Piloten, der die Rechtstexte prüft, sieht das unfertig aus.

7. **Keine Bestätigungs-Toasts/Notifications**: Alle Mutationen (Dokument löschen, Policy speichern, Rolle ändern, etc.) nutzen Server Actions mit `revalidatePath`. Es gibt kein Toast, keinen Success-Banner, keine Bestätigung. Der Nutzer muss selbst erkennen, ob die Aktion erfolgreich war (Seite lädt neu, Daten sind aktualisiert -- oder eben nicht).

8. **Mobile ist eingeschränkt**: Die Sidebar collapsed, aber der Content-Bereich (`.content`) hat feste `padding: 1.75rem 2.25rem` und `max-width: 1120px`. Tabellen mit vielen Spalten (Knowledge, Settings/Approvals) haben keinen horizontalen Scroll-Container. Auf einem Tablet wird das eng.

---

## 5. Was schon gut ist

1. **Kohärente Design-Sprache**: Das "Werkstatt, nicht Labor"-Branding ist konsequent umgesetzt. Warmes Papier, Graphit-Sidebar, Stahl-Indigo/Glut-Orange-Dualität, Eyebrow-Pattern -- das liest sich als ein System, nicht als Zusammenwurf.

2. **Semantische Farbcodierung**: Die Zuordnung Indigo=liest, Orange=handelt, Amber=wartet, Grün=fertig, Rot=fehlgeschlagen zieht sich durch jede Seite und ist sofort verständlich. Das ist eine echte Stärke -- ein Nutzer lernt die Bedeutung einmal und kann sie überall anwenden.

3. **Typografie-Hierarchie**: Drei Fonts mit klaren Rollen (Display/Sans/Mono), jeweils mit tabular-nums, optical-sizing und korrektem font-swap. Kein Font wird falsch eingesetzt.

4. **Skeleton-Loading**: Jede Route hat eine loading.tsx mit kontextspezifischen Skeletten (Chat hat Bubble-Skelette, Overview hat KPI-Grid-Skelette). prefers-reduced-motion wird respektiert. Das ist mehr Aufwand als die meisten Projekte investieren.

5. **i18n ist vollständig**: Jeder sichtbare String kommt aus dem Dictionary-System. Deutsch und Englisch komplett. Kein hardcoded Text in den Komponenten (einzige Ausnahme: Rollen-Labels `Owner/Admin/Lead/Member` in shell.tsx und settings.tsx sind englisch).

6. **Isolation-Demo**: `/demo/isolation` ist handwerklich das beste Stück UI im Projekt -- animierte Verdicts, Evidence-Liste, eigene CSS-Klassen, mobile-optimiert. Screenshot- und Video-tauglich.

7. **Onboarding-Card**: Verschwindet automatisch, wenn alle 4 Schritte erledigt sind. Kein separater State, reine Datenableitung. Schlicht und funktional.

8. **Security-View**: Ehrlich (live-geprüft vs. test-gesichert), visuell differenziert (grüner Dot nur bei live-verified), mit Honesty-Banner. Das ist ein Feature, das Vertrauen schafft.

9. **Shared UI-Atome sind rein**: `ui.tsx` enthält nur pure, server-renderable Display-Komponenten. Kein State, keine Side-Effects. Sauber getrennt.

10. **CSS ist handwerklich gut**: Keine Utility-Klasse-Flut, kein Framework-Overhead. `color-mix()` für Transparenz-Varianten, CSS-Variables für alles, Box-Shadows nur bei Interaktion. Bewusste Entscheidungen.

---

## 6. Die 5 dringendsten Stellen

1. **Skills-Seite braucht einen Einstiegs-Flow**: Formulare direkt im Katalog überfordern Erstbesucher. Ein Skill braucht eine Beschreibung, bevor man ihn startet. Die aktuelle Seite funktioniert für Power-User, nicht für einen Piloten beim ersten Login.

2. **Chat braucht Lade-Feedback**: Kein Spinner, kein Streaming-Indikator. Bei einem KI-Produkt ist das die Kerninteraktion -- sie muss sich responsive anfühlen, nicht wie ein Formular-Submit mit Page Reload.

3. **Landing Page braucht visuelle Substanz**: Ein YC-Partner sieht Text und 3 leere Feature-Cards. Die Isolation-Demo, das Security-Dashboard, das Value-Dashboard -- alles existiert, aber nichts davon ist auf der Startseite sichtbar. Mindestens ein Screenshot oder eine verlinkte Demo würde helfen.

4. **Bestätigungs-Feedback fehlt systemweit**: Keine Toasts, keine Success-Banner. Jede Mutation (Dokument löschen, Policy ändern, Rolle zuweisen) gibt dem Nutzer kein visuelles Feedback. Das ist in einer Governance-Anwendung, in der Aktionen Konsequenzen haben, ein echtes UX-Problem.

5. **Value-Dashboard braucht mindestens ein Chart**: Reine Tabellen reichen nicht für eine "Was bringt uns die Automatisierung?"-Seite. Ein Trend-Chart (Runs/Monat, Saved Value/Monat) wäre der Unterschied zwischen "Datenblatt" und "Werkzeug, das Wert visualisiert".
