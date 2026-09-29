const rateLimit = require('express-rate-limit');

const isDevelopment = process.env.NODE_ENV === 'development';

const requestLimiter = rateLimit({
  windowMs: isDevelopment ? 60 * 1000 : 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 100,
  message: 'Too many requests from this IP, please try again later.',
  skip: () => isDevelopment
});

const loginLimiter = rateLimit({
  windowMs: isDevelopment ? 60 * 1000 : 15 * 60 * 1000,
  max: isDevelopment ? 100 : 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  skip: () => isDevelopment
});

module.exports = {
  requestLimiter,
  loginLimiter
};
