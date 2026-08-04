import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "forked_from_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN forked_from_thread_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "forked_from_tip_turn_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN forked_from_tip_turn_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "forked_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN forked_at TEXT
    `;
  }

  // Answers "list the forks of this thread" for the parent-side affordance.
  // Without it that lookup is a full scan of projection_threads on every open
  // of a parent thread.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_forked_from
    ON projection_threads(forked_from_thread_id)
  `;
});
