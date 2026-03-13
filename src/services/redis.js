const IORedis = require('ioredis');
const { REDIS_URL } = require('../config');

function createConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

module.exports = { createConnection };
