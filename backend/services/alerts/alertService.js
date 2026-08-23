const logger = require('../../config/logger');

// Simulated alert service - this would typically connect to PagerDuty, Slack, or Email
module.exports = {
  sendAlert(title, message, severity = 'high') {
    logger.error(`[ALERTA - ${severity.toUpperCase()}] ${title}: ${message}`);
    // Here you would integrate with an external service
  }
};
