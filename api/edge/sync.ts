// Sync engine — offline queue → simulated Qdrant Server, with version/hash
// conflict detection and application-level resolution (per plan §9–10).

import { getDb } from "../queries/connection";
import { memories, cloudMemories, activity, decisions } from "@db/schema";
import { eq } from "drizzle-orm";
import { isOnline } from "./governor";
import { hashContent } from "./embeddings";

export interface SyncReport {
  attempted: number;
  synced: number;
  conflicts: number;
  skippedOffline: boolean;
}

export async function runSync(): Promise<SyncReport> {
  const db = getDb();
  if (!(await isOnline())) {
    return { attempted: 0, synced: 0, conflicts: 0, skippedOffline: true };
  }

  const pending = await db.query.memories.findMany({
    where: eq(memories.syncStatus, "pending"),
  });

  let synced = 0;
  let conflicts = 0;

  for (const m of pending) {
    const cloud = await db.query.cloudMemories.findFirst({
      where: eq(cloudMemories.memoryId, Number(m.id)),
    });

    const cloudChangedSinceSync =
      cloud && m.lastSyncedAt && cloud.updatedAt.getTime() > m.lastSyncedAt.getTime();
    if (cloud && cloud.contentHash !== m.contentHash && cloudChangedSinceSync) {
      // Both sides changed → conflict, needs resolution
      await db
        .update(memories)
        .set({ syncStatus: "conflict", state: "conflicted" })
        .where(eq(memories.id, m.id));
      await db.insert(activity).values({
        kind: "conflict",
        message: `Conflict on memory #${m.id}: device v${m.version} vs cloud v${cloud.cloudVersion}`,
        meta: { memoryId: Number(m.id), deviceVersion: m.version, cloudVersion: cloud.cloudVersion },
      });
      conflicts++;
      continue;
    }

    if (cloud) {
      await db
        .update(cloudMemories)
        .set({
          content: m.content,
          cloudVersion: m.version,
          contentHash: m.contentHash,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cloudMemories.memoryId, Number(m.id)));
    } else {
      await db.insert(cloudMemories).values({
        memoryId: Number(m.id),
        content: m.content,
        cloudVersion: m.version,
        contentHash: m.contentHash,
        deviceId: m.deviceId,
      });
    }

    await db
      .update(memories)
      .set({ syncStatus: "synced", lastSyncedAt: new Date() })
      .where(eq(memories.id, m.id));
    synced++;
  }

  await db.insert(activity).values({
    kind: "sync",
    message: `Sync pass complete: ${synced} synchronized, ${conflicts} conflict${conflicts === 1 ? "" : "s"}, ${pending.length - synced - conflicts} remaining`,
    meta: { synced, conflicts, attempted: pending.length },
  });

  return { attempted: pending.length, synced, conflicts, skippedOffline: false };
}

export async function resolveConflict(memoryId: number, choice: "device" | "cloud" | "both") {
  const db = getDb();
  const m = await db.query.memories.findFirst({ where: eq(memories.id, memoryId) });
  const cloud = await db.query.cloudMemories.findFirst({
    where: eq(cloudMemories.memoryId, memoryId),
  });
  if (!m || !cloud) throw new Error("Conflict pair not found");

  if (choice === "device") {
    const newVersion = Math.max(m.version, cloud.cloudVersion) + 1;
    await db
      .update(cloudMemories)
      .set({
        content: m.content,
        cloudVersion: newVersion,
        contentHash: m.contentHash,
        updatedAt: new Date(),
      })
      .where(eq(cloudMemories.memoryId, memoryId));
    await db
      .update(memories)
      .set({ version: newVersion, syncStatus: "synced", state: "active", lastSyncedAt: new Date() })
      .where(eq(memories.id, memoryId));
  } else if (choice === "cloud") {
    await db
      .update(memories)
      .set({
        content: cloud.content,
        version: cloud.cloudVersion,
        contentHash: cloud.contentHash,
        syncStatus: "synced",
        state: "active",
        lastSyncedAt: new Date(),
      })
      .where(eq(memories.id, memoryId));
  } else {
    // preserve both revisions: merge cloud text into device copy
    const merged = `${cloud.content}\n---\n${m.content}`;
    const newVersion = Math.max(m.version, cloud.cloudVersion) + 1;
    const hash = hashContent(merged);
    await db
      .update(cloudMemories)
      .set({ content: merged, cloudVersion: newVersion, contentHash: hash, updatedAt: new Date() })
      .where(eq(cloudMemories.memoryId, memoryId));
    await db
      .update(memories)
      .set({
        content: merged,
        version: newVersion,
        contentHash: hash,
        syncStatus: "synced",
        state: "active",
        lastSyncedAt: new Date(),
      })
      .where(eq(memories.id, memoryId));
  }

  await db.insert(decisions).values({
    memoryId,
    engine: "local_policy",
    kind: "lifecycle",
    action: `resolve_${choice}`,
    confidence: 1,
    rationale: `Operator resolved conflict: ${choice === "both" ? "both revisions preserved (merged)" : choice + " version kept"}.`,
  });
  await db.insert(activity).values({
    kind: "conflict",
    message: `Conflict on memory #${memoryId} resolved (${choice})`,
    meta: { memoryId, choice },
  });
}

// Demo helper: make the "cloud" diverge so the next sync produces a conflict.
export async function simulateCloudEdit(memoryId: number) {
  const db = getDb();
  const cloud = await db.query.cloudMemories.findFirst({
    where: eq(cloudMemories.memoryId, memoryId),
  });
  if (!cloud) throw new Error("Memory is not in the cloud yet");
  const newContent = cloud.content + " [cloud edit: verified by remote supervisor]";
  await db
    .update(cloudMemories)
    .set({
      content: newContent,
      cloudVersion: cloud.cloudVersion + 1,
      contentHash: hashContent(newContent),
      updatedAt: new Date(),
    })
    .where(eq(cloudMemories.memoryId, memoryId));
  await db.insert(activity).values({
    kind: "sync",
    message: `Remote device modified memory #${memoryId} in the cloud (v${cloud.cloudVersion + 1})`,
    meta: { memoryId },
  });
}
