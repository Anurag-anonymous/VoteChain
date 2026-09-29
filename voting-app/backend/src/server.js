const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const connectDB = require('./config/database');
const { requestLimiter } = require('./middleware/rateLimiters');

const authRoutes = require('./routes/auth');
const pollRoutes = require('./routes/polls');
const discussionRoutes = require('./routes/discussions');
const userRoutes = require('./routes/users');

const errorHandler = require('./middleware/errorHandler');
const logger = require('./middleware/logger');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(logger);

app.use(requestLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/eligibility-authority', require('./routes/eligibilityAuthority'));
app.use('/api/polls', pollRoutes);
app.use('/api/discussions', discussionRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

app.use(errorHandler);

let server;

const assertProductionConfiguration = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const required = [
    'JWT_SECRET',
    'REFRESH_TOKEN_SECRET',
    'C0_CREDENTIAL_ISSUER_SECRET',
    'C0_BALLOT_ENCRYPTION_SECRET',
    'C2_REGISTRY_ENCRYPTION_KEY',
    'SEMAPHORE_VERIFIER_ADDRESS',
    'ELECTION_BALLOT_ENCRYPTION_MODE',
    'JCJ_PROTOCOL_ENABLED'
  ];
  const missing = required.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.length < 32 || /change-me|development|your_/i.test(value);
  });
  const databaseUri = process.env.MONGODB_URI ||
    process.env.MONGODB_ATLAS_URI ||
    process.env.MONGODB_LOCAL_URI;
  if (!databaseUri || /localhost|127\.0\.0\.1|your_/i.test(databaseUri)) {
    missing.push('MONGODB_URI or MONGODB_ATLAS_URI');
  }
  if (missing.length) {
    throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
  }
  if (process.env.BLOCKCHAIN_NETWORK === 'anvil' ||
      process.env.BLOCKCHAIN_NETWORK === 'local' ||
      process.env.RESEARCH_PROTOCOL_ENABLED === 'false') {
    throw new Error('Production requires a configured public blockchain network and enabled encrypted protocol');
  }
  if (!/^[0-9a-f]{64}$/i.test(process.env.C2_REGISTRY_ENCRYPTION_KEY)) {
    throw new Error('C2_REGISTRY_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters');
  }
  if (!/^0x[0-9a-f]{40}$/i.test(process.env.SEMAPHORE_VERIFIER_ADDRESS)) {
    throw new Error('SEMAPHORE_VERIFIER_ADDRESS must be a deployed verifier contract address');
  }
  if (process.env.ELECTION_BALLOT_ENCRYPTION_MODE !== 'threshold-elgamal') {
    throw new Error('Production requires ELECTION_BALLOT_ENCRYPTION_MODE=threshold-elgamal');
  }
  if (process.env.JCJ_PROTOCOL_ENABLED !== 'true') {
    throw new Error('Production requires JCJ_PROTOCOL_ENABLED=true');
  }
};

const startServer = async () => {
  assertProductionConfiguration();
  await connectDB();

  const port = Number(process.env.PORT) || 5000;
  server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the existing backend process or set PORT to another value in backend/.env.`);
      process.exit(1);
    }

    throw error;
  });
};

if (require.main === module) {
  startServer();
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  if (server) {
    server.close(() => process.exit(1));
    return;
  }
  process.exit(1);
});

module.exports = app;
