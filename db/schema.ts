import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  float,
  int,
  bigint,
  json,
  index,
} from "drizzle-orm/mysql-core";

// ---------------------------------------------------------------------------
// EdgeMind — decision-controlled edge memory platform
// Qdrant Edge is simulated by the dense/sparse vector columns on `memories`;
// MySQL plays the role of the local metadata DB (SQLite in the plan) plus the
// simulated Qdrant Server ("cloud").
// ---------------------------------------------------------------------------

export const memories = mysqlTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    memoryType: mysqlEnum("memory_type", [
      "event",
      "note",
      "log",
      "document",
      "conversation",
      "sensor",
    ])
      .notNull()
      .default("note"),
    deviceId: varchar("device_id", { length: 64 }).notNull().default("edge-01"),

    // Governor scores
    importance: float("importance").notNull().default(5),
    futureUtility: float("future_utility").notNull().default(5),
    freshness: float("freshness").notNull().default(1),
    syncProbability: float("sync_probability").notNull().default(0.5),
    sensitivity: mysqlEnum("sensitivity", ["public", "internal", "private"])
      .notNull()
      .default("internal"),

    // Decision
    decisionAction: mysqlEnum("decision_action", [
      "keep_local",
      "sync",
      "compress",
      "defer",
      "discard",
    ])
      .notNull()
      .default("keep_local"),
    decisionConfidence: float("decision_confidence").notNull().default(0),
    decisionEngine: mysqlEnum("decision_engine", ["jev", "local_policy"])
      .notNull()
      .default("local_policy"),
    decisionRationale: text("decision_rationale"),

    // Lifecycle state (Active Memory)
    state: mysqlEnum("memory_state", [
      "dormant",
      "active",
      "promoted",
      "archived",
      "conflicted",
    ])
      .notNull()
      .default("active"),
    retrievalCount: int("retrieval_count").notNull().default(0),

    // Sync state
    syncStatus: mysqlEnum("sync_status", [
      "local_only",
      "pending",
      "syncing",
      "synced",
      "conflict",
    ])
      .notNull()
      .default("local_only"),
    version: int("version").notNull().default(1),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    lastSyncedAt: timestamp("last_synced_at"),

    // Vector payloads (stand-in for Qdrant Edge shards)
    denseVector: json("dense_vector").$type<number[]>(),
    tokenTerms: json("token_terms").$type<string[]>(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    syncStatusIdx: index("sync_status_idx").on(t.syncStatus),
    stateIdx: index("memory_state_idx").on(t.state),
    typeIdx: index("memory_type_idx").on(t.memoryType),
  }),
);

// Simulated Qdrant Server (cloud global memory)
export const cloudMemories = mysqlTable("cloud_memories", {
  id: serial("id").primaryKey(),
  memoryId: bigint("memory_id", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  cloudVersion: int("cloud_version").notNull().default(1),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  deviceId: varchar("device_id", { length: 64 }).notNull(),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Decision log — the Decision Observatory feed
export const decisions = mysqlTable(
  "decisions",
  {
    id: serial("id").primaryKey(),
    memoryId: bigint("memory_id", { mode: "number", unsigned: true }),
    queryText: text("query_text"),
    engine: mysqlEnum("engine", ["jev", "local_policy"]).notNull(),
    kind: mysqlEnum("decision_kind", ["ingest", "retrieval", "lifecycle"])
      .notNull()
      .default("ingest"),
    action: varchar("action", { length: 32 }).notNull(),
    importanceScore: float("importance_score"),
    syncProbability: float("sync_probability"),
    confidence: float("confidence"),
    rationale: text("rationale"),
    latencyMs: int("latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    memoryIdx: index("decision_memory_idx").on(t.memoryId),
  }),
);

// Offline sync queue / activity timeline
export const activity = mysqlTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // ingest | search | decision | sync | conflict | network
    message: text("message").notNull(),
    meta: json("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    kindIdx: index("activity_kind_idx").on(t.kind),
  }),
);

// System state (network toggle etc.)
export const systemState = mysqlTable("system_state", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: varchar("value", { length: 255 }).notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type CloudMemory = typeof cloudMemories.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Activity = typeof activity.$inferSelect;
