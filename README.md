# EdgeMind

**Decision-controlled, offline-first edge memory for field devices.**

EdgeMind is a memory operating system for machines that work in places the cloud
does not reach. Every memory a device captures is embedded locally, judged by an
AI decision layer, and routed to one of five fates — *keep local, sync, compress,
defer,* or *discard*. The device stays fully functional with the network off, and
reconciles with the cloud when connectivity returns.

It is not a chat app with a vector index attached. The interesting part is the
**decision layer**: a hosted model (`Jev`) when the device is online, a
deterministic policy when it is not, and a hard policy override that keeps
sensitive data on the device no matter what the model says.

---

## Table of contents

- [The problem](#the-problem)
- [Core ideas](#core-ideas)
- [Architecture](#architecture)
- [Design of each subsystem](#design-of-each-subsystem)
- [Data flows](#data-flows)
- [API reference](#api-reference)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Roadmap](#roadmap)

---

## The problem

Field-maintenance equipment — CNC spindles, hydraulic presses, conveyor
controllers, sensor arrays — generates most of its knowledge in places with no
reliable connectivity: basements, plant rooms, remote sites. The two usual answers
are both bad:

- **Cloud-only memory** stops working the moment the network does, and the most
  operationally valuable memories (a fault on *this* machine, at *this* site) are
  exactly the ones that never leave the device.
- **Store everything locally** fills the device with noise. Routine temperature
  logs crowd out the one note that says *"Machine A has now overheated three times
  this quarter."*

EdgeMind answers with a **decision-controlled store**: the device decides, per
memory, what is worth keeping, what is worth sharing, and what is noise — and it
makes that decision *locally* when the cloud is unreachable.

---

## Core ideas

| Idea | Meaning |
| --- | --- |
| **Decision-controlled memory** | No memory is stored on autopilot. A governor assigns one of five actions and records its reasoning. |
| **Dual-engine decisions** | `Jev` (hosted, structured output) online; a deterministic threshold policy offline. The verdict always names the engine that produced it. |
| **Two retrieval lanes** | A 256-dim dense vector (semantic) *and* BM25 over token terms (exact), fused with reciprocal-rank fusion so neither lane dominates. |
| **Two independent state axes** | *Lifecycle* (`dormant → active → promoted → archived → conflicted`) is orthogonal to *sync* (`local_only → pending → syncing → synced → conflict`). |
| **Explainable by construction** | Every decision writes a `decisions` row with engine, action, confidence, latency, and a human-readable rationale. |
| **Cloud is optional** | The cloud LLM is a *consumer* of the memory platform, not a dependency. Local extractive answering works with no network. |
| **Privacy is enforced, not requested** | A `private` sensitivity verdict is downgraded to `keep_local` server-side, overriding the model. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser — React 19 SPA (Vite)                                       │
│  6 routes · TanStack Query · tRPC client · shadcn/ui · Recharts      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  HTTP  /api/trpc  (superjson, batched)
┌───────────────────────────────▼──────────────────────────────────────┐
│  Edge runtime — Hono  (dev: @hono/vite-dev-server · prod: dist/boot.js)
│                                                                       │
│   api/router.ts ── 7 tRPC routers, zod-validated                      │
│        │                                                              │
│        ├── api/edge/governor.ts    Jev online │ local policy offline  │
│        ├── api/edge/search.ts      dense + BM25 → RRF → top-K         │
│        ├── api/edge/embeddings.ts  256-dim hashing trick · BM25 · FNV │
│        ├── api/edge/sync.ts        queue · conflict detect · 3-way fix│
│        └── api/edge/ai-client.ts   model discovery · error taxonomy   │
│                                                                       │
│   api/queries/connection.ts   Drizzle (mysql2, planetscale mode)     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  MySQL                                                                 │
│   memories · decisions · activity · system_state   ← local metadata   │
│   cloud_memories                                    ← simulated cloud  │
└──────────────────────────────────────────────────────────────────────┘

        ONLINE ONLY                    │              ALWAYS AVAILABLE
┌───────────────────────────┐          │          ┌──────────────────────┐
│ Kimi gateway (OpenAI-     │◀─────────┘          │ Local policy engine  │
│ compatible) — Jev + answer│  judged when online  │ (deterministic)      │
└───────────────────────────┘                      └──────────────────────┘
```

**One process, two runtimes.** The same `api/boot.ts` is the dev server (mounted
into Vite via `@hono/vite-dev-server`, so HMR covers UI *and* API) and the
production server (bundled by esbuild to `dist/boot.js`, serving the built SPA
from `dist/public` with an SPA fallback). Nothing is mocked at the boundary
between them.

**Simulated infrastructure.** Qdrant Edge is represented by the `dense_vector` /
`token_terms` columns on `memories`; the cloud Qdrant Server by the
`cloud_memories` table. Those seams are deliberate — see
[Design decisions worth knowing](#design-decisions-worth-knowing).

---

## Design of each subsystem

### 1. Decision Governor (`api/edge/governor.ts`)

The governor is the heart of the system: a typed decision model that mirrors the
Jev **Choice / Score / Noul** API. For each new memory it answers five questions
in a single structured call:

| Question | Field | Range |
| --- | --- | --- |
| CHOICE — what should happen to this memory? | `action` | `keep_local` · `sync` · `compress` · `defer` · `discard` |
| SCORE — how important is it? | `importance` | 1–10 |
| NOUL — should it reach the cloud? | `syncProbability` | 0–1 |
| SCORE — will it be useful later? | `futureUtility` | 1–10 |
| — how sensitive is it? | `sensitivity` | `public` · `internal` · `private` |

**Why two engines.** A device that cannot decide anything while offline is not
offline-first. When `system_state.network = offline`, or when the gateway call
fails for any reason, `localPolicy()` takes over: keyword signal lists
(`HIGH_SIGNAL`, `LOW_SIGNAL`, `PRIVATE_SIGNAL`) produce a bounded importance
score, and thresholds map that score to an action. The offline path is
deterministic and states its reasoning in the rationale string, so an operator can
always tell *why* a memory was treated the way it was.

**Why the override exists.** After either engine returns, a `private` verdict is
forced to `keep_local` and its sync probability is capped. This is not advice to
the model — it is a server-side correction, so a miscalibrated model cannot leak a
credential.

**Duplicate awareness.** Before deciding, the governor computes max cosine
similarity against the 100 most recent memories. Above 0.92 similarity the memory
becomes a candidate for `compress`, and a near-duplicate hint is passed into the
Jev prompt so it can factor that in.

### 2. Embedding & scoring primitives (`api/edge/embeddings.ts`)

Pure, dependency-free functions — the local stand-in for an on-device model:

- `embed(text)` → 256-dim L2-normalized vector. Tokens plus character trigrams
  vote into fixed buckets via FNV-1a hashing with sign flipping (the hashing
  trick), which gives stable, cheap semantic-ish similarity with no model
  download.
- `tokenize(text)` → stopword-filtered lowercase terms (also the BM25 input).
- `bm25Scores(terms, docs)` → classic Okapi BM25 (`k1 = 1.5`, `b = 0.75`) with
  document frequency computed per query.
- `cosine(a, b)` and `hashContent(text)` → similarity and content fingerprinting
  for conflict detection.

Because these are pure functions over plain arrays, they are the natural
unit-test seam in the codebase.

### 3. Hybrid retrieval (`api/edge/search.ts`)

The pipeline, in order:

1. **Filter** — drop anything the governor discarded; apply optional `type`,
   `sensitivity`, and `minImportance` metadata filters.
2. **Dense lane** — cosine similarity against the stored vectors.
3. **Sparse lane** — BM25 against the stored token terms.
4. **Fuse** — reciprocal-rank fusion with `K = 60`: each lane contributes
   `1 / (K + rank + 1)`, so a memory that ranks well in *both* lanes wins without
   either score scale dominating the other.
5. **Label** — every hit is tagged `dense`, `sparse`, or `hybrid`.
6. **Trace** — candidate counts before and after filtering, plus latency, travel
   back with the hits so the UI can show *why* something was retrieved.

Fusion is why a memory containing the literal error code `E104` (sparse lane) and
one describing the same fault in prose (dense lane) surface together.

### 4. Sync & conflict engine (`api/edge/sync.ts`)

Sync is a queue drain, not a stream — the right trade-off for bursty field
connectivity.

- Memories the governor marked `sync` enter the queue as `pending`.
- `runSync()` is a no-op while offline and reports `skippedOffline`, so the queue
  survives a disconnect untouched.
- For each pending memory the engine compares the device `contentHash` against the
  cloud hash, gated on whether the cloud changed *since the last successful sync*.
  Divergence on both sides is a **conflict**: the memory is parked in `conflicted`
  state and left for a human.
- `resolveConflict()` offers three resolutions — **device wins**, **cloud wins**,
  or **keep both** (both revisions merged into one text under a new version).
  Every resolution is recorded as a `lifecycle` decision.

`simulateCloudEdit()` exists so the conflict path can be demonstrated on demand:
it mutates the cloud row behind the device's back, and the next sync pass surfaces
the conflict.

### 5. AI gateway client (`api/edge/ai-client.ts`)

Platform-provided client — the one file in `api/edge/` with a fixed contract.

- `listModels()` discovers the models and `default_model_id` the site is entitled
  to. Model IDs are **never hardcoded**, because the available set changes silently
  and a stale ID is echoed back rather than rejected.
- `classifyAiError()` maps HTTP status and gateway error bodies onto a semantic
  taxonomy — `AiUnavailable` (quota/terminal), `ContentRejected`,
  `AiMisconfigured` (needs redeploy), `AiInvalidRequest`, and `AiTransient`
  (429/408/424/5xx). Callers branch on the type, never on a status code.
- It deliberately **does not retry**. A retried billed call can be charged twice,
  and a 5xx does not prove the server did not execute. That decision belongs to
  the caller.

### 6. API surface (`api/router.ts`)

Seven routers, every input validated with zod, every payload serialized with
superjson (so `Date` objects survive the wire).

One design note deserves attention: **`search.query` is a mutation, not a
query.** A search is not side-effect-free — it increments retrieval counts,
promotes frequently-retrieved memories, refreshes freshness, and writes both a
`decisions` row and an `activity` row. Modelling it as a query would let React
Query cache and replay it, corrupting the very telemetry the system exists to
observe.

Answer generation is the one place a cloud LLM is invoked, and only on explicit
escalation: when local retrieval scores below threshold and the device is online,
the top hits are sent to the gateway for a grounded answer. Otherwise the answer is
built locally by extractive summarization of the top hits — the device answers
without a network.

### 7. Data model (`db/schema.ts`)

Five tables:

| Table | Role |
| --- | --- |
| `memories` | The store: content, type, device, governor scores, decision, lifecycle state, sync state, version, content hash, dense vector, token terms. |
| `cloud_memories` | The simulated cloud mirror. One row per synced memory, with its own `cloudVersion` and hash. |
| `decisions` | Append-only decision log — the Decision Observatory feed: engine, kind (`ingest`/`retrieval`/`lifecycle`), action, scores, rationale, latency. |
| `activity` | Human-readable event timeline: ingest, search, decision, sync, conflict, network. |
| `system_state` | Key/value system flags — currently the `network` online/offline switch. |

**The two state axes are the key idea.** `state` answers *"how valuable is this
memory to this device?"* and `syncStatus` answers *"has it reached the cloud?"*.
They move independently: a `promoted` memory is still `local_only`; a `synced`
memory can later become `conflicted`. Collapsing them into one enum would make
"promoted but never synced" and "synced but now conflicted" inexpressible.

`denseVector` and `tokenTerms` are stored as JSON on the row. This is the
deliberate simulation seam for Qdrant Edge: a real deployment keeps vectors in the
vector store and points the same `embed()` at an on-device model.

### 8. Web client (`src/`)

React 19 + Vite, React Router 7, TanStack Query 5 through the tRPC React adapter,
shadcn/ui components on Tailwind v3, Recharts for the dashboard distributions,
Sonner for toasts — in a dark, terminal-inspired "edge device console" style.

| Route | Page | What it demonstrates |
| --- | --- | --- |
| `/` | Dashboard | Health, decision-action distribution, Jev share, average decision latency, recent decisions, and a one-click demo scenario loader. |
| `/memory` | Memories | Filterable table (action / state / sensitivity / sync), detail view with the full decision trail, create, edit, delete. |
| `/search` | Search | Hybrid search with per-hit dense/sparse/fused scores, retrieval trace, escalation toggle, answer-source badge. |
| `/decisions` | Decisions | The decision log as an observatory: engine, kind, action, confidence, latency, rationale. |
| `/sync` | Sync | Queue, cloud mirror, conflict resolution (device / cloud / both), and a control to simulate a remote cloud edit. |
| `/activity` | Activity | The event timeline. |

The **NetworkToggle** in `src/components/Layout.tsx` is the app's signature
control: one click flips `system_state.network`, and the entire system changes
behaviour — the governor falls back to local policy, sync pauses, the search
answer layer switches to extractive. Coming back online drains the queue and
reports what synced and what conflicted. That toggle is the fastest way to see the
whole thesis in a single gesture.

---

## Data flows

**Ingest**

```
content ─▶ embedForStorage() ─▶ INSERT memories (syncStatus: local_only)
                                     │
                                     ├──▶ activity: "ingested and embedded"
                                     ▼
                           governNewMemory()
                              ├── cosine vs. 100 recent (duplicate check)
                              ├── online?  jevDecide()  ─▶ generateObject
                              ├── offline? localPolicy() ─▶ thresholds
                              ├── gateway error? localPolicy() + note
                              ├── private override (action → keep_local)
                              ▼
                           UPDATE memories (scores, action, state, syncStatus)
                           INSERT decisions  +  INSERT activity
```

**Search**

```
query ─▶ hybridSearch()
           ├── filter (discarded + metadata)
           ├── dense ranking ─┐
           ├── BM25 ranking ──┴─▶ RRF (K=60) ─▶ label ─▶ top-5 + trace
           │
           ├──▶ promote top 3 hits (retrievalCount, state, freshness)
           ├──▶ decision: local_context_sufficient | escalate_to_cloud
           │   | no_local_memory | offline_limited
           ├── escalate && online? ─▶ cloud LLM grounded answer
           │                           └── any failure ─▶ extractive answer
           └── INSERT decisions (retrieval) + activity (search)
```

**Offline → online recovery**

```
setOnline(false) ─▶ activity: "operating offline"
                     governor → localPolicy · sync → skippedOffline
setOnline(true)  ─▶ activity: "connectivity restored"
                     runSync()
                       ├── both sides changed ─▶ conflict → human resolves
                       └── otherwise          ─▶ upsert cloud row → synced
```

---

## API reference

Everything is served under `/api/trpc`, grouped as `system.*`, `memories.*`,
`search.*`, `sync.*`, `decisions.*`, `activity.*`, and `seed.*`.

| Procedure | Type | Input | Returns |
| --- | --- | --- | --- |
| `system.status` | query | — | Online flag, totals (total / queue / synced / conflicts / cloud), action distribution, 8 recent decisions, avg decision latency, Jev share, health score |
| `system.setOnline` | mutation | `{ online }` | New state, plus a `SyncReport` when coming online |
| `memories.list` | query | `{ state?, action?, sensitivity?, syncStatus? }` | Up to 200 memories, newest first, filtered |
| `memories.get` | query | `{ id }` | Memory + its cloud mirror + full decision history |
| `memories.add` | mutation | `{ content, memoryType }` | Stored memory, governor verdict, ingest latency |
| `memories.update` | mutation | `{ id, content }` | Updated memory (re-embedded, version bumped, re-queued if it was synced) |
| `memories.remove` | mutation | `{ id }` | `{ ok }` — deletes the local row and the cloud tombstone |
| `search.query` | **mutation** | `{ query, type?, sensitivity?, minImportance?, escalate }` | Hits with dense/sparse/fused scores, retrieval trace, retrieval decision, answer, answer source |
| `sync.run` | mutation | — | `{ attempted, synced, conflicts, skippedOffline }` |
| `sync.queue` | query | — | Pending, conflicted (with the cloud side), and the full cloud mirror |
| `sync.resolveConflict` | mutation | `{ memoryId, choice }` where choice is `device` \| `cloud` \| `both` | `{ ok }` |
| `sync.simulateCloudEdit` | mutation | `{ memoryId }` | `{ ok }` — makes the cloud diverge so the next sync conflicts |
| `decisions.list` | query | — | 100 most recent decision records |
| `activity.list` | query | — | 150 most recent activity events |
| `seed.scenario` | mutation | — | Ingests 12 field-maintenance memories and governs each |

---

## Getting started

Requires **Node.js 20+** and a MySQL database.

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env      # fill in APP_ID, APP_SECRET, DATABASE_URL

# 3. create the schema
npm run db:push           # or db:generate + db:migrate for versioned migrations

# 4. run
npm run dev               # http://localhost:3000 — UI and API on one port
```

Open the app and press **Load demo scenario** on the Dashboard to ingest 12
realistic field-maintenance memories and watch the governor classify them. Then
flip the network toggle in the sidebar to watch the offline path take over.

**Production**

```bash
npm run build             # vite build → dist/public, esbuild → dist/boot.js
npm start                 # NODE_ENV=production node dist/boot.js  (PORT, default 3000)
```

In production the Hono server also serves the built SPA, with a 50 MB request body
limit and an HTML fallback to `index.html` for client-side routes.

**Other scripts**

| Script | Purpose |
| --- | --- |
| `npm run check` | Type-check every project (`tsc -b`) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Vitest (scoped to `api/**/*.test.ts`) |
| `npm run preview` | Preview the production build |
| `npm run db:generate` / `db:migrate` | Versioned Drizzle migrations |

---

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | MySQL connection string (`mysql://user:pass@host:port/db`) |
| `APP_ID` | production | Application identifier |
| `APP_SECRET` | production | Application secret |
| `PORT` | no | Production port, default `3000` |
| `KIMI_AGENTGW_BASE_URL` | for Jev | Platform gateway base URL (includes `/coding/v1`) |
| `KIMI_AGENTGW_API_KEY` | for Jev | Gateway key — **server-side only, never sent to the browser** |

`KIMI_AGENTGW_*` are injected by the platform into the project root `.env`. If
they are missing, EdgeMind does not break: the governor falls back to the
deterministic policy and the answer layer stays extractive. That is the offline
path working as designed, not a degraded mode.

---

## Project layout

```
api/                        Edge runtime (Hono + tRPC)
  boot.ts                   Server entry — dev mount and prod serve in one file
  router.ts                 7 tRPC routers, the whole API surface
  middleware.ts             tRPC init (superjson) — the seam for auth/procedures
  context.ts                Per-request context
  edge/
    governor.ts             Decision layer: Jev online, local policy offline
    search.ts               Hybrid retrieval: dense + BM25 → RRF
    embeddings.ts           Deterministic embedding, tokenize, BM25, hashing
    sync.ts                 Queue drain, conflict detection, 3-way resolution
    ai-client.ts            Platform client: model list + error taxonomy
  lib/
    env.ts                  Typed env access with production guards
    http.ts                 HTTP helpers
    vite.ts                 Production static serving + SPA fallback
  queries/connection.ts     Drizzle client (lazy singleton)

db/
  schema.ts                 5 tables — the data model
  relations.ts              Drizzle relational queries
  seed.ts                   Seed entry point
  migrations/               Generated SQL

contracts/                  Shared types/errors between client and server
src/
  main.tsx                  React root: Router → tRPC/Query providers
  App.tsx                   Route table
  pages/                    Dashboard, Memories, Search, Decisions, Sync, Activity
  components/Layout.tsx     Shell, navigation, NetworkToggle
  components/bits.tsx       Shared primitives: StatCard, ScoreBar, badges, pills
  components/ui/            50 shadcn/ui components
  providers/trpc.tsx        Typed tRPC client + QueryClient
```

---

## Design decisions worth knowing

**Why search is a mutation.** Retrieval mutates retrieval counts, lifecycle state,
freshness, the decision log, and the activity feed. Declaring it a query would
invite caching and replay of an operation whose entire purpose is to record what
happened.

**Why the governor always names its engine.** Every decision row carries
`engine ∈ {jev, local_policy}`. Mixed-engine operation is normal — a device can
spend half a day on local policy and half on Jev — and the dashboard surfaces the
Jev share precisely so that split is visible rather than invisible.

**Why decisions carry rationale and latency.** An autonomous system that cannot
explain itself is unauditable. `decisionRationale` on the memory and `rationale` +
`latencyMs` on the decision row make every automated judgement reviewable after
the fact, and the same string powers the UI.

**Why the cloud LLM is gated behind escalation.** The memory platform must be
useful with zero network. Cloud generation happens only when local context scores
below threshold, the device is online, and the user escalated. Every other path
answers locally.

**Why vectors live on the row.** Storing `dense_vector` and `token_terms` as JSON
keeps retrieval self-contained and keeps the vector store replaceable: point
`embed()` at an on-device model and `hybridSearch()` at Qdrant without touching
the governor, the sync engine, or the API.

**Why retrieval promotes memories.** A memory retrieved five or more times is
promoted from `active` to `promoted`, and freshness grows with every retrieval.
Access frequency is the cheapest available signal of future utility — and unlike
the model's `futureUtility` estimate, it is available offline.

<!-- SPLIT -->
