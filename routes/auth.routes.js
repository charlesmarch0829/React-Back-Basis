const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth');

router.post('/login', controller.login);
router.post('/signup', controller.signup);
router.post('/logout', controller.logout);

module.exports = router;
