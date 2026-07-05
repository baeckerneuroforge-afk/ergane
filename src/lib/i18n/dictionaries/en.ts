// English dictionary — the SOURCE OF TRUTH for the dictionary shape.
// German (de.ts) is typed against `Dictionary`, so a missing or extra key
// fails the typecheck. Interpolations are plain functions — no template DSL.

export const en = {
  nav: {
    cockpit: 'Cockpit',
    overview: 'Overview',
    knowledge: 'Knowledge Base',
    chat: 'Chat',
    skills: 'Skills',
    runs: 'Runs',
    deliverables: 'Deliverables',
    clients: 'Clients',
    approvals: 'Approvals',
    value: 'Value',
    audit: 'Audit',
    flags: 'Loop & Flags',
    connectors: 'Connectors',
    security: 'Security',
    settings: 'Settings',
    runDetail: 'Run',
    clientDetail: 'Client',
    sections: {
      work: 'Work',
      knowledge: 'Knowledge',
      control: 'Control',
    },
    subtitles: {
      cockpit: 'What needs your attention — clients, approvals, flags',
      overview: "Your organization's key figures and activity at a glance",
      chat: 'Ask your verified knowledge — answers with sources',
      knowledge: "The organization's documents — visibility included",
      skills: 'Start workflows — guardrails and approvals included',
      runs: 'Every run with status, steps and result',
      deliverables: 'Persistent artifacts from skill runs — versioned and linked to clients',
      clients: 'Your clients — activity, deliverables and history',
      approvals: 'Acting steps waiting for a human decision',
      value: 'What automation saves — hours and dollars, from live runs only',
      audit: 'Append-only log — nothing is changed or deleted',
      flags: 'Deviations and warnings from the closed loop',
      connectors: 'Connected tools — sync status and configuration',
      security: 'What is structurally secured — and how we can prove it',
      settings: 'Approval rules, visibility, roles, Slack, GDPR',
      runDetail: 'Step timeline, approvals and result of this run',
      clientDetail: 'Client details — runs, deliverables and history',
    },
  },

  common: {
    save: 'Save',
    change: 'Change',
    delete: 'Delete',
    execute: 'Run',
    expand: 'expand',
    none: '—',
    role: 'Role',
    skill: 'Skill',
    status: 'Status',
    amount: 'Amount',
    title: 'Title',
    date: 'Date',
    time: 'Time',
    detail: 'Detail',
    visibility: 'Visibility',
    format: 'Format',
    filter: 'Filter',
  },

  status: {
    run: {
      running: 'running',
      awaiting_approval: 'awaiting approval',
      approved: 'approved',
      rejected: 'rejected',
      completed: 'completed',
      failed: 'failed',
    },
    approval: {
      pending: 'pending',
      approved: 'approved',
      rejected: 'rejected',
    },
    actor: { human: 'Human', agent: 'Agent' },
    mode: { live: 'Live', simulation: 'Dry run' },
  },

  overview: {
    kpiDocuments: 'Knowledge entries',
    kpiSkills: 'Skills available',
    kpiRuns7d: 'Runs (7 days)',
    kpiPendingApprovals: 'Pending approvals',
    kpiValue30d: 'Value created (30 days)',
    recentActivity: 'Recent activity',
    fullAudit: 'Full audit →',
    bannerWaiting: (n: number) => (n === 1 ? `${n} run is waiting` : `${n} runs are waiting`),
    bannerSuffix: 'for a human approval.',
    bannerCta: 'Decide now →',
    quickAskTitle: 'Ask a question',
    quickAskHint: 'Answers from the verified knowledge — always with sources.',
    quickUploadTitle: 'Upload knowledge',
    quickUploadHint: 'Ingest PDF, DOCX, Markdown or text and control visibility.',
    quickSkillTitle: 'Start a skill',
    quickSkillHint: 'Run automations — guardrails included.',
    noActivity:
      'No entries yet. Activity appears here as soon as knowledge is ingested or a skill is run.',
    quickSkillsHint: 'Start automations — guardrails included.',
    quickKnowledgeHint: 'Ingest documents and control visibility.',
    quickChatHint: 'Ask your verified knowledge — answers with sources.',
  },

  cockpit: {
    attentionTitle: 'Needs your attention',
    pendingApprovals: (n: number) => (n === 1 ? `${n} approval waiting` : `${n} approvals waiting`),
    activeClients: 'Active clients',
    deliverables30d: 'Deliverables (30d)',
    value30d: 'Value created (30d)',
    clientsTitle: 'Recent by client',
    allClients: 'All clients →',
    noClients: 'No clients yet. Add clients in the',
    noClientsLink: 'settings',
    noClientsOrActivity: 'to see activity grouped by client here.',
    lastRun: 'Last run',
    openDeliverables: (n: number) => (n === 1 ? '1 deliverable' : `${n} deliverables`),
    noRuns: 'no runs yet',
    flagsTitle: 'Loop & Flags',
    noFlags: 'No deviations — the loop reports here when something drifts from target.',
    flagsCount: (n: number) => (n === 1 ? '1 flag' : `${n} flags`),
    flagsWindow: 'in the last 7 days',
    flagsLast: 'Most recent',
    flagsAll: 'All flags →',
    waitingTitle: 'Waiting for you',
    noWaiting: 'Nothing waiting — all approvals are decided.',
    waitingRun: 'Run',
    waitingSince: 'since',
    decideNow: 'Decide →',
  },

  clients: {
    title: 'Clients',
    intro: 'Your clients — with linked runs, deliverables and activity. Manage client data in the',
    introSettingsLink: 'settings',
    noClients: 'No clients yet. Add the first one in the',
    noClientsLink: 'settings',
    colName: 'Name',
    colRuns: 'Runs',
    colDeliverables: 'Deliverables',
    colLastActivity: 'Last activity',
    detail: 'View →',
    runsTitle: 'Runs',
    deliverablesTitle: 'Deliverables',
    noRuns: 'No runs linked to this client yet.',
    noDeliverables: 'No deliverables for this client yet.',
    notes: 'Notes',
  },

  comingSoon: {
    title: 'Coming soon',
    connectors: 'This is where connected tools will be managed — OAuth installs, sync status and configuration. The connector architecture is planned; this view will go live with the first integration.',
  },

  flags: {
    // Honest framing: a flag is an append-only audit entry, never mutated.
    note: 'What the loop flagged: acceptance-criteria violations on deliverables and process-metric deviations. Append-only — entries are never changed or deleted.',
    entryCount: (n: number) => (n === 1 ? '1 flag' : `${n} flags`),
    emptyTitle: 'No deviations',
    emptyBody:
      'The loop reports here when a deliverable misses its acceptance criteria or a process metric drifts from target. Nothing has been flagged for this filter.',
    // Table headers.
    time: 'Time',
    flag: 'Flag',
    severity: 'Severity',
    deviation: 'Deviation',
    source: 'Source',
    // Category labels (detail.category → what kind of check fired).
    category: {
      criteria: 'Acceptance criteria',
      metric: 'Process metric',
      other: 'Flag',
    },
    // Severity labels (detail.severity).
    severityLabel: {
      critical: 'critical',
      warning: 'warning',
      info: 'info',
    },
    // Expected (Soll) vs actual (Ist) for one deviation.
    expected: 'target',
    actual: 'actual',
    // How many criteria failed, when a flag bundles several.
    moreDeviations: (n: number) => (n === 1 ? '+1 more' : `+${n} more`),
    deviationCount: (n: number) => (n === 1 ? '1 criterion' : `${n} criteria`),
    // Links from a flag to its origin.
    viewRun: 'Open run →',
    viewArtifact: 'Open deliverable →',
    // The correction proposal (autonomy 'suggest'/'autonomous'), when present.
    suggested: 'Suggested',
  },

  value: {
    intro:
      'The automation score: what your live skill runs save in hours and dollars. Counts LIVE runs only — dry runs (simulations) never appear here. The assumptions per skill are editable in the',
    introSettingsLink: 'settings',
    periodAria: 'Period',
    periodDays: (n: number) => `Last ${n} days`,
    kpiRuns: 'Live runs',
    kpiSuccessRate: 'Success rate',
    kpiSavedHours: 'Hours saved',
    kpiSavedValue: 'Value created',
    successRateHint: (completed: number, decided: number) =>
      `${completed} of ${decided} decided runs completed`,
    noDecidedRuns: 'no decided runs yet',
    perSkillTitle: 'By skill',
    perSkillHint:
      'Value accrues only for completed live runs: minutes saved per run × hourly rate.',
    colRuns: 'Runs',
    colCompleted: 'Completed',
    colSavedHours: 'Hours saved',
    colSavedValue: 'Value',
    monthlyTitle: 'Monthly trend',
    colMonth: 'Month',
    noRuns: 'No live runs in this period yet. Start a skill — every completed live run adds value here.',
    assumptions: (rate: string) =>
      `Assumption: one saved hour is worth ${rate}. Admins can adjust rate and minutes per skill in the settings.`,
    hours: (n: number) => `${n} h`,
    chartTitle: 'Value over time',
    chartBarLabel: 'Value',
    chartLineLabel: 'Runs',
  },

  onboarding: {
    title: 'Getting started',
    doneCount: (done: number, total: number) => `${done}/${total} done`,
    steps: {
      uploadTitle: 'Upload knowledge',
      uploadHint:
        'PDF, DOCX, Markdown or text — helix answers questions from it, with sources.',
      uploadCta: 'Go to knowledge base',
      chatTitle: 'Ask your first question',
      chatHint:
        'The chat answers only from your verified knowledge — or honestly says it does not know.',
      chatCta: 'Go to chat',
      skillTitle: 'Try a skill',
      skillHint:
        'E.g. draft a quote — anything with external effect waits for your approval.',
      skillCta: 'Go to skills',
      companyTitle: 'Add company details',
      companyHint:
        'Name, address, VAT ID, bank details — shown as the letterhead on quote and invoice PDFs.',
      companyCta: 'Go to settings',
    },
  },

  knowledge: {
    intro:
      'Documents are chunked, embedded and stored per organization — isolation is enforced by the database. Questions are answered by the',
    introChatLink: 'chat',
    introSuffix: 'exclusively from this knowledge.',
    uploadTitle: 'Upload files',
    uploadHint:
      'PDF, DOCX, Markdown and text are extracted server-side and ingested through the same chunking/embedding pipeline. Scanned PDFs without a text layer are rejected (OCR comes later).',
    manualTitle: 'Add text manually',
    titleLabel: 'Title',
    titlePlaceholder: 'e.g. Vacation policy 2026',
    textLabel: 'Text',
    textPlaceholder: 'Paste knowledge here…',
    visibilityLabel: 'Visibility',
    visibilityOpen: 'open — all roles',
    visibilityRestricted: 'restricted — authorized roles only',
    visibilityConfidential: 'confidential — authorized roles only',
    ingest: 'Ingest',
    documents: (n: number) => `Documents (${n})`,
    documentsTitle: 'Documents',
    entryCount: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`,
    noDocuments: 'No documents yet. Add the first one above.',
    pages: (n: number) => `${n} pages`,
    words: (n: number) => `${n} words`,
    chunks: 'Chunks',
    newVersion: 'New version',
    newVersionTitle: 'Replaces the content of this document (same id, old chunks removed)',
    newVersionAria: (title: string) => `New version for ${title}`,
    deleteTitle: 'Irreversibly delete the document including its chunks (audited)',
    upload: {
      dropzoneAria: 'Upload files',
      dropHere: 'Drag files here',
      orClick: 'or click to choose',
      constraints: '.pdf, .docx, .md, .txt — multiple files allowed, max 20 MB each, no OCR',
      visibilityLabel: 'Visibility for uploaded files',
      waiting: 'waiting…',
      ingesting: 'ingesting…',
      transferFailed: 'Transfer failed.',
    },
  },

  chat: {
    intro: 'Answers come exclusively from the',
    introKnowledgeLink: 'knowledge base',
    introSuffix:
      "of this organization — with sources. Without matching knowledge the assistant says so honestly.",
    feedbackSoFar: (up: number, down: number) => `Feedback so far: ${up} 👍 / ${down} 👎`,
    empty: 'No messages yet. Ask the first question below.',
    emptyTitle: 'No messages yet',
    emptyHint: 'Ask the first question below — the answer comes with sources.',
    rateAria: 'Rate the answer',
    helpful: 'Helpful',
    notHelpful: 'Not helpful',
    questionPlaceholder: 'e.g. How many vacation days do we have?',
    questionAria: 'Question',
    ask: 'Ask',
    // Live send feedback (chat-conversation.tsx): optimistic bubble + pending state.
    sending: 'Sending…',
    thinking: 'helix is thinking',
    thinkingAria: 'helix is preparing an answer',
    sendError: 'Answer failed. Please try again.',
    trace: {
      summary: 'Why this answer?',
      sourcesTitle: 'Sources used',
      section: (n: number) => `Section ${n}`,
      relevanceHigh: 'high relevance',
      relevanceMedium: 'medium relevance',
      relevanceLow: 'low relevance',
      filtered: (n: number) =>
        n === 1
          ? '1 further match is not visible for your role.'
          : `${n} further matches are not visible for your role.`,
      noKnowledge:
        'No sufficiently relevant sources were found — that is why there was no substantive answer (the AI was not called).',
      insufficient:
        'Sources were found, but they did not sufficiently support an answer — so the assistant honestly declined.',
    },
  },

  skills: {
    intro:
      'Skills are declared workflows of the engine: reading steps run freely, acting steps sit behind a guardrail and human approval.',
    acts: 'acts',
    readsOnly: 'reads only',
    dryRun: {
      toggle: 'Dry run — nothing is executed',
      hint: 'All steps and guardrail checks still run; acting steps are only simulated.',
    },
    guardrail: {
      policyAlways: 'Approval: always required (policy)',
      policyThreshold: (amount: string) => `Approval from ${amount} (policy)`,
      policyNeverMoney: 'Policy "never" — cannot be disabled for money skills, guardrail applies',
      policyNever: 'Approval: none (policy)',
      receiptThreshold: (amount: string) => `Approval from ${amount} (guardrail)`,
      invoiceThreshold: (amount: string) => `Approval from ${amount} invoice total (guardrail)`,
      quoteAlways: 'Approval: always — external communication, regardless of amount (guardrail)',
      guardrailActive: 'Guardrail active — approval when triggered',
      moneyAlways: 'Approval: always required',
      noneNeeded: 'No approval needed',
    },
    forms: {
      description: 'Description',
      descriptionPlaceholder: 'e.g. software license, annual contract',
      amountEur: 'Amount (EUR)',
      amountPlaceholder: 'e.g. 1240.00',
      receiptNumber: 'Receipt number (optional)',
      questionTopic: 'Question / topic',
      questionPlaceholder: 'e.g. How many vacation days are there?',
      customer: 'Customer',
      customerPlaceholderQuote: 'e.g. Hanse Logistik GmbH',
      customerPlaceholderInvoice: 'e.g. Möbelwerk Nord GmbH',
      service: 'Service',
      servicePlaceholder: 'e.g. project support Q3',
      quoteAmountPlaceholder: 'e.g. 4800.00',
      recipientEmail: 'Recipient e-mail (optional — empty = simulated sending)',
      emailPlaceholderQuote: 'e.g. purchasing@customer.com',
      emailPlaceholderInvoice: 'e.g. accounting@customer.com',
      positions: 'Line items (one per line: description; amount)',
      positionsPlaceholder: 'Consulting March; 950\nWorkshop day; 480',
      inputJson: 'Input (JSON)',
      clientSelect: 'Client (optional)',
      clientNone: '— none —',
    },
  },

  runs: {
    intro: 'Every skill run with status and amount. Click through for details including the step timeline.',
    noRuns: 'No runs yet. Start a skill under',
    emptyTitle: 'No runs yet',
    emptyHintPrefix: 'Start a skill under',
    emptyHintSuffix: '— every run appears here with its status and step timeline.',
    startedAt: 'Started at',
    simulation: 'Dry run',
  },

  runDetail: {
    started: 'started',
    stepDone: 'done',
    stepFailed: 'failed',
    stepPending: 'pending',
    awaitingApproval: 'Awaiting approval:',
    toApprovalQueue: 'To the approval queue →',
    steps: 'Steps',
    notExecutedYet: 'not executed yet',
    approvals: 'Approvals',
    decidedBy: 'decided by',
    decidedAt: 'at',
    result: 'Result',
    noResult: 'No result yet — the run has not completed.',
    simulation: {
      bannerTitle: 'Dry run — nothing was executed',
      bannerBody:
        'This was a simulation: all steps and guardrail checks ran, but every acting step was only simulated — nothing left the system.',
      stepBadge: 'simulated',
      wouldRequireApproval: 'Would require approval:',
      wouldExecuteNote: 'Acting step — simulated, not executed.',
    },
  },

  approvals: {
    intro:
      'Acting steps waiting for a human decision. The role check is enforced by the server — not by this page.',
    empty: 'No pending approvals. Everything decided.',
    emptyTitle: 'No pending approvals',
    emptyHint: 'Everything decided — as soon as a skill needs a human approval, it appears here.',
    decidedRecent: (n: number) => `last ${n}`,
    requestedAt: 'requested',
    run: 'Run',
    awaiting: 'awaiting approval',
    roleChip: (role: string) => `Role: ${role}`,
    reason: 'Reason:',
    decided: 'Decided',
    decidedBy: 'Decided by',
    decidedAt: 'At',
    approve: 'Approve',
    reject: 'Reject',
    confirmApprove: 'Really approve this run?',
    confirmReject: 'Really reject this run?',
    requiresRole: (role: string) => `Requires role: ${role}`,
  },

  audit: {
    note: 'Append-only — entries can never be changed or deleted.',
    entryCount: (n: number) => `${n} entries`,
    forActor: (actor: string) => ` for actor ${actor}`,
    filterAll: 'all',
    actorPlaceholder: 'Actor, e.g. slack:U…',
    filter: 'Filter',
    noEntries: 'No entries for this filter.',
    event: 'Event',
    actor: 'Actor',
    newer: '← newer',
    older: 'older →',
    page: (page: number, total: number) => `Page ${page} / ${total}`,
  },

  security: {
    intro:
      "The properties this system is built to guarantee — and, for each, how we can prove it. We don't claim a certificate; we point at the verifiable basis: a live query against the running database, the automated test suite, or the architecture itself.",
    // The honesty banner — states the rule the whole page follows.
    honestyTitle: 'How to read this page',
    honestyBody:
      'Green with a dot means we just queried the live database and it holds right now — and it could equally have come back red. A steel badge without a dot means the property is secured by the test suite or the architecture, not by a momentary check. We never show a live green light for something we did not actually verify live.',
    // Column-ish labels used inside each property card.
    basisLabel: 'Basis',
    statusLabel: 'Status',
    basis: {
      live: 'Live check against the database',
      test: 'Secured by the automated test suite',
      architecture: 'Secured by the architecture',
    },
    chip: {
      liveVerified: 'Verified live',
      secured: 'Secured',
      fail: 'Check failed',
      unknown: 'Not verifiable now',
    },
    // The verifiable-basis footer.
    proofTitle: 'Verifiable basis',
    proofBody:
      'These guarantees are not a claim on a slide. The tenant-isolation gate runs the full test suite as the least-privileged database role on every push and pull request; if isolation ever breaks, the build turns red.',
    proofTestCount: (n: number) => `${n} automated tests`,
    proofRepoNote: 'The code, the tests and the CI gate are all in the repository.',
    liveNote:
      'The live checks read only aggregated schema structure (table names, RLS flags, policy and trigger existence) as the least-privileged app_user. They never read a customer record, a row of content, or another organization.',
    unknownHint:
      'A live check could not run right now (for example, the database was unreachable). We show this instead of defaulting to green.',
    // ---- The five properties ----
    props: {
      tenantIsolation: {
        title: 'Tenant separation',
        body: 'Every organization can see only its own data. This is enforced in the database itself with Row-Level Security in FORCE mode on all tenant tables — not in application code, which could have a bug.',
        // interpolated with the live count
        evidenceLive: (secured: number, total: number) =>
          `${secured}/${total} tenant tables with RLS + FORCE`,
        evidenceFail: (secured: number, total: number) =>
          `Only ${secured}/${total} tenant tables have RLS + FORCE — expected all ${total}.`,
      },
      auditImmutability: {
        title: 'Tamper-proof audit trail',
        body: 'The audit log is append-only. There is no policy that permits changing or deleting an entry, and two database triggers reject any attempt — even from the table owner. History cannot be quietly rewritten.',
        evidenceLive: 'Append-only: no UPDATE/DELETE policy, both guard triggers present',
        evidenceFail: 'The append-only guarantee is not intact — an UPDATE/DELETE policy or a missing guard trigger was found.',
      },
      moneyFailsafe: {
        title: 'Money failsafe',
        body: 'A skill that touches money can never act without a human decision — enforced both when a policy is written and again at runtime (defense in depth). A money skill cannot be set to "never require approval": that setting is overridden at runtime and logged to the audit trail.',
        evidence: (n: number) =>
          `${n} money-touching ${n === 1 ? 'skill' : 'skills'}, each gated or fail-closed`,
        basisDetail: 'Pinned by the policy, engine and skill-effect tests.',
      },
      antiHallucination: {
        title: 'Anti-hallucination',
        body: 'Below the relevance threshold the language model is never called — the system says it does not know rather than inventing an answer. Every answer carries only its cited sources.',
        evidence: (threshold: number) => `Relevance threshold: ${threshold}`,
        basisDetail: 'Built into the retrieval pipeline; covered by the answer-trace tests.',
      },
      euDataResidency: {
        title: 'EU data residency',
        body: 'Data is stored in Postgres in the EU (Neon, Frankfurt). Customer data is not used to train models. This is a deployment and contract fact — stated plainly, not presented as a live check.',
        evidence: 'Postgres in the EU · no training on customer data',
      },
    },
  },

  settings: {
    intro:
      'Organization governance: when a skill needs human approval, which role sees which knowledge, who holds which role. Every change lands in the',
    introAuditLink: 'audit log',
    tabsAria: 'Settings',
    tabs: {
      approvals: 'Approval rules',
      visibility: 'Knowledge visibility',
      members: 'Members & roles',
      clients: 'Clients',
      governance: 'Governance templates',
      company: 'Company details',
      value: 'Value assumptions',
      slack: 'Slack',
      language: 'Language',
      data: 'Data & deletion',
    },
    governance: {
      presetsTitle: 'Industry presets',
      presetsHint:
        'One click sets sensible defaults for approval rules and knowledge visibility — instead of configuring every rule by hand. Everything stays adjustable afterwards in the other tabs.',
      presetNames: {
        kanzlei: 'Law / tax firm',
        gesundheitswesen: 'Healthcare',
        handwerk: 'Trades / SMB',
      } as Record<string, string>,
      presetDescriptions: {
        kanzlei:
          'Strict approvals with four-eyes on money: receipts from €50 and every invoice need an admin, quotes need a lead. Members see only open documents; confidential stays admin-only.',
        gesundheitswesen:
          'Maximally strict: every skill run needs an admin approval, and everything beyond open documents is admin-only — personal data stays locked down.',
        handwerk:
          'Pragmatic: leads approve receipts from €250 and invoices from €1,000, quotes go out without a pause. Broad knowledge access — money skills stay guarded.',
      } as Record<string, string>,
      applyCta: 'Apply preset',
      confirmOverwrite:
        'I understand: this overwrites the existing approval rules and the visibility matrix.',
      moneyFailsafeNote:
        'No preset and no import can disable approvals for money skills — such configs are corrected fail-closed and audited.',
      exportTitle: 'Export governance',
      exportHint:
        'Download the current approval rules and visibility matrix as JSON — portable, without secrets, without anything org-identifying. The same file can be imported here or in another organization.',
      exportCta: 'Download JSON',
      importTitle: 'Import governance',
      importHint:
        'Paste an exported JSON (or choose a file). It is validated first — structure, value ranges, and the money failsafe — and then applied in one transaction.',
      importPlaceholder: '{"format":"helix-governance","version":1,…}',
      importFileLabel: 'or choose a file:',
      importCta: 'Validate & apply',
      appliesTo: (policies: number, grants: number) =>
        `${policies} approval rules · ${grants} visibility grants`,
    },
    notifyTitle: 'Notification for pending approvals',
    notifyHint:
      'As soon as a skill run pauses and waits for approval, a short e-mail goes to this address (e.g. a team alias). Empty = no notification. Sending is best-effort — approvals always work without e-mail too.',
    notifyPlaceholder: 'e.g. approvals@company.com',
    policiesTitle: 'Approval rules per skill',
    policiesFailsafe:
      'Approval cannot be disabled for money-moving skills — mode "never" is overridden by the engine at runtime and audited.',
    failsafeChip: 'Failsafe',
    currentRule: 'Current rule',
    mode: 'Mode',
    threshold: 'Threshold (EUR)',
    approverRole: 'Approver role',
    movesMoney: 'moves money',
    movesMoneyTitle: 'Approval cannot be disabled for money-moving skills',
    ruleFrom: (amount: string) => `from ${amount}`,
    ruleAlways: 'always',
    ruleNeverFailsafe: 'never (failsafe applies)',
    ruleNever: 'never',
    ruleNoPolicy: 'no policy — skill guardrail applies',
    modeAlways: 'always',
    modeThreshold: 'from threshold',
    modeNever: 'never',
    thresholdPlaceholder: 'e.g. 5000',
    visibilityLevelsTitle: 'The three visibility levels',
    levelOpen: 'All roles see these documents — no grant needed.',
    levelRestricted:
      'Only roles with an explicit grant. Without a grant the document is invisible in chat/retrieval (fail-closed).',
    levelConfidential:
      'Highest level — also grant-only. Even admins need a grant, otherwise they see nothing.',
    grantsTitle: 'Who may see which level?',
    grantsHint: '"open" needs no grant. No checkmark = the role does not see the level (fail-closed).',
    level: 'Level',
    grantAria: (level: string, role: string) => `${level} for ${role}`,
    saveGrants: 'Save grants',
    documentsLevelTitle: 'Documents & their level',
    documentsLevelHint: 'You change a document’s level in the',
    documentsLevelLink: 'knowledge base',
    noDocuments: 'No documents yet.',
    membersTitle: (n: number) => `Members (${n})`,
    membersHeading: 'Members',
    membersTotal: (n: number) => `${n} total`,
    membersHint:
      'At least one admin always remains — the last admin role cannot be removed. Every change is audited.',
    memberId: 'Identifier',
    changeRole: 'Change role',
    lastAdmin: 'last admin',
    ownerManual: 'Owner is only assigned manually',
    companyTitle: 'Company details',
    companyHint:
      'Letterhead and footer of the generated quote and invoice PDFs. All fields are optional — empty fields simply do not appear in the document. Every change is audited.',
    companyName: 'Company name',
    companyNamePlaceholder: 'e.g. Hephaistos Systems GmbH',
    companyAddress: 'Address',
    companyAddressPlaceholder: 'Example Street 1\n20095 Hamburg',
    companyVatId: 'VAT ID',
    companyVatIdPlaceholder: 'e.g. DE123456789',
    companyBank: 'Bank details',
    companyBankPlaceholder: 'Example Bank\nIBAN: DE00 0000 0000 0000 0000 00\nBIC: XXXXDEXX',
    clientsTitle: 'Clients',
    clientsHeading: 'Clients',
    clientsTotal: (n: number) => `${n} total`,
    clientsHint:
      'Manage the clients your organization works with. Skill runs can be linked to a client for tracking. Every change is audited.',
    clientName: 'Name',
    clientNamePlaceholder: 'e.g. Acme Corp',
    clientNotes: 'Notes (optional)',
    clientNotesPlaceholder: 'Short description or contact info',
    addClient: 'Add client',
    editClient: 'Edit',
    saveClient: 'Save',
    noClients: 'No clients yet. Add the first one above.',
    valueTitle: 'Value assumptions (value dashboard)',
    valueHint:
      'How the value dashboard converts completed live runs into hours and dollars: minutes saved per successful run × hourly rate. Assumptions, not measurements — every change is audited. Dry runs never count.',
    valueHourlyRate: 'Hourly rate (USD)',
    valueMinutesTitle: 'Minutes saved per successful run',
    valueMinutes: 'Minutes / run',
    valueDefaultChip: 'default',
    slackTitle: 'Slack connection',
    slackHint:
      'One Slack workspace (team) maps to exactly one organization. Requests from unmapped workspaces are rejected. MVP: the team id is entered manually — an OAuth install flow is a later step. The bot token stays in .env (SLACK_BOT_TOKEN); the database stores only a reference, never the secret.',
    slackConnected: 'connected',
    slackTeam: 'Team',
    slackNotConnected: 'not connected',
    slackOauthCta: 'Connect with Slack (OAuth)',
    slackManualHint: 'or manually via team id:',
    slackTeamIdPlaceholder: 'Slack team id, e.g. T0123456789',
    slackConnect: 'Connect workspace',
    slackLinksTitle: (n: number) => `Slack users ↔ members (${n})`,
    slackLinksHeading: 'Slack users ↔ members',
    slackLinkedCount: (n: number) => `${n} linked`,
    slackLinksHint:
      'Only linked Slack users act with their membership role (start skills, grant approvals). Unlinked users see only "open" knowledge and cannot trigger anything (fail-closed).',
    slackUserId: 'Slack user id',
    member: 'Member',
    unlink: 'Unlink',
    slackUserIdPlaceholder: 'e.g. U0123456789',
    link: 'Link',
    languageTitle: 'Language',
    uiLanguageTitle: 'Interface language',
    uiLanguageHint:
      'Applies to this browser only (stored as a cookie). Every member chooses their own interface language.',
    uiLanguageLabel: 'Interface language',
    orgLanguageTitle: 'Organization language',
    orgLanguageHint:
      'Language of org-wide output: generated quote/invoice PDFs and outgoing e-mails (e.g. approval notifications). Admin setting, audited.',
    orgLanguageLabel: 'Organization language',
    languageEnglish: 'English',
    languageGerman: 'German (Deutsch)',
    exportTitle: 'Data export (Art. 20 GDPR)',
    exportHint:
      'Complete export of all data of this organization as JSON (documents, chunks without embeddings, chat, runs, policies, Slack mappings, audit trail). The export runs through withTenant — it can structurally only contain your own organization. Every export is audited.',
    exportCta: 'Download export',
    retentionTitle: 'Chat retention',
    retentionAutoHint:
      'Automatic: messages older than N days are deleted automatically after chat activity (empty = keep forever). Every automatic deletion is audited.',
    retentionUnlimited: 'unlimited',
    retentionDaysAuto: 'days to keep (automatic)',
    retentionOnceHint:
      'One-off: deletes chat messages older than the given number of days (0 = everything). Audited with the count.',
    retentionDays: 'days to keep',
    purgeCta: 'Delete older messages',
    eraseTitle: 'Irreversibly delete organization',
    eraseHint:
      'Deletes this organization completely — including knowledge base, runs, Slack mappings and audit trail (tenant offboarding, Art. 17). Export first! The deletion proof (row counts per table) is logged server-side. Type the exact organization name to confirm.',
    erasePlaceholder: 'Exact organization name',
    eraseCta: 'Delete organization',
  },

  selectOrg: {
    title: 'Choose organization',
    hint: 'helix is multi-tenant. Choose an organization or create a new one.',
  },

  landing: {
    heroTitle: 'The GDPR-native AI platform for SMBs',
    heroText:
      'helix answers questions from your company knowledge with sources and completes tasks with built-in human approval — tenant-isolated at the database level, every action in the audit trail.',
    ctaStart: 'Start for free',
    ctaSignIn: 'Sign in',
    features: [
      {
        title: 'Tenant isolation by the database',
        text: 'Tenant isolation is enforced by PostgreSQL row-level security with FORCE — not app-code discipline. A forgotten WHERE structurally cannot leak foreign data.',
      },
      {
        title: 'Knowledge base with sourced answers',
        text: 'PDF, DOCX, Markdown and text (incl. OCR for scans) become semantically searchable. The chat answers with sources — or honestly says it does not know.',
      },
      {
        title: 'Skills with human approval',
        text: 'Quotes, invoices, bookkeeping: everything that moves money or leaves the company pauses for a human approval — non-disablable, fully audited.',
      },
      {
        title: 'GDPR built in, not bolted on',
        text: 'Data export (Art. 20), deletion concept with proof, pseudonymization in the audit trail, automatic retention periods. EU database location.',
      },
    ],
  },

  publicShell: {
    signIn: 'Sign in',
    imprint: 'Imprint',
    privacy: 'Privacy',
    dpa: 'Data Processing Agreement',
  },

  deliverables: {
    title: 'Deliverables',
    intro: 'Persistent artifacts produced by skill runs — versioned and linked to clients.',
    noArtifacts: 'No deliverables yet. Artifacts appear here after a skill run produces one.',
    colTitle: 'Title',
    colType: 'Type',
    colClient: 'Client',
    colVersion: 'Version',
    colSize: 'Size',
    colDate: 'Date',
    download: 'Download',
    view: 'View',
    deleteConfirm: 'Delete this artifact and its stored file? This cannot be undone.',
    deleted: 'Artifact deleted.',
    filterClient: 'Filter by client',
    filterAll: 'All clients',
    versionLabel: (v: number) => `v${v}`,
    sizeKb: (kb: number) => `${kb} KB`,
  },

  skillTitles: {
    beleg_kontieren: 'Code and post a receipt',
    wissen_zusammenfassen: 'Summarize knowledge',
    angebot_erstellen: 'Create and send a customer quote',
    rechnung_erstellen: 'Create and post an invoice',
  } as Record<string, string>,
};

export type Dictionary = typeof en;
