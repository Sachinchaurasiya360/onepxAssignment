# My Approach - Time Capsule Messaging System

## Assumptions

The first question is the expected load on the system. Since this is an assignment, I'll assume a small user base initially, but design the system so it can scale.

---

## Approach Analysis

### Approach 1: Poll DB Every Minute (Chosen)

Poll the database every minute using a cron job. Check for messages where `deliver_at <= now` and `status = 'pending'`, then deliver them.

**DB call overhead:**
- 60 calls/hr × 24 hrs = 1,440 calls/day
- For a small user base this is perfectly acceptable, each query is a lightweight indexed SELECT
- SQLite handles this trivially; 

**Why I chose this:**
- Simple and reliable
- Survives server restarts (no in-memory state)
- The `(status, deliver_at)` index makes the poll query fast even with thousands of messages


### Approach 2: Sleep Until Next Message

Instead of polling every minute, the worker finds the next scheduled message and sleeps until that time.

**Pros:**
- Zero unnecessary DB calls  only wakes up when needed

**Why I didn't choose this:**
- Requires in-memory state (the sleep timer) which breaks on server restart
- If a new message is created with an earlier `deliver_at`, the sleeping worker won't know about it unless we add a notification mechanism
- Adds complexity (wake-up signals, race conditions) for minimal gain at small scale
- The assignment explicitly prohibits `setTimeout` for long delays

### Approach 3: Message Queue with BullMQ + Redis (Chosen)

Use **BullMQ** with Redis to schedule each message as a delayed job:

- When a message is created via `POST /messages`, a delayed job is added to the BullMQ queue with `delay = deliver_at - now` (in milliseconds)
- BullMQ stores delayed jobs in a Redis sorted set keyed by their execution timestamp
- A worker listens on the queue and processes jobs as they become due
- On processing: update the DB status to `delivered`, set `delivered_at`, write to the log file
- Redis is external and persistent — jobs survive server restarts. When the worker reconnects, it picks up where it left off

**Why this approach:**
- No polling overhead — zero unnecessary DB calls
- Precise delivery timing (not limited to 1-minute intervals)
- Scales horizontally — can add more workers as load increases
- Restart-safe — Redis persists the queue, not the Node.js process
- Production-grade pattern used by real messaging systems


---

## Final Decision

**Approach 3 (BullMQ + Redis)** — production-grade delivery mechanism:
- No `setTimeout` or in-memory scheduling — BullMQ uses Redis sorted sets
- Restart-safe — delayed jobs live in Redis, not in the Node process
- Precise delivery — jobs fire at the exact scheduled time, not on a polling interval
- Scalable — can add workers independently of the API server

