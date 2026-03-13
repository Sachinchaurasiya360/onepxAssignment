const fs = require('fs');
const path = require('path');
const { LOG_PATH } = require('../config');

function logDelivery(messageId, recipientEmail) {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] Delivered message ${messageId} to ${recipientEmail}\n`;

  fs.appendFileSync(LOG_PATH, entry);
}

module.exports = { logDelivery };
