// Declarative skill format.
//
// A skill is DATA, not a code special-case: a key, a title, an ordered list of
// steps, and (for skills that act) a guardrail. The engine (./engine.ts) is the
// only thing that executes skills — always inside withTenant() transactions,
// always writing skill_steps + audit_log as it goes.
//
// "liest nur" vs. "handelt":
//   - A step with `acts: false` (the default) only READS/derives — it may query
//     tenant data through ctx.tx but must not cause real-world effects.
//   - A step with `acts: true` HANDELT — it has an (possibly simulated)
//     external effect. Before the first acting step the engine enforces the
//     guardrail: if it triggers, the run pauses in `awaiting_approval` and the
//     acting step does NOT execute until a human approves.
//   - `handlesMoney: true` marks the whole skill as money-touching: the engine
//     then refuses to execute ANY acting step without a guardrail verdict —
//     a money skill without a guardrail fails closed (always needs approval).
import type { Tx } from '../tenant';

/** JSON-serializable detail/state payloads (stored in jsonb columns). */
export type SkillJson = Record<string, unknown>;

/**
 * Context for the PRE-transaction phase of a step (StepDef.prepare). It carries
 * NO `tx` on purpose: prepare() runs BEFORE withTenant() opens, so it CANNOT —
 * and physically has no handle to — touch tenant data in a transaction. Its job
 * is the expensive, slow, network-bound work (an LLM/tool call) that must never
 * sit inside the 15s tenant transaction (see the answerQuestion pattern in
 * src/lib/rag/answer.ts). Whatever it returns is handed to run() as `prepared`.
 */
export interface PrepareContext {
  orgId: string;
  /** The run's input, exactly as passed to startRun(). */
  input: SkillJson;
  /** Details of all previously completed steps, keyed by step name. */
  state: Record<string, SkillJson>;
}

export interface SkillContext {
  orgId: string;
  /** Tenant-bound transaction from withTenant() — the ONLY way steps touch data. */
  tx: Tx;
  /** The run's input, exactly as passed to startRun(). */
  input: SkillJson;
  /** Details of all previously completed steps, keyed by step name. */
  state: Record<string, SkillJson>;
  /**
   * The value returned by this step's OPTIONAL prepare() hook, produced BEFORE
   * the transaction opened. `undefined` when the step has no prepare() (every
   * pre-LLM skill). run() writes this pre-computed result atomically — it must
   * NOT itself make the expensive call again.
   */
  prepared?: SkillJson;
}

export interface StepDef {
  name: string;
  /**
   * true = this step ACTS (has a real-world effect) and is gated by the
   * guardrail/approval mechanic. Default false = read-only.
   */
  acts?: boolean;
  /**
   * OPTIONAL pre-transaction phase. When present, the engine calls it BEFORE
   * opening the step's withTenant() transaction, with a Tx-FREE context, and
   * passes its result into run() as ctx.prepared. This is the sanctioned place
   * for the one thing that must never happen inside a tenant transaction: a
   * slow network call (LLM / external tool). The pattern mirrors answerQuestion
   * (src/lib/rag/answer.ts): expensive call first, then a short transaction
   * writes only the result. Steps WITHOUT prepare() are unchanged — run() alone
   * executes inside the transaction, exactly as before.
   *
   * prepare() must not have real-world side effects for a read-only (acts:false)
   * step beyond the network read it performs; for acting steps it runs only
   * AFTER the approval gate cleared (same ordering guarantee as run()).
   */
  prepare?: (ctx: PrepareContext) => Promise<SkillJson>;
  /** Executes the step; the returned detail is persisted on the skill_step row. */
  run: (ctx: SkillContext) => Promise<SkillJson>;
  /**
   * OPTIONAL, only meaningful for acting steps: a READ-ONLY preview of the
   * outward effect this step WOULD have, used by a dry-run (mode='simulation')
   * to show "what would happen" without executing it. It MUST NOT cause any
   * real-world effect (no sending, no external writes) — it only derives a
   * human-readable description from ctx.input/ctx.state (reads via ctx.tx are
   * allowed). When absent, the engine records a generic simulated-step detail.
   */
  describeEffect?: (ctx: SkillContext) => Promise<SkillJson> | SkillJson;
}

export interface GuardrailResult {
  triggered: boolean;
  /** Human-readable reason shown on the approval (e.g. "Betrag über 1.000 €"). */
  reason?: string;
}

export interface SkillDef {
  key: string;
  title: string;
  /**
   * Skill touches money (or otherwise irreversible effects). Acting steps of
   * such skills REQUIRE a guardrail verdict; without a guardrail function the
   * engine fails closed and always demands approval.
   */
  handlesMoney: boolean;
  /** Evaluated BEFORE the first acting step. Pure function of the input. */
  guardrail?: (input: SkillJson) => GuardrailResult;
  /**
   * Extracts the monetary amount (EUR) from the input — used by 'threshold'
   * approval policies. Return null when the input carries no valid amount;
   * threshold policies then fail closed (approval required).
   */
  amountOf?: (input: SkillJson) => number | null;
  steps: StepDef[];
}
