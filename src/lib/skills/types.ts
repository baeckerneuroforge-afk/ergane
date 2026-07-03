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

export interface SkillContext {
  orgId: string;
  /** Tenant-bound transaction from withTenant() — the ONLY way steps touch data. */
  tx: Tx;
  /** The run's input, exactly as passed to startRun(). */
  input: SkillJson;
  /** Details of all previously completed steps, keyed by step name. */
  state: Record<string, SkillJson>;
}

export interface StepDef {
  name: string;
  /**
   * true = this step ACTS (has a real-world effect) and is gated by the
   * guardrail/approval mechanic. Default false = read-only.
   */
  acts?: boolean;
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
