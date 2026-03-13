const express = require('express');
const authenticate = require('../middleware/authenticate');
const { getDb } = require('../database');
const { scheduleDelivery } = require('../services/queue');

const router = express.Router();

router.use(authenticate);

// POST /api/messages
router.post('/', async (req, res) => {
  try {
    const { recipient_email, message, deliver_at } = req.body;

    if (!recipient_email || !message || !deliver_at) {
      return res.status(400).json({
        error: 'recipient_email, message, and deliver_at are required',
      });
    }
    if (typeof recipient_email !== 'string' || !recipient_email.includes('@')) {
      return res.status(400).json({ error: 'Invalid recipient email format' });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message must be 500 characters or fewer' });
    }

    const deliverDate = new Date(deliver_at);
    if (isNaN(deliverDate.getTime())) {
      return res.status(400).json({ error: 'Invalid deliver_at date format' });
    }
    if (deliverDate <= new Date()) {
      return res.status(400).json({ error: 'deliver_at must be a future date' });
    }

    const db = getDb();
    const result = await db.run(
      'INSERT INTO messages (user_id, recipient_email, message, deliver_at) VALUES (?, ?, ?, ?)',
      [req.user.id, recipient_email, message, deliverDate.toISOString()]
    );

    // Schedule delivery via BullMQ
    await scheduleDelivery(result.lastID, recipient_email, deliverDate.toISOString());

    const created = await db.get('SELECT * FROM messages WHERE id = ?', [result.lastID]);

    res.status(201).json({
      id: created.id,
      recipient_email: created.recipient_email,
      message: created.message,
      deliver_at: created.deliver_at,
      status: created.status,
      created_at: created.created_at,
      delivered_at: created.delivered_at,
    });
  } catch (err) {
    console.error('Create message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const messages = await db.all(
      `SELECT id, recipient_email, message, deliver_at, status, created_at, delivered_at
       FROM messages WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ messages });
  } catch (err) {
    console.error('List messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
