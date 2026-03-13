require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: '24h',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/timecapsule.db',
  LOG_PATH: process.env.LOG_PATH || './logs/delivery.log',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587'),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@timecapsule.app',
};
