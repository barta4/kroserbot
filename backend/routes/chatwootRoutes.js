const express = require('express');
const router = express.Router();
const chatwootService = require('../services/chatwoot/chatwootService');
const { requireRole, requireAuth } = require('../middleware/requireAuth');

// GET /api/chatwoot/inboxes - List all inboxes/channels directly from Chatwoot/Uruchat
router.get('/inboxes', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const inboxes = await chatwootService.getInboxes();
    res.json({ success: true, inboxes });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
