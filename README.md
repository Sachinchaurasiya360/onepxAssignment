# Time Capsule Messaging System

A backend service that lets users schedule messages for automatic delivery at a future time.

**Live Demo:** [https://onepxassignment.onrender.com](https://onepxassignment.onrender.com)

## Tech Stack

Node.js + Express v5 | SQLite (WAL mode) | BullMQ + Redis (Upstash) | JWT Auth | Resend Email API

## Quick Start

### With Docker
```bash
docker compose up --build
```

### Without Docker
Prerequisites: Node.js 18+, Redis on localhost:6379
```bash
npm install
cp .env.example .env
npm run dev
```

App runs at http://localhost:3000

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | Secret for signing JWT tokens | - |
| `DATABASE_PATH` | Path to SQLite file | `./data/timecapsule.db` |
| `LOG_PATH` | Path to delivery log file | `./logs/delivery.log` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `RESEND_API_KEY` | Resend API key for emails | - |
| `RESEND_FROM` | Sender email address | `onboarding@resend.dev` |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register with email + password |
| POST | `/api/auth/login` | No | Login, returns JWT token |
| POST | `/api/messages` | Yes | Schedule a message for future delivery |
| GET | `/api/messages` | Yes | List all your messages |
| GET | `/health` | No | Health check |

### Create Message Body
```json
{
  "recipient_email": "friend@example.com",
  "message": "Hello from the past!",
  "deliver_at": "2026-06-15T09:00:00Z"
}
```
- `deliver_at` must be in the future
- `message` max 500 characters
- Messages cannot be edited after creation

## Delivery Mechanism

When a message is created, a BullMQ delayed job is added to Redis with `delay = deliver_at - now`. When the time arrives, the worker sends the email via Resend, updates the DB status to `delivered`, and appends to the log file.

Jobs are stored in Redis, not in the Node process - restart-safe.
