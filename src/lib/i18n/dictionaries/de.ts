// German dictionary — the original platform strings, now selectable via the
// language switcher. Typed against the English source shape: a missing or
// extra key fails `pnpm typecheck`.
import type { Dictionary } from './en';

export const de: Dictionary = {
  nav: {
    overview: 'Übersicht',
    knowledge: 'Wissensbasis',
    chat: 'Chat',
    skills: 'Skills',
    runs: 'Ausführungen',
    approvals: 'Freigaben',
    value: 'Wertbeitrag',
    audit: 'Audit',
    security: 'Sicherheit',
    settings: 'Einstellungen',
    runDetail: 'Ausführung',
    sections: {
      workspace: 'Arbeitsbereich',
      automation: 'Automatisierung',
      governance: 'Governance',
    },
    subtitles: {
      overview: 'Kennzahlen und Aktivität der Organisation auf einen Blick',
      chat: 'Fragen ans geprüfte Wissen — Antworten mit Quellen',
      knowledge: 'Dokumente der Organisation — Sichtbarkeit inklusive',
      skills: 'Abläufe starten — Guardrails und Freigaben inklusive',
      runs: 'Jeder Lauf mit Status, Schritten und Ergebnis',
      approvals: 'Handelnde Schritte, die auf eine menschliche Entscheidung warten',
      value: 'Was die Automatisierung spart — Stunden und Dollar, nur aus Live-Läufen',
      audit: 'Append-only Protokoll — nichts wird verändert oder gelöscht',
      security: 'Was strukturell abgesichert ist — und wie wir es belegen',
      settings: 'Freigabe-Regeln, Sichtbarkeit, Rollen, Slack, DSGVO',
      runDetail: 'Schritt-Timeline, Freigaben und Ergebnis dieses Laufs',
    },
  },

  common: {
    save: 'Speichern',
    change: 'Ändern',
    delete: 'Löschen',
    execute: 'Ausführen',
    expand: 'aufklappen',
    none: '—',
    role: 'Rolle',
    skill: 'Skill',
    status: 'Status',
    amount: 'Betrag',
    title: 'Titel',
    date: 'Datum',
    time: 'Zeit',
    detail: 'Detail',
    visibility: 'Sichtbarkeit',
    format: 'Format',
    filter: 'Filtern',
  },

  status: {
    run: {
      running: 'läuft',
      awaiting_approval: 'wartet auf Freigabe',
      approved: 'freigegeben',
      rejected: 'abgelehnt',
      completed: 'abgeschlossen',
      failed: 'fehlgeschlagen',
    },
    approval: {
      pending: 'offen',
      approved: 'freigegeben',
      rejected: 'abgelehnt',
    },
    actor: { human: 'Mensch', agent: 'Agent' },
    mode: { live: 'Live', simulation: 'Probelauf' },
  },

  overview: {
    kpiDocuments: 'Wissens-Einträge',
    kpiSkills: 'Skills verfügbar',
    kpiRuns7d: 'Ausführungen (7 Tage)',
    kpiPendingApprovals: 'Wartende Freigaben',
    kpiValue30d: 'Wertbeitrag (30 Tage)',
    recentActivity: 'Letzte Aktivität',
    fullAudit: 'Vollständiges Audit →',
    bannerWaiting: (n: number) => (n === 1 ? `${n} Ausführung wartet` : `${n} Ausführungen warten`),
    bannerSuffix: 'auf eine menschliche Freigabe.',
    bannerCta: 'Jetzt entscheiden →',
    quickAskTitle: 'Frage stellen',
    quickAskHint: 'Antworten aus dem geprüften Wissen — immer mit Quellen.',
    quickUploadTitle: 'Wissen hochladen',
    quickUploadHint: 'PDF, DOCX, Markdown oder Text ingestieren und Sichtbarkeit steuern.',
    quickSkillTitle: 'Skill starten',
    quickSkillHint: 'Automatisierungen ausführen — Guardrails inklusive.',
    noActivity:
      'Noch keine Einträge. Aktivität erscheint hier, sobald Wissen ingestiert oder ein Skill ausgeführt wird.',
    quickSkillsHint: 'Automatisierungen starten — Guardrails inklusive.',
    quickKnowledgeHint: 'Dokumente ingestieren und Sichtbarkeit steuern.',
    quickChatHint: 'Fragen ans geprüfte Wissen — Antworten mit Quellen.',
  },

  value: {
    intro:
      'Der Automation Score: was Ihre Live-Skill-Läufe in Stunden und Dollar sparen. Zählt ausschließlich LIVE-Läufe — Probeläufe (Simulationen) erscheinen hier nie. Die Annahmen pro Skill sind editierbar in den',
    introSettingsLink: 'Einstellungen',
    periodAria: 'Zeitraum',
    periodDays: (n: number) => `Letzte ${n} Tage`,
    kpiRuns: 'Live-Läufe',
    kpiSuccessRate: 'Erfolgsquote',
    kpiSavedHours: 'Gesparte Stunden',
    kpiSavedValue: 'Wertbeitrag',
    successRateHint: (completed: number, decided: number) =>
      `${completed} von ${decided} entschiedenen Läufen abgeschlossen`,
    noDecidedRuns: 'noch keine entschiedenen Läufe',
    perSkillTitle: 'Pro Skill',
    perSkillHint:
      'Wert entsteht nur durch abgeschlossene Live-Läufe: gesparte Minuten pro Lauf × Stundensatz.',
    colRuns: 'Läufe',
    colCompleted: 'Abgeschlossen',
    colSavedHours: 'Gesparte Stunden',
    colSavedValue: 'Wert',
    monthlyTitle: 'Monatsverlauf',
    colMonth: 'Monat',
    noRuns:
      'Noch keine Live-Läufe in diesem Zeitraum. Starten Sie einen Skill — jeder abgeschlossene Live-Lauf zahlt hier ein.',
    assumptions: (rate: string) =>
      `Annahme: eine gesparte Stunde ist ${rate} wert. Admins passen Stundensatz und Minuten pro Skill in den Einstellungen an.`,
    hours: (n: number) => `${n} h`,
  },

  onboarding: {
    title: 'Erste Schritte',
    doneCount: (done: number, total: number) => `${done}/${total} erledigt`,
    steps: {
      uploadTitle: 'Wissen hochladen',
      uploadHint:
        'PDF, DOCX, Markdown oder Text — daraus beantwortet helix Fragen mit Quellenangabe.',
      uploadCta: 'Zur Wissensbasis',
      chatTitle: 'Erste Frage stellen',
      chatHint:
        'Der Chat antwortet nur aus Ihrem geprüften Wissen — oder sagt ehrlich, dass er es nicht weiß.',
      chatCta: 'Zum Chat',
      skillTitle: 'Skill ausprobieren',
      skillHint:
        'Z. B. ein Angebot entwerfen — alles mit externer Wirkung wartet auf Ihre Freigabe.',
      skillCta: 'Zu den Skills',
      companyTitle: 'Firmendaten hinterlegen',
      companyHint:
        'Name, Anschrift, USt-IdNr., Bank — erscheinen als Briefkopf auf Angebots- und Rechnungs-PDFs.',
      companyCta: 'Zu den Einstellungen',
    },
  },

  knowledge: {
    intro:
      'Dokumente werden pro Organisation gechunkt, eingebettet und gespeichert — die Isolation erzwingt die Datenbank. Fragen beantwortet der',
    introChatLink: 'Chat',
    introSuffix: 'ausschließlich aus diesem Wissen.',
    uploadTitle: 'Dateien hochladen',
    uploadHint:
      'PDF, DOCX, Markdown und Text werden serverseitig extrahiert und durch dieselbe Chunking-/Embedding-Pipeline ingestiert. Gescannte PDFs ohne Textebene werden abgelehnt (OCR kommt später).',
    manualTitle: 'Text manuell anlegen',
    titleLabel: 'Titel',
    titlePlaceholder: 'z. B. Urlaubsrichtlinie 2026',
    textLabel: 'Text',
    textPlaceholder: 'Wissen hier einfügen…',
    visibilityLabel: 'Sichtbarkeit',
    visibilityOpen: 'open — alle Rollen',
    visibilityRestricted: 'restricted — nur berechtigte Rollen',
    visibilityConfidential: 'confidential — nur berechtigte Rollen',
    ingest: 'Ingestieren',
    documents: (n: number) => `Dokumente (${n})`,
    documentsTitle: 'Dokumente',
    entryCount: (n: number) => `${n} ${n === 1 ? 'Eintrag' : 'Einträge'}`,
    noDocuments: 'Noch keine Dokumente. Lege oben das erste an.',
    pages: (n: number) => `${n} Seiten`,
    words: (n: number) => `${n} Wörter`,
    chunks: 'Chunks',
    newVersion: 'Neue Version',
    newVersionTitle: 'Ersetzt den Inhalt dieses Dokuments (gleiche ID, alte Chunks weg)',
    newVersionAria: (title: string) => `Neue Version für ${title}`,
    deleteTitle: 'Dokument samt Chunks unwiderruflich löschen (auditiert)',
    upload: {
      dropzoneAria: 'Dateien hochladen',
      dropHere: 'Dateien hierher ziehen',
      orClick: 'oder klicken zum Auswählen',
      constraints: '.pdf, .docx, .md, .txt — mehrere Dateien möglich, max. 20 MB pro Datei, kein OCR',
      visibilityLabel: 'Sichtbarkeit für hochgeladene Dateien',
      waiting: 'wartet…',
      ingesting: 'wird ingestiert…',
      transferFailed: 'Übertragung fehlgeschlagen.',
    },
  },

  chat: {
    intro: 'Antworten kommen ausschließlich aus der',
    introKnowledgeLink: 'Wissensbasis',
    introSuffix:
      'dieser Organisation — mit Quellen. Ohne passendes Wissen sagt der Assistent das ehrlich.',
    feedbackSoFar: (up: number, down: number) => `Feedback bisher: ${up} 👍 / ${down} 👎`,
    empty: 'Noch keine Nachrichten. Stelle unten die erste Frage.',
    emptyTitle: 'Noch keine Nachrichten',
    emptyHint: 'Stelle unten die erste Frage — die Antwort kommt mit Quellenangaben.',
    rateAria: 'Antwort bewerten',
    helpful: 'Hilfreich',
    notHelpful: 'Nicht hilfreich',
    questionPlaceholder: 'z. B. Wie viele Urlaubstage haben wir?',
    questionAria: 'Frage',
    ask: 'Fragen',
    trace: {
      summary: 'Warum diese Antwort?',
      sourcesTitle: 'Verwendete Quellen',
      section: (n: number) => `Abschnitt ${n}`,
      relevanceHigh: 'hohe Relevanz',
      relevanceMedium: 'mittlere Relevanz',
      relevanceLow: 'geringe Relevanz',
      filtered: (n: number) =>
        n === 1
          ? '1 weiterer Treffer ist für Ihre Rolle nicht sichtbar.'
          : `${n} weitere Treffer sind für Ihre Rolle nicht sichtbar.`,
      noKnowledge:
        'Keine ausreichend relevanten Quellen gefunden — deshalb keine inhaltliche Antwort (die KI wurde nicht aufgerufen).',
      insufficient:
        'Es wurden Quellen gefunden, sie reichten aber nicht für eine belegte Antwort — der Assistent hat ehrlich abgelehnt.',
    },
  },

  skills: {
    intro:
      'Skills sind deklarierte Abläufe der Engine: lesende Schritte laufen frei, handelnde Schritte stehen hinter Guardrail und menschlicher Freigabe.',
    acts: 'handelt',
    readsOnly: 'liest nur',
    dryRun: {
      toggle: 'Probelauf — nichts wird ausgeführt',
      hint: 'Alle Schritte und Guardrail-Prüfungen laufen weiterhin; handelnde Schritte werden nur simuliert.',
    },
    guardrail: {
      policyAlways: 'Freigabe: immer erforderlich (Policy)',
      policyThreshold: (amount: string) => `Freigabe ab ${amount} (Policy)`,
      policyNeverMoney: 'Policy „nie" — bei Geld-Skills nicht abschaltbar, Guardrail greift',
      policyNever: 'Freigabe: keine (Policy)',
      receiptThreshold: (amount: string) => `Freigabe ab ${amount} (Guardrail)`,
      invoiceThreshold: (amount: string) => `Freigabe ab ${amount} Rechnungssumme (Guardrail)`,
      quoteAlways: 'Freigabe: immer — externe Kommunikation, unabhängig vom Betrag (Guardrail)',
      guardrailActive: 'Guardrail aktiv — Freigabe bei Auslösung',
      moneyAlways: 'Freigabe: immer erforderlich',
      noneNeeded: 'Keine Freigabe nötig',
    },
    forms: {
      description: 'Beschreibung',
      descriptionPlaceholder: 'z. B. Softwarelizenz Jahresvertrag',
      amountEur: 'Betrag (EUR)',
      amountPlaceholder: 'z. B. 1240,00',
      receiptNumber: 'Belegnummer (optional)',
      questionTopic: 'Frage / Thema',
      questionPlaceholder: 'z. B. Wie viele Urlaubstage gibt es?',
      customer: 'Kunde',
      customerPlaceholderQuote: 'z. B. Hanse Logistik GmbH',
      customerPlaceholderInvoice: 'z. B. Möbelwerk Nord GmbH',
      service: 'Leistung',
      servicePlaceholder: 'z. B. Projektunterstützung Q3',
      quoteAmountPlaceholder: 'z. B. 4800,00',
      recipientEmail: 'Empfänger-E-Mail (optional — leer = simulierter Versand)',
      emailPlaceholderQuote: 'z. B. einkauf@kunde.de',
      emailPlaceholderInvoice: 'z. B. buchhaltung@kunde.de',
      positions: 'Positionen (eine pro Zeile: Bezeichnung; Betrag)',
      positionsPlaceholder: 'Beratung März; 950\nWorkshoptag; 480',
      inputJson: 'Input (JSON)',
      clientSelect: 'Kunde (optional)',
      clientNone: '— keiner —',
    },
  },

  runs: {
    intro: 'Jede Skill-Ausführung mit Status und Betrag. Details inklusive Step-Timeline per Klick.',
    noRuns: 'Noch keine Ausführungen. Starte einen Skill unter',
    emptyTitle: 'Noch keine Ausführungen',
    emptyHintPrefix: 'Starte einen Skill unter',
    emptyHintSuffix: '— jeder Lauf erscheint hier mit Status und Schritt-Timeline.',
    startedAt: 'Gestartet am',
    simulation: 'Probelauf',
  },

  runDetail: {
    started: 'gestartet',
    stepDone: 'erledigt',
    stepFailed: 'fehlgeschlagen',
    stepPending: 'ausstehend',
    awaitingApproval: 'Wartet auf Freigabe:',
    toApprovalQueue: 'Zur Freigaben-Warteschlange →',
    steps: 'Schritte',
    notExecutedYet: 'noch nicht ausgeführt',
    approvals: 'Freigaben',
    decidedBy: 'entschieden von',
    decidedAt: 'am',
    result: 'Ergebnis',
    noResult: 'Noch kein Ergebnis — der Run ist nicht abgeschlossen.',
    simulation: {
      bannerTitle: 'Testlauf — nichts wurde ausgeführt',
      bannerBody:
        'Dies war ein Probelauf: alle Schritte und Guardrail-Prüfungen liefen, aber jeder handelnde Schritt wurde nur simuliert — nichts hat das System verlassen.',
      stepBadge: 'simuliert',
      wouldRequireApproval: 'Würde Freigabe erfordern:',
      wouldExecuteNote: 'Handelnder Schritt — simuliert, nicht ausgeführt.',
    },
  },

  approvals: {
    intro:
      'Handelnde Schritte, die auf eine menschliche Entscheidung warten. Die Rollen-Prüfung erzwingt der Server — nicht diese Seite.',
    empty: 'Keine wartenden Freigaben. Alles entschieden.',
    emptyTitle: 'Keine wartenden Freigaben',
    emptyHint: 'Alles entschieden — sobald ein Skill eine menschliche Freigabe braucht, erscheint sie hier.',
    decidedRecent: (n: number) => `letzte ${n}`,
    requestedAt: 'angefordert',
    run: 'Run',
    awaiting: 'wartet auf Freigabe',
    roleChip: (role: string) => `Rolle: ${role}`,
    reason: 'Grund:',
    decided: 'Entschieden',
    decidedBy: 'Entschieden von',
    decidedAt: 'Am',
    approve: 'Freigeben',
    reject: 'Ablehnen',
    confirmApprove: 'Diese Ausführung wirklich freigeben?',
    confirmReject: 'Diese Ausführung wirklich ablehnen?',
    requiresRole: (role: string) => `Benötigt Rolle: ${role}`,
  },

  audit: {
    note: 'Append-only — Einträge können nicht verändert oder gelöscht werden.',
    entryCount: (n: number) => `${n} Einträge`,
    forActor: (actor: string) => ` für Akteur ${actor}`,
    filterAll: 'alle',
    actorPlaceholder: 'Akteur, z. B. slack:U…',
    filter: 'Filtern',
    noEntries: 'Keine Einträge für diesen Filter.',
    event: 'Event',
    actor: 'Akteur',
    newer: '← neuere',
    older: 'ältere →',
    page: (page: number, total: number) => `Seite ${page} / ${total}`,
  },

  security: {
    intro:
      'Die Eigenschaften, die dieses System garantieren soll — und für jede: wie wir es belegen. Wir behaupten kein Zertifikat, sondern verweisen auf die überprüfbare Grundlage: eine Live-Abfrage gegen die laufende Datenbank, die automatisierte Testsuite oder die Architektur selbst.',
    honestyTitle: 'Wie diese Seite zu lesen ist',
    honestyBody:
      'Grün mit Punkt heißt: wir haben die laufende Datenbank gerade abgefragt und es gilt jetzt — und es hätte genauso rot sein können. Ein Stahl-Badge ohne Punkt heißt: die Eigenschaft ist durch die Tests oder die Architektur abgesichert, nicht durch eine momentane Prüfung. Wir zeigen niemals ein grünes Live-Signal für etwas, das wir nicht wirklich live geprüft haben.',
    basisLabel: 'Grundlage',
    statusLabel: 'Status',
    basis: {
      live: 'Live-Prüfung gegen die Datenbank',
      test: 'Durch die automatisierte Testsuite abgesichert',
      architecture: 'Durch die Architektur abgesichert',
    },
    chip: {
      liveVerified: 'Live geprüft',
      secured: 'Abgesichert',
      fail: 'Prüfung fehlgeschlagen',
      unknown: 'Jetzt nicht prüfbar',
    },
    proofTitle: 'Überprüfbare Grundlage',
    proofBody:
      'Diese Garantien sind keine Folien-Behauptung. Das Tenant-Isolation-Gate führt bei jedem Push und jedem Pull Request die komplette Testsuite als die am geringsten privilegierte Datenbankrolle aus; bricht die Isolation je, wird der Build rot.',
    proofTestCount: (n: number) => `${n} automatisierte Tests`,
    proofRepoNote: 'Der Code, die Tests und das CI-Gate liegen alle im Repository.',
    liveNote:
      'Die Live-Prüfungen lesen nur aggregierte Schema-Struktur (Tabellennamen, RLS-Flags, Existenz von Policies und Triggern) als der am geringsten privilegierte app_user. Sie lesen niemals einen Kundendatensatz, eine Inhaltszeile oder eine andere Organisation.',
    unknownHint:
      'Eine Live-Prüfung konnte gerade nicht laufen (z. B. war die Datenbank nicht erreichbar). Wir zeigen das an, statt ersatzweise auf Grün zu gehen.',
    props: {
      tenantIsolation: {
        title: 'Mandantentrennung',
        body: 'Jede Organisation sieht nur ihre eigenen Daten. Das erzwingt die Datenbank selbst mit Row-Level Security im FORCE-Modus auf allen Mandanten-Tabellen — nicht der Anwendungscode, der einen Fehler haben könnte.',
        evidenceLive: (secured: number, total: number) =>
          `${secured}/${total} Mandanten-Tabellen mit RLS + FORCE`,
        evidenceFail: (secured: number, total: number) =>
          `Nur ${secured}/${total} Mandanten-Tabellen haben RLS + FORCE — erwartet werden alle ${total}.`,
      },
      auditImmutability: {
        title: 'Manipulationssicheres Audit-Log',
        body: 'Das Audit-Log ist append-only. Es gibt keine Policy, die Ändern oder Löschen erlaubt, und zwei Datenbank-Trigger weisen jeden Versuch ab — selbst durch den Tabelleneigentümer. Historie lässt sich nicht heimlich umschreiben.',
        evidenceLive: 'Append-only: keine UPDATE/DELETE-Policy, beide Schutz-Trigger vorhanden',
        evidenceFail: 'Die Append-only-Garantie ist nicht intakt — eine UPDATE/DELETE-Policy oder ein fehlender Schutz-Trigger wurde gefunden.',
      },
      moneyFailsafe: {
        title: 'Geld-Failsafe',
        body: 'Ein Skill, der Geld anfasst, kann niemals ohne menschliche Entscheidung handeln — erzwungen beim Schreiben einer Policy und erneut zur Laufzeit (Defense in Depth). Ein Geld-Skill kann nicht auf „nie Freigabe nötig" gestellt werden: diese Einstellung wird zur Laufzeit überstimmt und ins Audit-Log geschrieben.',
        evidence: (n: number) =>
          `${n} geldberührende ${n === 1 ? 'Skill' : 'Skills'}, jeder abgesichert oder fail-closed`,
        basisDetail: 'Festgehalten durch die Policy-, Engine- und Skill-Effekt-Tests.',
      },
      antiHallucination: {
        title: 'Anti-Halluzination',
        body: 'Unter der Relevanzschwelle wird das Sprachmodell nie aufgerufen — das System sagt, dass es etwas nicht weiß, statt eine Antwort zu erfinden. Jede Antwort trägt nur ihre zitierten Quellen.',
        evidence: (threshold: number) => `Relevanzschwelle: ${threshold}`,
        basisDetail: 'In die Retrieval-Pipeline eingebaut; durch die Answer-Trace-Tests abgedeckt.',
      },
      euDataResidency: {
        title: 'EU-Datenhaltung',
        body: 'Daten liegen in Postgres in der EU (Neon, Frankfurt). Kundendaten werden nicht zum Training von Modellen verwendet. Das ist eine Deployment- und Vertrags-Tatsache — klar benannt, nicht als Live-Prüfung dargestellt.',
        evidence: 'Postgres in der EU · kein Training auf Kundendaten',
      },
    },
  },

  settings: {
    intro:
      'Governance der Organisation: Wann braucht ein Skill eine menschliche Freigabe, welche Rolle sieht welches Wissen, wer hat welche Rolle. Jede Änderung landet im',
    introAuditLink: 'Audit',
    tabsAria: 'Einstellungen',
    tabs: {
      approvals: 'Freigabe-Regeln',
      visibility: 'Wissens-Sichtbarkeit',
      members: 'Mitglieder & Rollen',
      clients: 'Kunden',
      governance: 'Governance-Vorlagen',
      company: 'Firmendaten',
      value: 'Wert-Annahmen',
      slack: 'Slack',
      language: 'Sprache',
      data: 'Daten & Löschung',
    },
    governance: {
      presetsTitle: 'Branchen-Presets',
      presetsHint:
        'Ein Klick setzt sinnvolle Defaults für Freigabe-Regeln und Wissens-Sichtbarkeit — statt jede Regel einzeln zu konfigurieren. Alles bleibt danach in den anderen Tabs anpassbar.',
      presetNames: {
        kanzlei: 'Kanzlei / Steuerberatung',
        gesundheitswesen: 'Gesundheitswesen',
        handwerk: 'Handwerk / KMU',
      } as Record<string, string>,
      presetDescriptions: {
        kanzlei:
          'Strenge Freigaben mit Vier-Augen bei Geld: Belege ab 50 €, jede Rechnung braucht einen Admin, Angebote einen Lead. Member sehen nur offene Dokumente; vertraulich bleibt Admin-only.',
        gesundheitswesen:
          'Maximal strikt: Jeder Skill-Lauf braucht eine Admin-Freigabe, alles jenseits offener Dokumente ist Admin-only — personenbezogene Daten bleiben unter Verschluss.',
        handwerk:
          'Pragmatisch: Leads geben Belege ab 250 € und Rechnungen ab 1.000 € frei, Angebote gehen ohne Pause raus. Breiter Wissenszugriff — Geld-Skills bleiben abgesichert.',
      } as Record<string, string>,
      applyCta: 'Preset anwenden',
      confirmOverwrite:
        'Ich verstehe: Das überschreibt die bestehenden Freigabe-Regeln und die Sichtbarkeits-Matrix.',
      moneyFailsafeNote:
        'Kein Preset und kein Import kann Freigaben für Geld-Skills abschalten — solche Konfigurationen werden fail-closed korrigiert und auditiert.',
      exportTitle: 'Governance exportieren',
      exportHint:
        'Lädt die aktuellen Freigabe-Regeln und die Sichtbarkeits-Matrix als JSON herunter — portabel, ohne Secrets, ohne Org-Kennungen. Dieselbe Datei lässt sich hier oder in einer anderen Organisation importieren.',
      exportCta: 'JSON herunterladen',
      importTitle: 'Governance importieren',
      importHint:
        'Exportiertes JSON einfügen (oder Datei wählen). Es wird zuerst validiert — Struktur, Wertebereiche und der Geld-Failsafe — und dann in einer Transaktion angewendet.',
      importPlaceholder: '{"format":"helix-governance","version":1,…}',
      importFileLabel: 'oder Datei wählen:',
      importCta: 'Validieren & anwenden',
      appliesTo: (policies: number, grants: number) =>
        `${policies} Freigabe-Regeln · ${grants} Sichtbarkeits-Grants`,
    },
    notifyTitle: 'Benachrichtigung bei wartenden Freigaben',
    notifyHint:
      'Sobald ein Skill-Lauf pausiert und auf Freigabe wartet, geht eine kurze E-Mail an diese Adresse (z. B. ein Team-Alias). Leer = keine Benachrichtigung. Der Versand ist best-effort — die Freigabe selbst funktioniert immer auch ohne Mail.',
    notifyPlaceholder: 'z. B. freigaben@firma.de',
    policiesTitle: 'Freigabe-Regeln pro Skill',
    policiesFailsafe:
      'Freigabe kann bei geldbewegenden Skills nicht abgeschaltet werden — Modus „nie" wird von der Engine zur Laufzeit überstimmt und auditiert.',
    failsafeChip: 'Failsafe',
    currentRule: 'Aktuelle Regel',
    mode: 'Modus',
    threshold: 'Schwelle (EUR)',
    approverRole: 'Freigeber-Rolle',
    movesMoney: 'bewegt Geld',
    movesMoneyTitle: 'Freigabe kann bei geldbewegenden Skills nicht abgeschaltet werden',
    ruleFrom: (amount: string) => `ab ${amount}`,
    ruleAlways: 'immer',
    ruleNeverFailsafe: 'nie (Failsafe greift)',
    ruleNever: 'nie',
    ruleNoPolicy: 'keine Policy — Skill-Guardrail gilt',
    modeAlways: 'immer',
    modeThreshold: 'ab Schwelle',
    modeNever: 'nie',
    thresholdPlaceholder: 'z. B. 5000',
    visibilityLevelsTitle: 'Die drei Sichtbarkeits-Stufen',
    levelOpen: 'Alle Rollen sehen diese Dokumente — keine Berechtigung nötig.',
    levelRestricted:
      'Nur Rollen mit explizitem Grant. Ohne Grant ist das Dokument in Chat/Retrieval unsichtbar (fail-closed).',
    levelConfidential:
      'Höchste Stufe — ebenfalls nur per Grant. Auch Admins brauchen einen Grant, sonst sehen sie nichts.',
    grantsTitle: 'Wer darf welche Stufe sehen?',
    grantsHint: '„open" braucht keinen Grant. Kein Haken = Rolle sieht die Stufe nicht (fail-closed).',
    level: 'Stufe',
    grantAria: (level: string, role: string) => `${level} für ${role}`,
    saveGrants: 'Grants speichern',
    documentsLevelTitle: 'Dokumente & ihre Stufe',
    documentsLevelHint: 'Die Stufe eines Dokuments änderst du in der',
    documentsLevelLink: 'Wissensbasis',
    noDocuments: 'Noch keine Dokumente.',
    membersTitle: (n: number) => `Mitglieder (${n})`,
    membersHeading: 'Mitglieder',
    membersTotal: (n: number) => `${n} gesamt`,
    membersHint:
      'Mindestens ein Admin bleibt immer bestehen — die letzte Admin-Rolle lässt sich nicht entziehen. Jede Änderung wird auditiert.',
    memberId: 'Kennung',
    changeRole: 'Rolle ändern',
    lastAdmin: 'letzter Admin',
    ownerManual: 'Owner wird nur manuell vergeben',
    companyTitle: 'Firmendaten',
    companyHint:
      'Briefkopf und Fußzeile der erzeugten Angebots- und Rechnungs-PDFs. Alle Felder sind optional — leere Felder erscheinen schlicht nicht im Dokument. Jede Änderung wird auditiert.',
    companyName: 'Firmenname',
    companyNamePlaceholder: 'z. B. Hephaistos Systems GmbH',
    companyAddress: 'Anschrift',
    companyAddressPlaceholder: 'Musterstraße 1\n20095 Hamburg',
    companyVatId: 'USt-IdNr.',
    companyVatIdPlaceholder: 'z. B. DE123456789',
    companyBank: 'Bankverbindung',
    companyBankPlaceholder: 'Musterbank\nIBAN: DE00 0000 0000 0000 0000 00\nBIC: XXXXDEXX',
    clientsTitle: 'Kunden',
    clientsHeading: 'Kunden',
    clientsTotal: (n: number) => `${n} gesamt`,
    clientsHint:
      'Verwalten Sie die Kunden Ihrer Organisation. Skill-Läufe können einem Kunden zugeordnet werden. Jede Änderung wird auditiert.',
    clientName: 'Name',
    clientNamePlaceholder: 'z. B. Hanse Logistik GmbH',
    clientNotes: 'Notizen (optional)',
    clientNotesPlaceholder: 'Kurzbeschreibung oder Kontaktdaten',
    addClient: 'Kunde hinzufügen',
    editClient: 'Bearbeiten',
    saveClient: 'Speichern',
    noClients: 'Noch keine Kunden. Legen Sie den ersten oben an.',
    valueTitle: 'Wert-Annahmen (Wertbeitrag-Dashboard)',
    valueHint:
      'So rechnet das Wertbeitrag-Dashboard abgeschlossene Live-Läufe in Stunden und Dollar um: gesparte Minuten pro erfolgreichem Lauf × Stundensatz. Annahmen, keine Messwerte — jede Änderung wird auditiert. Probeläufe zählen nie.',
    valueHourlyRate: 'Stundensatz (USD)',
    valueMinutesTitle: 'Gesparte Minuten pro erfolgreichem Lauf',
    valueMinutes: 'Minuten / Lauf',
    valueDefaultChip: 'Standard',
    slackTitle: 'Slack-Verbindung',
    slackHint:
      'Ein Slack-Workspace (Team) wird auf genau eine Organisation gemappt. Anfragen aus nicht gemappten Workspaces werden abgewiesen. MVP: die Team-ID wird manuell eingetragen — ein OAuth-Install-Flow ist ein späterer Schritt. Der Bot-Token bleibt in .env (SLACK_BOT_TOKEN); die Datenbank speichert nur einen Verweis, nie das Secret.',
    slackConnected: 'verbunden',
    slackTeam: 'Team',
    slackNotConnected: 'nicht verbunden',
    slackOauthCta: 'Mit Slack verbinden (OAuth)',
    slackManualHint: 'oder manuell per Team-ID:',
    slackTeamIdPlaceholder: 'Slack-Team-ID, z. B. T0123456789',
    slackConnect: 'Workspace verbinden',
    slackLinksTitle: (n: number) => `Slack-Nutzer ↔ Mitglieder (${n})`,
    slackLinksHeading: 'Slack-Nutzer ↔ Mitglieder',
    slackLinkedCount: (n: number) => `${n} verknüpft`,
    slackLinksHint:
      'Nur verknüpfte Slack-Nutzer handeln mit ihrer Mitglieds-Rolle (Skills starten, Freigaben erteilen). Unverknüpfte Nutzer sehen ausschließlich „open"-Wissen und können nichts auslösen (fail-closed).',
    slackUserId: 'Slack-User-ID',
    member: 'Mitglied',
    unlink: 'Entknüpfen',
    slackUserIdPlaceholder: 'z. B. U0123456789',
    link: 'Verknüpfen',
    languageTitle: 'Sprache',
    uiLanguageTitle: 'Oberflächensprache',
    uiLanguageHint:
      'Gilt nur für diesen Browser (als Cookie gespeichert). Jedes Mitglied wählt seine eigene Oberflächensprache.',
    uiLanguageLabel: 'Oberflächensprache',
    orgLanguageTitle: 'Organisationssprache',
    orgLanguageHint:
      'Sprache org-weiter Ausgaben: erzeugte Angebots-/Rechnungs-PDFs und ausgehende E-Mails (z. B. Freigabe-Benachrichtigungen). Admin-Einstellung, auditiert.',
    orgLanguageLabel: 'Organisationssprache',
    languageEnglish: 'Englisch (English)',
    languageGerman: 'Deutsch',
    exportTitle: 'Datenexport (Art. 20 DSGVO)',
    exportHint:
      'Vollständiger Export aller Daten dieser Organisation als JSON (Dokumente, Chunks ohne Embeddings, Chat, Runs, Policies, Slack-Mappings, Audit-Trail). Der Export läuft durch withTenant — er kann strukturell nur die eigene Organisation enthalten. Jeder Export wird auditiert.',
    exportCta: 'Export herunterladen',
    retentionTitle: 'Chat-Aufbewahrung',
    retentionAutoHint:
      'Automatisch: Nachrichten älter als N Tage werden nach Chat-Aktivität automatisch gelöscht (leer = unbegrenzt aufbewahren). Jede automatische Löschung wird auditiert.',
    retentionUnlimited: 'unbegrenzt',
    retentionDaysAuto: 'Tage aufbewahren (automatisch)',
    retentionOnceHint:
      'Einmalig: Löscht Chat-Nachrichten, die älter als die angegebene Anzahl Tage sind (0 = alles). Auditiert mit Anzahl.',
    retentionDays: 'Tage aufbewahren',
    purgeCta: 'Ältere Nachrichten löschen',
    eraseTitle: 'Organisation unwiderruflich löschen',
    eraseHint:
      'Löscht diese Organisation vollständig — inklusive Wissensbasis, Runs, Slack-Mappings und Audit-Trail (Tenant-Offboarding, Art. 17). Vorher exportieren! Der Löschnachweis (Zeilenzahlen pro Tabelle) wird serverseitig protokolliert. Zur Bestätigung den exakten Namen der Organisation eintippen.',
    erasePlaceholder: 'Exakter Organisationsname',
    eraseCta: 'Organisation löschen',
  },

  selectOrg: {
    title: 'Organisation wählen',
    hint: 'helix ist mandantenfähig. Wähle eine Organisation oder lege eine neue an.',
  },

  landing: {
    heroTitle: 'Die DSGVO-native KI-Plattform für den Mittelstand',
    heroText:
      'helix beantwortet Fragen aus Ihrem Firmenwissen mit Quellenangabe und erledigt Aufgaben mit eingebauter menschlicher Freigabe — mandantengetrennt auf Datenbank-Ebene, jede Handlung im Audit-Trail.',
    ctaStart: 'Kostenlos starten',
    ctaSignIn: 'Anmelden',
    features: [
      {
        title: 'Mandantentrennung per Datenbank',
        text: 'Tenant-Isolation erzwingt PostgreSQL Row-Level Security mit FORCE — nicht App-Code-Disziplin. Ein vergessenes WHERE kann strukturell keine fremden Daten leaken.',
      },
      {
        title: 'Wissensbasis mit belegten Antworten',
        text: 'PDF, DOCX, Markdown und Text (inkl. OCR für Scans) werden semantisch durchsuchbar. Der Chat antwortet mit Quellenangabe — oder sagt ehrlich, dass er es nicht weiß.',
      },
      {
        title: 'Skills mit menschlicher Freigabe',
        text: 'Angebote, Rechnungen, Kontierung: Alles, was Geld bewegt oder das Haus verlässt, pausiert für eine menschliche Freigabe — nicht abschaltbar, lückenlos auditiert.',
      },
      {
        title: 'DSGVO eingebaut, nicht angeflanscht',
        text: 'Datenexport (Art. 20), Löschkonzept mit Nachweis, Pseudonymisierung im Audit-Trail, automatische Aufbewahrungsfristen. EU-Datenbankstandort.',
      },
    ],
  },

  publicShell: {
    signIn: 'Anmelden',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    dpa: 'AV-Vertrag',
  },

  skillTitles: {
    beleg_kontieren: 'Beleg kontieren und verbuchen',
    wissen_zusammenfassen: 'Wissen zusammenfassen',
    angebot_erstellen: 'Kundenangebot erstellen und versenden',
    rechnung_erstellen: 'Rechnung erstellen und buchen',
  } as Record<string, string>,
};
