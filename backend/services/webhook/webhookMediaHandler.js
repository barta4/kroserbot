const logger = require('../../config/logger');
const mediaService = require('../media/mediaService');
const urlInterpreterService = require('../media/urlInterpreterService');

/**
 * Processes multimodal attachments (audios, photos of hardware parts) and message URLs.
 * Returns enriched content and visualKeywords.
 */
async function processAttachmentsAndUrls(rawContent, attachments, { correlationId } = {}) {
  let content = rawContent || '';
  let visualKeywords = [];

  // 1. Process Attachments (Multimodal: Audio voice notes & Images / Visual Parts Finder)
  if (Array.isArray(attachments) && attachments.length > 0) {
    logger.info('Processing message attachments', { correlationId, count: attachments.length });
    try {
      const { mediaSummaries, transcribedTexts, visualSearchTerms } = await mediaService.processMessageAttachments(attachments);
      const partsToAdd = [];
      if (transcribedTexts && transcribedTexts.length > 0) {
        partsToAdd.push(transcribedTexts.join('\n'));
      }
      // Preserve non-audio media summaries (visual parts identification, documents) so images are never dropped
      const nonAudioSummaries = (mediaSummaries || []).filter((s) => !s.startsWith('[Audio transcripto:'));
      if (nonAudioSummaries.length > 0) {
        partsToAdd.push(nonAudioSummaries.join('\n'));
      } else if ((!transcribedTexts || transcribedTexts.length === 0) && mediaSummaries && mediaSummaries.length > 0) {
        partsToAdd.push(mediaSummaries.join('\n'));
      }
      if (partsToAdd.length > 0) {
        content = content ? `${content}\n${partsToAdd.join('\n')}` : partsToAdd.join('\n');
      }
      if (visualSearchTerms && visualSearchTerms.length > 0) {
        visualKeywords = visualSearchTerms;
      }
    } catch (mediaErr) {
      logger.warn('Error processing attachments in webhook', { correlationId, error: mediaErr.message });
    }
  }

  // 2. Process Message URLs (Mercado Libre, Kroser & general e-commerce links)
  if (content && typeof content === 'string') {
    try {
      const urlResult = await urlInterpreterService.processMessageUrls(content);
      if (urlResult && urlResult.hasUrls) {
        logger.info('URLs detected and interpreted in user message', {
          correlationId,
          urlCount: urlResult.urls.length,
          platforms: urlResult.urls.map((u) => u.platform),
          terms: urlResult.combinedSearchTerms,
        });
        content = urlResult.enrichedContent;
        if (urlResult.combinedSearchTerms && visualKeywords.length === 0) {
          visualKeywords = urlResult.combinedSearchTerms.split(' ').filter(Boolean);
        }
      }
    } catch (urlErr) {
      logger.warn('Error interpreting URLs in webhook message', { correlationId, error: urlErr.message });
    }
  }

  return {
    content,
    visualKeywords,
  };
}

module.exports = {
  processAttachmentsAndUrls,
};
