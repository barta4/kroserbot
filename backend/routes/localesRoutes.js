const express = require('express');
const router = express.Router();
const localesController = require('../controllers/localesController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

router.get('/', requireAuth, localesController.listLocales);
router.post('/', requireRole('admin'), localesController.createLocal);
router.put('/:id', requireRole('admin'), localesController.updateLocal);
router.delete('/:id', requireRole('admin'), localesController.deleteLocal);

module.exports = router;
