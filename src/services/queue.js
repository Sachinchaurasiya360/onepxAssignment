const { Queue } = require('bullmq');
const { createConnection } = require('./redis');

const deliveryQueue = new Queue('message-delivery', {
  connection: createConnection(),
});

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
