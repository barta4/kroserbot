const express = require('express');
const router = express.Router();
const localesController = require('../controllers/localesController');

router.get('/', localesController.listLocales);
router.post('/', localesController.createLocal);
router.put('/:id', localesController.updateLocal);
router.delete('/:id', localesController.deleteLocal);

module.exports = router;
