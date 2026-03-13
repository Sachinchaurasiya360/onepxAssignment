const { Worker } = require('bullmq');
const { REDIS_URL } = require('../config');
const { getDb } = require('../database');
const { logDelivery } = require('./delivery-logger');
const { sendEmail } = require('./mailer');

function startWorker() {
  const worker = new Worker(
    'message-delivery',
    async (job) => {
      const { messageId, recipientEmail } = job.data;

      const db = getDb();

      // Fetch the full message for the email body
      const msg = await db.get('SELECT message FROM messages WHERE id = ?', [messageId]);

      // Send email (skips gracefully if SMTP not configured)
      try {
        const sent = await sendEmail(recipientEmail, msg ? msg.message : '');
        if (sent) {
          console.log(`Email sent to ${recipientEmail} for message ${messageId}`);
        }
      } catch (err) {
        console.error(`Email failed for message ${messageId}:`, err.message);
      }

      // Update status regardless — delivery = status update + log
      const now = new Date().toISOString();
      await db.run(
        'UPDATE messages SET status = ?, delivered_at = ? WHERE id = ? AND status = ?',
        ['delivered', now, messageId, 'pending']
      );

      logDelivery(messageId, recipientEmail);
      console.log(`Delivered message ${messageId} to ${recipientEmail}`);
    },
    { connection: { url: REDIS_URL } }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  worker.on('ready', () => {
    console.log('Delivery worker started and listening for jobs');
  });

  return worker;
}

module.exports = { startWorker };
