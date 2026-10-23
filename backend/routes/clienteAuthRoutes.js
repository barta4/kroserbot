const express = require('express');
const router = express.Router();
const clienteAuthController = require('../controllers/clienteAuthController');
const { optionalClienteAuth, requireClienteAuth } = require('../middleware/clienteAuth');
const loginRateLimiter = require('../middleware/loginRateLimiter');

router.post('/registro', loginRateLimiter, clienteAuthController.registro);
router.post('/login', loginRateLimiter, clienteAuthController.login);
router.get('/me', optionalClienteAuth, clienteAuthController.me);
router.post('/logout', requireClienteAuth, clienteAuthController.logout);

module.exports = router;
