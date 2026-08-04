import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_ProjectionThreadsForkedFrom", (it) => {
  it.effect("adds fork lineage columns and the reverse-lookup index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* runMigrations({ toMigrationInclusive: 36 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = new Set(columns.map((column) => column.name));
      assert.ok(names.has("forked_from_thread_id"));
      assert.ok(names.has("forked_from_tip_turn_id"));
      assert.ok(names.has("forked_at"));

      // The parent-side "list this thread's forks" query runs whenever a thread
      // is opened or deleted, so it must not be a full table scan.
      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_threads)
      `;
      assert.ok(indexes.some((index) => index.name === "idx_projection_threads_forked_from"));

      const indexColumns = yield* sql<{ readonly name: string }>`
        PRAGMA index_info(idx_projection_threads_forked_from)
      `;
      assert.deepEqual(
        indexColumns.map((column) => column.name),
        ["forked_from_thread_id"],
      );
    }),
  );

  it.effect("is idempotent when re-run over an already migrated database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* runMigrations({ toMigrationInclusive: 36 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.equal(columns.filter((column) => column.name === "forked_from_thread_id").length, 1);
    }),
  );
});
