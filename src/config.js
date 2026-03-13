require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: '24h',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/timecapsule.db',
  LOG_PATH: process.env.LOG_PATH || './logs/delivery.log',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_FROM: process.env.RESEND_FROM || 'Time Capsule <onboarding@resend.dev>',
};
