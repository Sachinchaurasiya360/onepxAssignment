const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { initializeDatabase } = require('./database');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const { startWorker } = require('./services/worker');

async function main() {
  await initializeDatabase();

  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve frontend
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/messages', messageRoutes);

  // Start BullMQ delivery worker
  startWorker();

  app.listen(PORT, () => {
    console.log(`Time Capsule API running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
