# Redis Interview Preparation - Time Capsule Messaging System

> **Context:** You built a **Time Capsule Messaging System** where users schedule messages for future delivery. The system uses **Express + SQLite** for the API/DB layer and **BullMQ + Redis** for scheduling delayed message delivery. When a message is created with a future `deliver_at` time, a BullMQ delayed job is added to a Redis queue. A worker processes jobs when they become due -- updating the database and writing to a delivery log.

---

## Table of Contents

1. [Redis Fundamentals](#1-redis-fundamentals)
2. [Redis as a Message Queue / Job Scheduler](#2-redis-as-a-message-queue--job-scheduler)
3. [Scenario-Based Questions (Q&A)](#3-scenario-based-questions-qa)
4. [Redis in Production](#4-redis-in-production)
5. [Why Redis for This Project (Pros & Cons)](#5-why-redis-for-this-project-pros--cons)
6. [Comparison Table](#6-comparison-table)
7. [Architecture Diagram](#7-architecture-diagram)

---

## 1. Redis Fundamentals

### What Is Redis?

Redis (Remote Dictionary Server) is an **open-source, in-memory data structure store**. It can function as a database, cache, message broker, and queue. Unlike traditional databases that store data on disk first, Redis keeps everything in RAM, making reads and writes extraordinarily fast -- typically sub-millisecond.

**Key characteristics:**
- In-memory storage with optional disk persistence
- Rich set of data structures (not just key-value)
- Single-threaded command processing (no lock contention)
- Built-in replication, Lua scripting, transactions, and pub/sub

### Core Data Structures

| Structure    | Description                                         | Example Use Case                               |
|-------------|-----------------------------------------------------|------------------------------------------------|
| **Strings** | Binary-safe strings, up to 512 MB                    | Caching, counters, session tokens              |
| **Lists**    | Ordered collections (linked lists)                  | Job queues, activity feeds, message logs       |
| **Sets**     | Unordered collections of unique strings             | Tags, unique visitors, social graph (friends)  |
| **Sorted Sets (ZSets)** | Sets with a score for ordering               | Leaderboards, **delayed job scheduling**, rate limiting |
| **Hashes**   | Maps of field-value pairs                           | User profiles, object storage, job metadata    |
| **Streams**  | Append-only log structures (like Kafka topics)      | Event sourcing, real-time data pipelines       |

**In your project:** BullMQ primarily uses **sorted sets** (to hold delayed jobs scored by their execution timestamp), **lists** (as the ready-to-process queue), and **hashes** (to store job data and metadata).

### Why Is Redis So Fast?

1. **In-memory storage:** All data lives in RAM. No disk I/O for reads/writes during normal operation. RAM access is ~100 nanoseconds vs ~10 milliseconds for disk -- roughly 100,000x faster.

2. **Single-threaded event loop:** Redis processes commands one at a time on a single thread. This eliminates the need for locks, mutexes, or context switches. There is no lock contention, no deadlocks, and no race conditions at the data level.

3. **I/O multiplexing (epoll/kqueue):** Even though Redis is single-threaded for command execution, it uses OS-level I/O multiplexing to handle thousands of concurrent client connections efficiently. It does not spawn a thread per connection.

4. **Optimized data structures:** Redis uses purpose-built C implementations -- ziplists for small collections, skip lists for sorted sets, simple dynamic strings (SDS) instead of C strings.

5. **No query parsing or optimization:** Unlike SQL databases, there is no query parser, no query planner, no optimizer. Commands map directly to operations on data structures.

**Common interview follow-up: "If Redis is single-threaded, how does it handle concurrent requests?"**

> Redis is single-threaded for **command execution**, but it uses I/O multiplexing (epoll on Linux, kqueue on macOS) to manage thousands of connections concurrently. All incoming commands are serialized into a single execution queue. Since each command executes in microseconds, this serial approach handles 100,000+ operations per second easily. Redis 6+ also introduced **I/O threading** for network read/write (parsing and sending), while command execution remains single-threaded.

### Redis Persistence: RDB vs AOF

Redis offers two persistence mechanisms. Understanding these is critical for interview questions about data loss and restart safety.

#### RDB (Redis Database Snapshots)

**How it works:** Redis periodically takes a point-in-time snapshot of the entire dataset and writes it to a binary `.rdb` file on disk. This is done via `fork()` -- the child process writes the snapshot while the parent continues serving requests.

**Configuration example:**
```
save 900 1      # Snapshot if at least 1 key changed in 900 seconds
save 300 10     # Snapshot if at least 10 keys changed in 300 seconds
save 60 10000   # Snapshot if at least 10000 keys changed in 60 seconds
```

**Pros:**
- Compact single-file backups, easy to transfer and restore
- Very fast restarts (just load the binary file)
- Minimal performance impact during normal operations (child process does the work)
- Great for disaster recovery (copy the .rdb file offsite)

**Cons:**
- **Data loss window:** You can lose all data since the last snapshot (e.g., up to 5 minutes of data)
- `fork()` can be expensive on large datasets (memory doubles momentarily due to copy-on-write)
- Not suitable if you need to minimize data loss to near-zero

#### AOF (Append-Only File)

**How it works:** Redis logs every write operation to an append-only file. On restart, Redis replays the AOF to reconstruct the dataset. The AOF can be configured with different `fsync` policies.

**fsync policies:**
```
appendfsync always    # fsync after every write (safest, slowest)
appendfsync everysec  # fsync once per second (good balance -- DEFAULT)
appendfsync no        # Let the OS decide when to flush (fastest, riskiest)
```

**Pros:**
- Much smaller data loss window (at most 1 second with `everysec`)
- Append-only means no corruption from partial writes
- Human-readable log format (can inspect/edit if needed)
- Automatic AOF rewriting to compact the file

**Cons:**
- Larger file size than RDB (stores every command, not a snapshot)
- Slower restarts (replaying commands vs loading a binary)
- Slightly lower write throughput (especially with `appendfsync always`)

#### When to Use Which

| Scenario                              | Recommendation          |
|---------------------------------------|-------------------------|
| Cache only, data loss is acceptable   | RDB only or no persistence |
| Job queue (your project)              | **AOF (`everysec`) + RDB** |
| Financial/transactional data          | AOF with `always` fsync |
| Development/testing                   | No persistence needed    |
| Need fast backups for DR              | RDB for snapshots        |

**For your Time Capsule project:** Use **both AOF and RDB**. AOF with `appendfsync everysec` ensures you lose at most 1 second of jobs on a crash. RDB provides compact backups. This is Redis's recommended production configuration.

### Redis Eviction Policies

When Redis reaches its configured `maxmemory` limit, it must decide what to do with new write commands. The eviction policy determines which keys get removed.

| Policy              | Description                                                  |
|--------------------|--------------------------------------------------------------|
| `noeviction`        | Return errors on writes when memory is full (default)        |
| `allkeys-lru`       | Evict least recently used keys across all keys               |
| `allkeys-lfu`       | Evict least frequently used keys across all keys             |
| `volatile-lru`      | Evict LRU keys only among keys with an expiry (TTL) set     |
| `volatile-lfu`      | Evict LFU keys only among keys with an expiry set           |
| `allkeys-random`    | Evict random keys across all keys                            |
| `volatile-random`   | Evict random keys among keys with an expiry set              |
| `volatile-ttl`      | Evict keys with the shortest TTL first                       |

**For your Time Capsule project:** You should use `noeviction`. BullMQ job data must never be silently evicted -- losing a delayed job means a message never gets delivered. If memory is running out, you want an error so you can investigate, not silent data loss.

**Interview tip:** If asked "What eviction policy would you use for a cache?" the answer is typically `allkeys-lru` or `allkeys-lfu`. But for a **job queue**, always say `noeviction`.

---

## 2. Redis as a Message Queue / Job Scheduler

### How BullMQ Uses Redis

BullMQ is a Node.js library that implements a robust job queue on top of Redis. Here is how it maps queue concepts to Redis data structures:

```
Redis Key                              Data Structure    Purpose
---------------------------------------------------------------------------
bull:message-delivery:delayed          Sorted Set        Delayed jobs (scored by timestamp)
bull:message-delivery:wait             List              Jobs ready to be processed
bull:message-delivery:active           List              Jobs currently being processed
bull:message-delivery:completed        Set               Successfully completed job IDs
bull:message-delivery:failed           Set               Failed job IDs
bull:message-delivery:{jobId}          Hash              Job data and metadata
bull:message-delivery:meta             Hash              Queue metadata
bull:message-delivery:events           Stream            Event log for the queue
```

**The lifecycle of a delayed job in your system:**

```
1. API receives POST /api/messages with deliver_at = "2026-06-15T10:00:00Z"

2. scheduleDelivery() calculates:
   delay = new Date("2026-06-15T10:00:00Z").getTime() - Date.now()
   // e.g., delay = 8,000,000,000 ms (~3 months)

3. BullMQ adds the job:
   ZADD bull:message-delivery:delayed <timestamp_score> <jobId>
   HSET bull:message-delivery:msg-42 data '{"messageId":42,"recipientEmail":"bob@example.com"}'

4. BullMQ's internal timer polls the sorted set:
   ZRANGEBYSCORE bull:message-delivery:delayed -inf <current_timestamp> LIMIT 0 1

5. When the score (timestamp) <= now, the job is moved:
   ZREM bull:message-delivery:delayed <jobId>
   LPUSH bull:message-delivery:wait <jobId>

6. Worker picks it up:
   BRPOPLPUSH bull:message-delivery:wait bull:message-delivery:active

7. Worker processes the job (updates DB, logs delivery)

8. On success:
   LREM bull:message-delivery:active <jobId>
   (Job removed since removeOnComplete: true)
```

**Your actual code that triggers this flow:**

```javascript
// src/services/queue.js
const { Queue } = require('bullmq');
const { REDIS_URL } = require('../config');

const connection = { url: REDIS_URL };
const deliveryQueue = new Queue('message-delivery', { connection });

async function scheduleDelivery(messageId, recipientEmail, deliverAt) {
  const delay = new Date(deliverAt).getTime() - Date.now();

  await deliveryQueue.add(
    'deliver',
    { messageId, recipientEmail },
    {
      delay: Math.max(delay, 0),       // Delay in milliseconds
      jobId: `msg-${messageId}`,       // Unique job ID prevents duplicates
      removeOnComplete: true,          // Clean up after success
      removeOnFail: false,             // Keep failed jobs for debugging
    }
  );
}
```

```javascript
// src/services/worker.js
const { Worker } = require('bullmq');

function startWorker() {
  const worker = new Worker(
    'message-delivery',
    async (job) => {
      const { messageId, recipientEmail } = job.data;
      const db = getDb();
      const now = new Date().toISOString();

      // Update DB status from 'pending' to 'delivered'
      await db.run(
        'UPDATE messages SET status = ?, delivered_at = ? WHERE id = ? AND status = ?',
        ['delivered', now, messageId, 'pending']
      );

      logDelivery(messageId, recipientEmail);
    },
    { connection: { url: REDIS_URL } }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });
}
```

### Why Redis Over RabbitMQ or Kafka for This Use Case?

| Factor              | Redis + BullMQ                    | RabbitMQ                          | Kafka                              |
|---------------------|-----------------------------------|-----------------------------------|-------------------------------------|
| **Delayed jobs**    | Native via sorted sets -- built in | Requires plugin (delayed exchange) or per-message TTL + dead letter queue | No native support; requires external scheduler |
| **Setup complexity**| Single Redis instance, npm install | Erlang runtime, separate broker    | JVM, ZooKeeper/KRaft, multiple brokers |
| **Latency**         | Sub-millisecond                   | Low milliseconds                   | Low milliseconds (batched)          |
| **Scale**           | Millions of jobs/day easily       | Very high throughput               | Designed for extreme throughput     |
| **Use case fit**    | Delayed tasks, job scheduling     | Complex routing, RPC, enterprise messaging | Event streaming, log aggregation, analytics |
| **Node.js ecosystem** | BullMQ is first-class, mature  | amqplib works but less ergonomic   | kafkajs works but more boilerplate  |
| **Infra you already have** | Already using Redis? Add queues for free | Another server to manage | Another cluster to manage          |

**Bottom line for your project:** You already need Redis for BullMQ. Your use case (delayed delivery of individual messages) is exactly what BullMQ was designed for. RabbitMQ or Kafka would be overkill -- they solve different problems (complex routing and high-throughput event streaming, respectively).

### Redis Pub/Sub vs Streams vs BullMQ -- When to Use Each

| Feature          | Pub/Sub                          | Streams                               | BullMQ (on Redis)                     |
|-----------------|----------------------------------|---------------------------------------|---------------------------------------|
| **Delivery**    | Fire-and-forget (no persistence) | Persistent, consumer groups           | Persistent, acknowledgment, retries   |
| **Message loss** | Lost if no subscriber is listening | Never lost (stored in stream)       | Never lost (stored in sorted set/list)|
| **Ordering**    | Not guaranteed                   | Strict ordering within a stream       | FIFO within a queue, priority support |
| **Delayed jobs** | Not supported                   | Not natively supported                | First-class support                   |
| **Retries**     | No                               | Via consumer group re-reading         | Automatic with backoff strategies     |
| **Consumer groups** | No (all subscribers get all messages) | Yes (built-in)                  | Yes (multiple workers)                |
| **Best for**    | Real-time notifications, chat    | Event sourcing, audit logs            | **Job scheduling, task queues**       |

**Why Pub/Sub would NOT work for your project:** If no worker is listening when a message is published, the message is lost forever. You need guaranteed delivery for scheduled messages.

**Why Streams alone are insufficient:** Streams provide persistence but do not natively support delayed jobs. You would have to build your own delay mechanism on top.

**Why BullMQ is the right choice:** It provides delayed jobs, retries, acknowledgment, priority queues, rate limiting, and concurrency control -- all built on Redis primitives. It is a complete job queue solution.

### How Delayed Jobs Work Internally (ZRANGEBYSCORE Polling)

This is a favorite interview deep-dive question. Here is exactly what happens under the hood:

**Step 1: Job is added with a delay**

When you call `deliveryQueue.add('deliver', data, { delay: 86400000 })` (1 day delay):

```
ZADD bull:message-delivery:delayed 1710460800000 msg-42
                                    ^-- score = Date.now() + delay (Unix ms)
```

The job is stored in a sorted set where the **score is the Unix timestamp (in milliseconds)** when the job should become ready.

**Step 2: BullMQ polls the sorted set**

BullMQ runs an internal timer that executes a Lua script approximately every 5 seconds (configurable). The Lua script does:

```lua
-- Simplified version of what BullMQ does internally
local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
--                                                        ^-- current timestamp
for i, jobId in ipairs(jobs) do
    redis.call('ZREM', KEYS[1], jobId)                    -- Remove from delayed set
    redis.call('LPUSH', KEYS[2], jobId)                   -- Push to wait list
end
return #jobs
```

This atomically (via Lua script) moves all jobs whose score is <= the current timestamp from the `delayed` sorted set to the `wait` list.

**Step 3: Worker picks up the job**

The worker uses `BRPOPLPUSH` (blocking pop) on the `wait` list. As soon as a job appears, the worker grabs it and moves it to the `active` list:

```
BRPOPLPUSH bull:message-delivery:wait bull:message-delivery:active 5
```

This is a blocking operation, so the worker does not burn CPU polling. It sleeps until a job arrives.

**Why this design is elegant:**
- **Sorted sets** give O(log N) insertion and O(log N + M) range queries -- efficient even with millions of delayed jobs
- **Lua scripts** make the check-and-move atomic -- no race conditions
- **Blocking pops** on lists mean zero CPU waste while waiting for ready jobs
- The polling interval (~5 seconds) is a minor trade-off but negligible for most use cases

---

## 3. Scenario-Based Questions (Q&A)

### Q1: "What happens if Redis goes down while there are pending jobs?"

**Answer:**

It depends on your persistence configuration.

**With no persistence (default):** All jobs are lost. Every pending and delayed job in the queue disappears. Your database would still have messages with `status: 'pending'`, but no corresponding BullMQ jobs to deliver them. Those messages would never be delivered.

**With RDB snapshots only:** You lose all jobs added since the last snapshot. If Redis snapshots every 5 minutes, you could lose up to 5 minutes of recently scheduled jobs.

**With AOF (`appendfsync everysec`):** You lose at most ~1 second of data. When Redis restarts, it replays the AOF and reconstructs the queue state. Almost all jobs survive.

**With AOF (`appendfsync always`):** Zero data loss. Every write is fsynced immediately. But this has a significant performance cost.

**How to make your system resilient regardless:**

```javascript
// Recovery script: find messages in DB that are 'pending' but have no BullMQ job
async function recoverOrphanedMessages() {
  const db = getDb();
  const pending = await db.all(
    "SELECT id, recipient_email, deliver_at FROM messages WHERE status = 'pending'"
  );

  for (const msg of pending) {
    const exists = await deliveryQueue.getJob(`msg-${msg.id}`);
    if (!exists) {
      console.log(`Re-scheduling orphaned message ${msg.id}`);
      await scheduleDelivery(msg.id, msg.recipient_email, msg.deliver_at);
    }
  }
}
```

**Key interview point:** The database is the source of truth. Redis is the execution engine. If they ever get out of sync, you reconcile from the database.

---

### Q2: "What happens if the worker crashes mid-job?"

**Answer:**

BullMQ handles this through its **stalled job detection** mechanism.

When a worker picks up a job, the job moves from the `wait` list to the `active` list. The worker must periodically send a "heartbeat" (by extending a lock). If the worker crashes:

1. The job remains in the `active` list with a lock
2. BullMQ's stalled job checker (running on other workers or the queue instance) detects that the lock has expired
3. The job is automatically moved back to the `wait` list
4. Another worker picks it up and retries

**In your specific code, what could go wrong mid-job:**

```javascript
async (job) => {
  const { messageId, recipientEmail } = job.data;
  const db = getDb();
  const now = new Date().toISOString();

  // Crash here? DB not updated, job retried -- safe
  await db.run(
    'UPDATE messages SET status = ?, delivered_at = ? WHERE id = ? AND status = ?',
    ['delivered', now, messageId, 'pending']
  );

  // Crash here? DB updated but log not written -- job retried
  // But the WHERE status = 'pending' guard prevents double-update
  logDelivery(messageId, recipientEmail);
}
```

**Your code is already idempotent** because of `WHERE id = ? AND status = ?`. If the job is retried after the DB was already updated, the UPDATE affects 0 rows (status is already 'delivered'), and the log gets an extra entry at worst. This is a good pattern.

**Configuration for stalled job handling:**

```javascript
const worker = new Worker('message-delivery', processor, {
  connection: { url: REDIS_URL },
  stalledInterval: 30000,   // Check for stalled jobs every 30 seconds
  maxStalledCount: 2,       // Move to failed after 2 stalls (not infinite retries)
});
```

---

### Q3: "How would you handle 1 million scheduled messages?"

**Answer:**

Redis and BullMQ can handle this, but you need to think about several dimensions:

**Memory estimation:**
- Each BullMQ job takes roughly 1-2 KB in Redis (job data hash + sorted set entry)
- 1 million jobs = ~1-2 GB of RAM
- A typical Redis instance with 8 GB can handle this easily

**Performance considerations:**

1. **Sorted set operations remain fast:** ZADD and ZRANGEBYSCORE are O(log N). With 1 million entries, that is ~20 comparisons. Still sub-millisecond.

2. **Batch polling:** BullMQ's Lua script grabs multiple ready jobs per poll cycle, so a burst of due jobs does not create a bottleneck.

3. **Multiple workers:** Scale horizontally by running multiple worker processes:

```javascript
// Run 4 concurrent jobs per worker
const worker = new Worker('message-delivery', processor, {
  connection: { url: REDIS_URL },
  concurrency: 10,  // Process 10 jobs simultaneously per worker instance
});

// Deploy multiple worker processes/containers for horizontal scaling
```

4. **Bulk insertion:** If adding 1 million jobs at once, use BullMQ's bulk add:

```javascript
const jobs = messages.map((msg) => ({
  name: 'deliver',
  data: { messageId: msg.id, recipientEmail: msg.recipientEmail },
  opts: {
    delay: new Date(msg.deliverAt).getTime() - Date.now(),
    jobId: `msg-${msg.id}`,
  },
}));

// Add in batches of 1000 to avoid blocking Redis
for (let i = 0; i < jobs.length; i += 1000) {
  await deliveryQueue.addBulk(jobs.slice(i, i + 1000));
}
```

5. **Redis Cluster:** For truly massive scale (10M+ jobs), use Redis Cluster to distribute the keyspace across multiple nodes. BullMQ supports Redis Cluster via ioredis.

6. **Monitor memory:** Set up alerts when Redis memory usage exceeds 70% of available RAM.

**Things that could go wrong at scale:**
- Redis running out of memory (set `maxmemory` and use `noeviction`)
- Worker processing slower than jobs becoming due (add more workers)
- Network bandwidth between workers and Redis (co-locate them)

---

### Q4: "What if two workers pick up the same job?"

**Answer:**

**This cannot happen with BullMQ.** Here is why:

BullMQ uses Redis's atomic operations to ensure exclusive job ownership. When a worker fetches a job, it uses a Lua script that atomically:

1. Pops the job from the `wait` list
2. Pushes it to the `active` list
3. Sets a lock key with the worker's unique ID and a TTL

```lua
-- Simplified: this runs atomically in Redis
local jobId = redis.call('RPOPLPUSH', waitKey, activeKey)
redis.call('SET', lockKey .. jobId, workerId, 'PX', lockDuration)
```

Since Redis is single-threaded, this Lua script executes atomically. No two workers can pop the same job. The `RPOPLPUSH` is itself atomic -- it removes and returns in one operation.

**Even in a multi-worker, multi-server setup:** Redis guarantees that `RPOPLPUSH` (or `LMOVE` in Redis 6.2+) is atomic. One and only one worker gets the job.

**Additionally, your code has an application-level safeguard:**

```sql
UPDATE messages SET status = ?, delivered_at = ? WHERE id = ? AND status = ?
-- The WHERE status = 'pending' clause means even if (hypothetically)
-- two workers processed the same message, only the first UPDATE would
-- affect any rows.
```

---

### Q5: "How does BullMQ guarantee at-least-once delivery?"

**Answer:**

BullMQ provides **at-least-once** delivery (not exactly-once) through several mechanisms:

1. **Persistence:** Jobs are stored in Redis (with persistence configured). They survive process restarts.

2. **Acknowledgment pattern:** A job is only removed from the queue after the worker's processor function completes successfully (resolves the Promise). If the function throws an error or the worker crashes, the job is NOT acknowledged.

3. **Stalled job recovery:** If a worker takes a job but dies before completing it, the stalled job checker detects the expired lock and moves the job back to the `wait` queue for reprocessing.

4. **Automatic retries:** Failed jobs can be retried with configurable backoff:

```javascript
await deliveryQueue.add('deliver', data, {
  delay: delay,
  jobId: `msg-${messageId}`,
  attempts: 3,                           // Retry up to 3 times
  backoff: {
    type: 'exponential',                 // Exponential backoff
    delay: 5000,                         // Starting at 5 seconds
  },
});
```

5. **Failed job preservation:** Your config has `removeOnFail: false`, meaning failed jobs are kept in the `failed` set for inspection and manual retry.

**Why not exactly-once?**

Exactly-once delivery is impossible in distributed systems (this is a well-known theoretical result). Consider: the worker processes the job and updates the DB, but crashes before it can ACK the job back to Redis. Redis will retry the job, and the DB gets updated again. This is why **idempotent job processing** is essential -- your code already handles this with the `WHERE status = 'pending'` guard.

**Interview talking point:** "At-least-once delivery is the practical standard for job queues. We achieve effectively-once behavior by making our workers idempotent."

---

### Q6: "What if a delayed job's delay is very long (e.g., 1 year)?"

**Answer:**

This is a realistic scenario for your Time Capsule system -- someone might schedule a message for next year's birthday.

**Technically, it works fine:**
- BullMQ stores the job in a Redis sorted set with the target timestamp as the score
- The delay value is in milliseconds: 1 year = ~31,536,000,000 ms
- JavaScript's `Number` can safely represent integers up to 2^53 (9,007,199,254,740,992), so overflow is not a concern
- The sorted set does not care how far in the future the score is -- it just stores a number

**Practical concerns:**

1. **Redis memory:** The job occupies memory for an entire year. For individual jobs, this is negligible (~1-2 KB). For millions of year-long jobs, it adds up.

2. **Redis restarts:** Over a year, Redis will likely restart (updates, hardware maintenance). With proper persistence (AOF + RDB), the job survives restarts.

3. **Redis data corruption/loss:** Over long periods, the probability of data issues increases. Mitigations:
   - Redis replication (master-replica)
   - Regular RDB backups stored offsite
   - The reconciliation script (compare DB pending messages vs Redis jobs)

4. **Code/schema changes:** Over a year, your application might change. The job payload (`{ messageId, recipientEmail }`) must remain compatible with whatever worker version processes it.

5. **Better approach for very long delays:**

```javascript
// Instead of a single long delay, re-schedule in shorter intervals
async function scheduleDelivery(messageId, recipientEmail, deliverAt) {
  const delay = new Date(deliverAt).getTime() - Date.now();
  const MAX_DELAY = 7 * 24 * 60 * 60 * 1000; // 7 days

  if (delay > MAX_DELAY) {
    // Schedule a "check-in" job for 7 days from now
    await deliveryQueue.add(
      'reschedule-check',
      { messageId, recipientEmail, deliverAt },
      { delay: MAX_DELAY, jobId: `msg-${messageId}` }
    );
  } else {
    // Schedule the actual delivery
    await deliveryQueue.add(
      'deliver',
      { messageId, recipientEmail },
      { delay: Math.max(delay, 0), jobId: `msg-${messageId}` }
    );
  }
}
```

This "rolling delay" approach reduces the risk of a single long-lived job getting lost, and it naturally survives Redis restarts because the job is re-evaluated every 7 days.

---

### Q7: "How would you monitor Redis queue health in production?"

**Answer:**

**BullMQ built-in metrics:**

```javascript
const { Queue } = require('bullmq');
const deliveryQueue = new Queue('message-delivery', { connection });

// Get queue job counts
const counts = await deliveryQueue.getJobCounts(
  'waiting', 'active', 'delayed', 'failed', 'completed'
);
console.log(counts);
// { waiting: 5, active: 2, delayed: 1523, failed: 3, completed: 0 }
```

**Health check endpoint (add to your Express app):**

```javascript
app.get('/health/queue', async (req, res) => {
  try {
    const counts = await deliveryQueue.getJobCounts(
      'waiting', 'active', 'delayed', 'failed'
    );

    const isHealthy = counts.failed < 100 && counts.waiting < 10000;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      queue: counts,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});
```

**Redis-level monitoring:**

```bash
# Memory usage
redis-cli INFO memory
# used_memory_human: 1.2G
# maxmemory_human: 4G

# Connected clients
redis-cli INFO clients

# Operations per second
redis-cli INFO stats
# instantaneous_ops_per_sec: 1523

# Slow queries
redis-cli SLOWLOG GET 10
```

**Dashboard solutions:**
- **Bull Board** (open source) -- web UI for BullMQ queues
- **Redis Insight** (free from Redis Labs) -- GUI for Redis monitoring
- **Prometheus + Grafana** -- export Redis metrics via `redis_exporter`

**Key metrics to alert on:**
| Metric                     | Warning Threshold | Action                          |
|---------------------------|-------------------|---------------------------------|
| Failed job count           | > 10              | Investigate job processor errors |
| Waiting queue length       | > 1000            | Scale up workers                |
| Redis memory usage         | > 70% of max      | Increase memory or clean up     |
| Redis connected clients    | > 80% of limit    | Check for connection leaks      |
| Stalled job count          | > 0               | Check worker health             |

---

### Q8: "What happens on server restart -- are jobs lost?"

**Answer:**

**No, jobs are NOT lost** (assuming Redis persistence is configured). This is one of the key advantages of using BullMQ + Redis over in-process alternatives like `setTimeout`.

Here is what happens during a server restart:

1. **Node.js process stops:** The BullMQ worker disconnects. Any job it was actively processing becomes "stalled."

2. **Redis continues running independently:** Redis is a separate process/server. All delayed jobs, waiting jobs, and job data remain intact in Redis memory (and persisted to disk via AOF/RDB).

3. **Node.js process restarts:**
   - `startWorker()` is called in `main()` (your `index.js`)
   - The new worker connects to Redis and starts polling for jobs
   - Any stalled jobs from the crashed worker are detected and re-queued
   - Delayed jobs continue to become ready on schedule

**Contrast with `setTimeout`:**

```javascript
// BAD: Jobs lost on restart
setTimeout(() => deliverMessage(id), delay);
// This timer lives in Node.js process memory.
// If the process restarts, the timer is gone forever.

// GOOD: Jobs survive restart (your approach)
await deliveryQueue.add('deliver', data, { delay });
// This job lives in Redis, independent of the Node.js process.
```

**The only scenario where jobs are lost on restart:**
- Redis itself crashes AND has no persistence configured (or only RDB with a large snapshot interval and the crash happens between snapshots)

---

### Q9: "How would you handle Redis memory running out?"

**Answer:**

**Prevention:**

1. **Set a `maxmemory` limit** so Redis does not consume all system RAM and trigger the OS OOM killer:
   ```
   maxmemory 4gb
   maxmemory-policy noeviction
   ```

2. **Clean up completed/failed jobs:**
   ```javascript
   // Your config already does this for completed jobs:
   removeOnComplete: true

   // For failed jobs, set a retention limit:
   removeOnFail: { count: 1000 }  // Keep only last 1000 failed jobs
   // Or time-based:
   removeOnFail: { age: 7 * 24 * 3600 }  // Keep failed jobs for 7 days
   ```

3. **Monitor and alert** at 70% memory usage (see Q7).

**When memory is actually full (with `noeviction` policy):**

- Redis returns `OOM` errors on write commands
- BullMQ's `add()` will throw an error
- Your API's `POST /api/messages` will catch this and return a 500 error
- Existing delayed jobs continue to be processed (reads still work)
- As jobs are processed and removed, memory is freed

**Emergency response:**

```javascript
// 1. Drain failed jobs (they have removeOnFail: false in your config)
await deliveryQueue.clean(0, 0, 'failed');  // Remove all failed jobs

// 2. Check for stuck/stalled jobs
const stalled = await deliveryQueue.getStalled();
console.log(`${stalled.length} stalled jobs found`);

// 3. If needed, identify and remove very old delayed jobs
const delayed = await deliveryQueue.getDelayed(0, 100);
for (const job of delayed) {
  if (job.timestamp < Date.now() - 365 * 24 * 3600 * 1000) {
    await job.remove();  // Remove jobs older than 1 year
  }
}
```

**Scaling solution:** If you consistently need more memory, either:
- Increase the Redis instance size (vertical scaling)
- Move to Redis Cluster (horizontal scaling -- shard data across nodes)
- Offload old/completed data to a database and keep Redis lean

---

### Q10: "What if delivery needs to happen at exact millisecond precision?"

**Answer:**

**BullMQ cannot guarantee exact millisecond precision.** Here is why:

1. **Polling interval:** BullMQ checks the delayed sorted set approximately every 5 seconds (configurable). So a job due at exactly `T` might not be detected until `T + 5000ms`.

2. **Worker pickup latency:** After the job moves from `delayed` to `wait`, a worker must pick it up. Under load, there could be other jobs ahead in the queue.

3. **Processing time:** Your worker needs to execute the DB update and logging, which takes additional milliseconds.

**Realistic precision:**

| Configuration                     | Typical Precision   |
|----------------------------------|---------------------|
| Default BullMQ settings          | +0 to +5 seconds    |
| With custom `drainDelay: 100`    | +0 to +100 ms       |
| Under heavy load                 | +0 to +30 seconds   |

**Improving precision (if needed):**

```javascript
// Reduce the polling interval (at the cost of more Redis commands)
const worker = new Worker('message-delivery', processor, {
  connection: { url: REDIS_URL },
  drainDelay: 100,  // Check every 100ms instead of default 5000ms
});
```

**For your Time Capsule project:** Millisecond precision is not needed. A message scheduled for "June 15, 2026 at 10:00 AM" being delivered at 10:00:03 AM is perfectly acceptable. Users would not notice or care about a few seconds of variance.

**If you truly needed sub-second precision** (e.g., financial trading, real-time auctions), you would not use a queue at all. You would use:
- Redis's `WAIT` command with sorted sets and a tight poll loop
- OS-level high-resolution timers
- A purpose-built real-time scheduler

---

## 4. Redis in Production

### Redis Cluster vs Sentinel -- When to Use Which

#### Redis Sentinel (High Availability)

**What it does:** Monitors Redis master and replicas. Automatically promotes a replica to master if the master fails (automatic failover).

```
                     +----------+
                     | Sentinel |
                     |  (x3)    |
                     +----+-----+
                          |
              +-----------+-----------+
              |                       |
         +----+----+            +----+----+
         |  Master |  ------->  | Replica |
         |  (R/W)  |  replication  (R/O)  |
         +---------+            +---------+
```

**When to use:**
- Your dataset fits in a single Redis instance (< 25 GB typically)
- You need high availability (automatic failover)
- Read replicas can help distribute read load
- You want a simpler setup than Cluster

**Configuration:**
```
# sentinel.conf
sentinel monitor mymaster 192.168.1.10 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
```

#### Redis Cluster (Horizontal Scaling + HA)

**What it does:** Distributes data across multiple Redis nodes using hash slots (16,384 slots). Each node owns a subset of slots. Provides both sharding and high availability.

```
    +--------+     +--------+     +--------+
    | Node A |     | Node B |     | Node C |
    | Slots  |     | Slots  |     | Slots  |
    | 0-5460 |     |5461-10922|   |10923-16383|
    +---+----+     +---+----+     +---+----+
        |              |              |
    +---+----+     +---+----+     +---+----+
    |Replica |     |Replica |     |Replica |
    |  A'    |     |  B'    |     |  C'    |
    +--------+     +--------+     +--------+
```

**When to use:**
- Dataset is too large for a single instance
- You need to scale writes horizontally
- You need both HA and sharding
- Millions of operations per second

**BullMQ with Redis Cluster:**

```javascript
const Redis = require('ioredis');

const connection = new Redis.Cluster([
  { host: '192.168.1.10', port: 6379 },
  { host: '192.168.1.11', port: 6379 },
  { host: '192.168.1.12', port: 6379 },
]);

const deliveryQueue = new Queue('message-delivery', { connection });
```

**Important caveat:** BullMQ requires all keys for a queue to be on the same Redis Cluster node. It uses `{queue-name}` hash tags in key names to ensure this. This means a single queue does not horizontally scale across cluster nodes -- but you can create multiple queues and distribute them.

#### Decision Table

| Factor                       | Sentinel                    | Cluster                      |
|-----------------------------|-----------------------------|------------------------------|
| Data size                    | < 25 GB                     | > 25 GB or need to scale     |
| Failover                    | Automatic                   | Automatic                    |
| Write scaling               | Single master only          | Sharded across nodes         |
| Complexity                  | Moderate                    | High                         |
| BullMQ compatibility        | Full                        | Full (with hash tags)        |
| **Your project (small-medium)** | **Recommended**        | Overkill unless very large   |

### Redis Memory Management and Monitoring

**Key commands:**

```bash
# Overview of memory usage
redis-cli INFO memory

# Key metrics to watch:
# used_memory          -- total bytes used by Redis
# used_memory_rss      -- bytes as seen by the OS (includes fragmentation)
# mem_fragmentation_ratio -- rss/used_memory (ideally 1.0-1.5)
# maxmemory            -- configured limit

# Find the biggest keys
redis-cli --bigkeys

# Memory usage of a specific key
redis-cli MEMORY USAGE "bull:message-delivery:delayed"

# Number of keys
redis-cli DBSIZE
```

**Memory optimization tips:**
- Set `maxmemory` to 75% of available RAM (leave room for OS, forks, fragmentation)
- Use `removeOnComplete: true` to clean up finished jobs (you already do this)
- Set retention limits on failed jobs
- Monitor `mem_fragmentation_ratio` -- if it is > 1.5, consider restarting Redis to defragment
- Use `OBJECT ENCODING key` to verify Redis is using memory-efficient encodings

### Connection Pooling with ioredis

BullMQ uses ioredis under the hood. Understanding connection management is important.

**How BullMQ uses connections:**

```javascript
// Each Queue instance creates 1 connection
const queue = new Queue('message-delivery', { connection });  // 1 connection

// Each Worker creates 2 connections (one for commands, one for blocking)
const worker = new Worker('message-delivery', fn, { connection });  // 2 connections
```

**Connection pooling for custom Redis usage:**

```javascript
const Redis = require('ioredis');

// Single shared connection (fine for most cases)
const redis = new Redis(process.env.REDIS_URL);

// Connection pool for high-throughput scenarios
const Redis = require('ioredis');

// ioredis does not have built-in pooling, but you can use generic-pool
const genericPool = require('generic-pool');

const redisPool = genericPool.createPool({
  create: () => new Redis(process.env.REDIS_URL),
  destroy: (client) => client.disconnect(),
}, {
  min: 2,
  max: 10,
});

// Usage
const client = await redisPool.acquire();
await client.get('key');
await redisPool.release(client);
```

**Best practices:**
- Reuse connections; do not create a new one per request
- Set appropriate `maxRetriesPerRequest` (BullMQ sets this to `null` for workers)
- Handle connection errors gracefully:

```javascript
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,  // Required by BullMQ
  enableReadyCheck: true,
  retryStrategy: (times) => {
    if (times > 10) return null;  // Stop retrying after 10 attempts
    return Math.min(times * 200, 5000);  // Exponential backoff, max 5s
  },
});

connection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

connection.on('connect', () => {
  console.log('Redis connected');
});
```

### Redis Security

**1. Authentication (AUTH):**
```
# redis.conf
requirepass your-strong-password-here

# Or with ACL (Redis 6+):
user worker +@queue +@read ~bull:* on >worker-password
user admin ~* &* +@all on >admin-password
```

```javascript
// In your app
const connection = { url: 'redis://:your-password@redis-host:6379' };
// Or
const connection = new Redis({
  host: 'redis-host',
  port: 6379,
  password: 'your-strong-password-here',
});
```

**2. TLS encryption:**
```javascript
const connection = new Redis({
  host: 'redis-host',
  port: 6380,
  tls: {
    ca: fs.readFileSync('ca.crt'),
    cert: fs.readFileSync('client.crt'),
    key: fs.readFileSync('client.key'),
  },
});
```

**3. Network isolation:**
- Bind Redis to private IPs only: `bind 127.0.0.1 10.0.0.5`
- Use firewall rules to restrict access to Redis port (6379)
- Deploy Redis in a private subnet (VPC)
- Disable dangerous commands: `rename-command FLUSHALL ""`

**4. Do not expose Redis to the internet.** Ever. Redis was designed for trusted networks.

### Common Pitfalls

**1. Blocking commands on production Redis:**
```bash
# NEVER run these on production:
KEYS *              # O(N) -- scans entire keyspace, blocks everything
FLUSHALL            # Deletes everything
DEBUG SLEEP 10      # Blocks Redis for 10 seconds

# Use SCAN instead of KEYS:
SCAN 0 MATCH "bull:*" COUNT 100   # Non-blocking, iterative
```

**2. Big keys:**
A single key with millions of elements (e.g., a list with 10M items) causes:
- Slow operations on that key
- Memory fragmentation when deleted
- Replication delays

**Mitigation:** Shard large structures across multiple keys.

**3. Hot keys:**
A single key being accessed by thousands of clients simultaneously. Even though Redis is fast, this can create a bottleneck.

**Mitigation:** Read replicas, local caching, or key sharding.

**4. Not setting `maxmemory`:**
Without a limit, Redis will consume all available RAM and the OS will kill it (OOM killer).

**5. Forgetting `maxRetriesPerRequest: null` for BullMQ:**
ioredis defaults to retrying 20 times and then throwing. BullMQ workers need infinite retries (reconnect forever). Without this setting, your worker dies after a brief Redis blip.

**6. Storing large payloads in job data:**
```javascript
// BAD: Storing the full message in the job
await queue.add('deliver', {
  messageId: 42,
  recipientEmail: 'bob@example.com',
  fullMessage: '... 500 chars of message text ...',  // Wastes Redis memory
});

// GOOD: Store only references (your approach)
await queue.add('deliver', {
  messageId: 42,           // Look up the message from DB when processing
  recipientEmail: 'bob@example.com',
});
```

---

## 5. Why Redis for This Project (Pros & Cons)

### Pros

| Advantage               | Explanation                                                                                       |
|--------------------------|--------------------------------------------------------------------------------------------------|
| **Restart-safe**         | Jobs are persisted in Redis, not in Node.js process memory. Server restarts do not lose jobs.   |
| **No polling overhead**  | Unlike a cron approach that queries the DB every minute for due messages, BullMQ uses efficient sorted sets and blocking pops. Near-zero CPU waste. |
| **Precise timing**       | Jobs are scheduled to the millisecond. While not perfectly precise (see Q10), it is far more accurate than a cron job running every minute. |
| **Horizontally scalable**| Add more workers to process more jobs. Add Redis Cluster for more storage. No code changes needed. |
| **Battle-tested**        | BullMQ is used in production by thousands of companies. It handles edge cases (stalled jobs, retries, backoff) that you would spend months building yourself. |
| **Separation of concerns**| The API server schedules jobs; the worker processes them. They can be deployed and scaled independently. |
| **Built-in retry logic** | Failed jobs are automatically retried with configurable backoff. No custom retry logic needed. |
| **Monitoring/observability** | BullMQ provides job counts, events, and integrates with dashboards like Bull Board. |

### Cons

| Disadvantage                | Explanation                                                                                   |
|-----------------------------|-----------------------------------------------------------------------------------------------|
| **Extra infrastructure**    | You need a Redis server running alongside your Node.js app and SQLite database. More moving parts = more things to maintain. |
| **Cost at scale**            | Redis requires RAM, which is more expensive than disk. A large queue (millions of jobs) can require a significant Redis instance. |
| **Not a true database**     | Redis is not a replacement for your SQLite database. If Redis loses data, you need a reconciliation mechanism. The DB is the source of truth. |
| **Data loss risk**           | Without proper persistence config (AOF + RDB), a Redis crash means lost jobs. Default Redis config does NOT persist aggressively enough for job queues. |
| **Complexity for small scale** | If you only have 10 messages per day, a simple cron job polling the database every minute would work just as well with zero additional infrastructure. |
| **Operational knowledge**    | Your team needs to understand Redis operations -- memory management, persistence, monitoring, failover. |
| **Single point of failure**  | Without Sentinel or Cluster, Redis is a single point of failure. If it goes down, no messages get delivered until it comes back. |

### When Would You NOT Use Redis for This?

- **Very small scale (< 100 messages/day):** A cron job polling the DB every minute is simpler and sufficient.
- **Very long delays only (years):** A daily cron job checking for due messages is more robust than keeping a job in Redis for years.
- **No tolerance for data loss:** If every message MUST be delivered and you cannot accept even 1 second of potential loss, you need a transactional system where the job and the message are committed atomically in the same database.
- **Cannot run Redis:** Some hosting environments (shared hosting, restrictive PaaS) do not support Redis.

---

## 6. Comparison Table

### Job Scheduling Approaches Compared

```
+------------------+------------+------------+---------------+-------------+------------+
|                  | setTimeout | Cron       | Redis +       | RabbitMQ    | Kafka      |
|                  | (in-proc)  | Polling    | BullMQ        |             |            |
+==================+============+============+===============+=============+============+
| Survives         |     No     |    Yes     |     Yes       |     Yes     |     Yes    |
| restart?         |            | (DB-based) |  (persisted)  |             |            |
+------------------+------------+------------+---------------+-------------+------------+
| Precision        |   ~1ms     |   ~1min    |    ~5sec      |  ~1sec      |   ~1sec    |
|                  |            |  (1s min)  |  (tunable)    |             |            |
+------------------+------------+------------+---------------+-------------+------------+
| Delayed job      |  Built-in  | DB query   |   Built-in    | Plugin/     |    No      |
| support          | (process   | per tick   |  (sorted set) | workaround  | (external) |
|                  |  memory)   |            |               |             |            |
+------------------+------------+------------+---------------+-------------+------------+
| Scalability      |   Single   |  Limited   |    High       |   Very      |  Extreme   |
|                  |  process   | (DB load)  |  (workers +   |   High      |  (millions |
|                  |            |            |   cluster)    |             |  msg/sec)  |
+------------------+------------+------------+---------------+-------------+------------+
| Retry logic      |    None    |   Manual   |   Built-in    |  Built-in   |  Manual    |
|                  |            |            | (exp backoff) | (DLQ, nack) |            |
+------------------+------------+------------+---------------+-------------+------------+
| Infra needed     |   None     |   None     |    Redis      | RabbitMQ    | Kafka +    |
|                  |            |  (uses DB) |   server      |  server     | ZK/KRaft   |
+------------------+------------+------------+---------------+-------------+------------+
| Complexity       |  Trivial   |   Low      |   Medium      |   High      |   High     |
+------------------+------------+------------+---------------+-------------+------------+
| Monitoring       |   None     |  Custom    |  Bull Board,  | Management  | Kafka UI,  |
|                  |            |            |  Redis tools  |  plugin     | Grafana    |
+------------------+------------+------------+---------------+-------------+------------+
| At-least-once    |    No      |    Yes     |     Yes       |    Yes      |    Yes     |
| delivery?        |            | (if coded) |  (automatic)  |             |            |
+------------------+------------+------------+---------------+-------------+------------+
| Best for         | Prototypes | Small apps | Medium-large  | Enterprise  | Event      |
|                  | demos      | low volume | job queues    | messaging   | streaming  |
|                  |            |            | YOUR PROJECT  | complex     | analytics  |
|                  |            |            |               | routing     | high vol   |
+------------------+------------+------------+---------------+-------------+------------+
```

### Decision Guide

**Choose `setTimeout`** when: You are prototyping and do not care about reliability.

**Choose Cron Polling** when: You have < 100 jobs/day, no Redis available, and a simple DB with a `deliver_at` column. Run a cron job every minute:
```javascript
// Simple cron approach (no Redis needed)
cron.schedule('* * * * *', async () => {
  const db = getDb();
  const due = await db.all(
    "SELECT * FROM messages WHERE status = 'pending' AND deliver_at <= datetime('now')"
  );
  for (const msg of due) {
    await deliver(msg);
    await db.run("UPDATE messages SET status = 'delivered' WHERE id = ?", [msg.id]);
  }
});
```

**Choose Redis + BullMQ** (your choice) when: You need reliable, scalable, delayed job processing with retries, monitoring, and reasonable precision. This is the sweet spot for most web applications.

**Choose RabbitMQ** when: You need complex routing (topic exchanges, header-based routing), RPC patterns, or enterprise messaging features. Not ideal for delayed jobs.

**Choose Kafka** when: You need to process millions of events per second, need event replay capability, or are building data pipelines. Overkill for a job queue.

---

## 7. Architecture Diagram

### System Overview

```
+---------------------------+         +---------------------------+
|       CLIENT              |         |        EXPRESS API         |
|  (Postman / Frontend)     |         |       (src/index.js)      |
|                           |         |                           |
|  POST /api/messages       |         |  +---------------------+ |
|  {                        | ------> |  | POST /api/messages  | |
|    recipient_email,       |  HTTP   |  | (src/routes/        | |
|    message,               |         |  |  messages.js)       | |
|    deliver_at             |         |  +----+----------+-----+ |
|  }                        |         |       |          |        |
+---------------------------+         +-------+----------+--------+
                                              |          |
                                    (1) Save  |          | (2) Schedule
                                     to DB    |          |  delayed job
                                              v          v
                              +----------+    +-------------------+
                              |  SQLite  |    |   REDIS SERVER    |
                              |  (DB)    |    |   (port 6379)     |
                              |          |    |                   |
                              | messages |    | +---------------+ |
                              | table:   |    | | Sorted Set    | |
                              | id       |    | | (delayed jobs)| |
                              | user_id  |    | | score=deliver | |
                              | message  |    | | timestamp     | |
                              | status   |    | +-------+-------+ |
                              | deliver_ |    |         |         |
                              |   at     |    |    (3) When       |
                              +----+-----+    |    score <= now   |
                                   ^          |    move to wait   |
                                   |          |         |         |
                                   |          | +-------v-------+ |
                                   |          | | List          | |
                                   |          | | (ready jobs)  | |
                                   |          | +-------+-------+ |
                                   |          +---------+---------+
                                   |                    |
                                   |        (4) BRPOPLPUSH
                                   |         (worker picks up)
                                   |                    |
                                   |          +---------v---------+
                                   |          |   BULLMQ WORKER   |
                                   |          | (src/services/    |
                                   |          |  worker.js)       |
                                   |          |                   |
                             (5) UPDATE       |  async (job) => { |
                              status =        |   // update DB    |
                             'delivered'      |   // write log    |
                                   |          |  }                |
                                   +--------- +--------+----------+
                                                       |
                                                 (6) Append
                                                  to log file
                                                       |
                                                       v
                                              +--------+--------+
                                              |  DELIVERY LOG   |
                                              | logs/delivery   |
                                              |   .log          |
                                              |                 |
                                              | [timestamp]     |
                                              | Delivered msg   |
                                              | 42 to           |
                                              | bob@example.com |
                                              +-----------------+
```

### Detailed Flow (Step by Step)

```
TIMELINE OF A SCHEDULED MESSAGE
================================

User creates message at 10:00 AM, deliver_at = 3:00 PM (5 hours later)

10:00:00.000  POST /api/messages
              |
              +---> SQLite: INSERT INTO messages (status='pending', deliver_at='15:00:00')
              |     Returns: message id = 42
              |
              +---> Redis:  ZADD bull:message-delivery:delayed 1710507600000 msg-42
              |             HSET bull:message-delivery:msg-42 data '{"messageId":42,...}'
              |
              +---> HTTP 201: { id: 42, status: "pending", deliver_at: "15:00:00" }

10:00:05.000  BullMQ timer: ZRANGEBYSCORE delayed -inf 1710489605000 --> empty
10:00:10.000  BullMQ timer: ZRANGEBYSCORE delayed -inf 1710489610000 --> empty
...           (continues polling every ~5 seconds, always empty)
...           (Redis CPU usage: near zero -- just a sorted set lookup)

14:59:55.000  BullMQ timer: ZRANGEBYSCORE delayed -inf 1710507595000 --> empty

15:00:00.000  BullMQ timer: ZRANGEBYSCORE delayed -inf 1710507600000 --> ["msg-42"]
              |
              +---> Lua script (atomic):
                    ZREM bull:message-delivery:delayed msg-42
                    LPUSH bull:message-delivery:wait msg-42

15:00:00.001  Worker: BRPOPLPUSH wait active --> msg-42
              |
              +---> Worker reads job data from hash:
                    HGETALL bull:message-delivery:msg-42
                    --> { messageId: 42, recipientEmail: "bob@example.com" }
              |
              +---> SQLite: UPDATE messages SET status='delivered', delivered_at='15:00:00'
              |              WHERE id=42 AND status='pending'
              |
              +---> File: append to logs/delivery.log:
                    "[2026-06-15T15:00:00.050Z] Delivered message 42 to bob@example.com"
              |
              +---> Job completed:
                    LREM bull:message-delivery:active msg-42
                    DEL bull:message-delivery:msg-42  (removeOnComplete: true)

15:00:00.055  Done. Message delivered.
```

### Multi-Worker Architecture (Scaled Version)

```
                    +-------------------+
                    |    LOAD BALANCER  |
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
       +------+------+ +----+------+ +-----+-----+
       |  API Server | | API Server| |API Server  |
       |  Instance 1 | | Instance 2| |Instance 3  |
       +------+------+ +-----+-----+ +-----+------+
              |               |              |
              +-------+-------+--------------+
                      |
              +-------v--------+
              |   REDIS        |
              |   (Sentinel    |
              |    or Cluster) |
              +-------+--------+
                      |
              +-------+---------+-----------+
              |                 |           |
       +------v------+  +------v-----+ +---v--------+
       |   Worker 1  |  |  Worker 2  | |  Worker 3  |
       | concurrency |  | concurrency| | concurrency|
       |    = 10     |  |   = 10     | |   = 10     |
       +------+------+  +-----+------+ +-----+------+
              |                |              |
              +-------+--------+--------------+
                      |
              +-------v-------+
              |   PostgreSQL  |
              |   (replace    |
              |    SQLite at  |
              |    scale)     |
              +---------------+
```

---

## Quick Reference: Redis Commands You Should Know for Interviews

```bash
# Strings
SET key value                        # Set a key
GET key                              # Get a key
INCR key                             # Atomic increment
SETEX key 3600 value                 # Set with expiry (seconds)
SETNX key value                      # Set only if not exists

# Lists (used by BullMQ for ready/active queues)
LPUSH key value                      # Push to head
RPOP key                             # Pop from tail
BRPOPLPUSH source dest timeout       # Blocking pop + push (atomic)
LRANGE key 0 -1                      # Get all elements
LLEN key                             # List length

# Sorted Sets (used by BullMQ for delayed jobs)
ZADD key score member                # Add with score
ZRANGEBYSCORE key min max            # Get members by score range
ZREM key member                      # Remove a member
ZCARD key                            # Count members
ZRANK key member                     # Get rank of member

# Hashes (used by BullMQ for job data)
HSET key field value                 # Set a field
HGET key field                       # Get a field
HGETALL key                          # Get all fields
HDEL key field                       # Delete a field

# Keys
DEL key                              # Delete a key
EXISTS key                           # Check if key exists
TTL key                              # Time to live (seconds)
EXPIRE key seconds                   # Set expiry
SCAN cursor MATCH pattern COUNT n    # Iterate keys (safe, non-blocking)

# Server
INFO                                 # Server stats
DBSIZE                               # Number of keys
MONITOR                              # Real-time command log (DEBUG ONLY)
SLOWLOG GET n                        # Slow query log
CLIENT LIST                          # Connected clients
CONFIG GET maxmemory                 # Get config value
```

---

## Final Interview Tips

1. **Always tie answers back to your project.** Do not just explain Redis in abstract -- say "In my Time Capsule system, I used sorted sets for delayed scheduling because..."

2. **Know the trade-offs.** Every interview answer should include "the downside is..." or "the trade-off is..." This shows maturity.

3. **Understand the full lifecycle.** Be able to trace a message from the HTTP request, through Redis, to the worker, to the database, to the log file.

4. **Know when NOT to use Redis.** Saying "I would use a simple cron job for small scale" shows you are pragmatic, not just a tool enthusiast.

5. **Idempotency is key.** Whenever discussing reliability, mention that your workers are idempotent. The `WHERE status = 'pending'` pattern is simple and effective.

6. **Source of truth matters.** "The database is the source of truth. Redis is the execution engine. If they disagree, the database wins."

7. **Persistence config is not optional.** For job queues, always configure AOF (`appendfsync everysec`) plus RDB. Default Redis config is NOT safe for queues.

8. **Be ready to whiteboard the architecture.** Practice drawing the ASCII diagram above from memory. Interviewers love to see you think visually about system design.
