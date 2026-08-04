/**
 * forkRowIds - deterministic row-id derivation for forked thread history.
 *
 * Copying a thread's projected history into a fork MUST regenerate every row id.
 * `projection_thread_messages.message_id`, `projection_thread_activities.activity_id`
 * and `projection_thread_proposed_plans.plan_id` are GLOBAL primary keys, and the
 * repositories upsert with `ON CONFLICT (<pk>) DO UPDATE SET thread_id = excluded.thread_id`.
 * A copy that reuses a source id therefore does not collide — it silently MOVES the
 * source row onto the fork and empties the parent's transcript.
 *
 * The derivation is deterministic rather than random for two reasons:
 *  - a projector replay must reproduce the same ids rather than duplicate rows;
 *  - a constant prefix preserves the relative id ordering of the source rows, which
 *    the message and activity list queries use as a tiebreaker after `created_at`.
 *
 * Each copy is a set-based `INSERT ... SELECT` that concatenates this prefix in SQL,
 * so there is no TypeScript-side id builder to drift from it.
 *
 * @module forkRowIds
 */

/**
 * Prefix applied to every copied row id, as `fork:<forkThreadId>:<sourceRowId>`.
 * Chosen so a copied id is greppable in a database and can never be mistaken for a
 * provider-minted id.
 */
export const FORK_ROW_ID_PREFIX = "fork";
