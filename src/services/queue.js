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
      delay: Math.max(delay, 0),
      jobId: `msg-${messageId}`,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

module.exports = { deliveryQueue, scheduleDelivery };
