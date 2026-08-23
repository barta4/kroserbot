const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/requireAuth');
const loginRateLimiter = require('../middleware/loginRateLimiter');

router.post('/login', loginRateLimiter, authController.login);
router.get('/me', requireAuth, authController.me);
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
