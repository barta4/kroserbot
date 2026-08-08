const express = require('express');
const router = express.Router();
const configuracionController = require('../controllers/configuracionController');

router.get('/', configuracionController.getConfig);
router.put('/', configuracionController.updateConfig);

module.exports = router;
