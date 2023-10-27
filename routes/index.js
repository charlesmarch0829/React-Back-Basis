const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const authJwt = require('../controllers/auth/authJwt');

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 200, // maximum of 200 requests per windowMs
});

router.use('/', apiLimiter);
// Authentication
router.use('/auth', require('./auth.routes'));

// Everything after this requires user authentication
router.use('/', authJwt.verifyToken);

module.exports = router;
