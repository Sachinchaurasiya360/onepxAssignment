const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const { DATABASE_PATH } = require('./config');

let db;

async function initializeDatabase() {
  const dir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = await open({
    filename: DATABASE_PATH,
    driver: sqlite3.Database,
  });

  await db.run('PRAGMA journal_mode=WAL');
  await db.run('PRAGMA foreign_keys=ON');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      message TEXT NOT NULL CHECK(length(message) <= 500),
      deliver_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_delivery
      ON messages(status, deliver_at);

    CREATE INDEX IF NOT EXISTS idx_messages_user
      ON messages(user_id);
  `);

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

module.exports = { initializeDatabase, getDb };
