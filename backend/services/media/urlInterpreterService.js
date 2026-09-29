const logger = require('../../config/logger');

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

const URL_REGEX = /(https?:\/\/[^\s<>"')]+)/gi;

/**
 * Extracts and cleans the slug from a URL to determine the product name
 */
function parseUrlSlug(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = decodeURIComponent(parsed.pathname);

    // 1. Mercado Libre URLs
    // e.g. https://www.mercadolibre.com.uy/panel-wpc-decorativo-revestimiento-pared-wall-panel/up/MLUU4824517083...
    // e.g. https://articulo.mercadolibre.com.uy/MLU-634918234-taladro-percutor-inalambrico-stanley-sbd715c2k-20v-brushless-_JM
    // e.g. https://mercadolibre.com.uy/p/MLU14883617
    if (host.includes('mercadolibre')) {
      const segments = pathname.split('/').filter(Boolean);
      for (const seg of segments) {
        // Skip technical segments
        if (seg === 'up' || seg === 'p' || seg === 'gz' || (/^ML[A-Z0-9]+$/i.test(seg) && !seg.includes('-'))) {
          continue;
        }

        // Clean prefix like MLU-12345678- and suffix like -_JM
        let clean = seg
          .replace(/^ML[A-Z]-\d+-/i, '')
          .replace(/-_JM$/i, '')
          .replace(/\.[a-z0-9]+$/i, '');

        if (clean.length >= 3) {
          const title = clean.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (title.length >= 3) {
            return {
              productName: title,
              platform: 'Mercado Libre',
              isMercadoLibre: true,
            };
          }
        }
      }
      return {
        productName: 'Publicación de Mercado Libre',
        platform: 'Mercado Libre',
        isMercadoLibre: true,
      };
    }

    // 2. Kroser Official Store URLs
    // e.g. https://www.kroser.com.uy/catalogo/hidroesmalte-epoxi-pisos-y-paredes-1l-n-a_29289441003_29289441003
    if (host.includes('kroser')) {
      const segments = pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1] || '';
      // Remove trailing SKU/ID suffix like _29289441003_... or -n-a_...
      const clean = last
        .replace(/-n-a_[0-9]+.*$/i, '')
        .replace(/_[0-9]+.*$/, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        productName: clean || 'Artículo del catálogo Kroser',
        platform: 'Kroser Uruguay',
        isKroser: true,
      };
    }

    // 3. General E-commerce / Web URLs
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      // Pick the longest or last descriptive segment
      const candidates = segments.filter((s) => s.length >= 3 && !/^\d+$/.test(s));
      const targetSeg = candidates[candidates.length - 1] || segments[segments.length - 1];
      const clean = targetSeg
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (clean.length >= 3) {
        return {
          productName: clean,
          platform: host.replace(/^www\./, ''),
          isGeneric: true,
        };
      }
    }

    return {
      productName: host.replace(/^www\./, ''),
      platform: host.replace(/^www\./, ''),
      isGeneric: true,
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Attempts a fast HTTP metadata fetch (title, OpenGraph) with strict timeout
 */
async function fetchPageMetadata(rawUrl, timeoutMs = 2500) {
  if (!axios || !rawUrl) return null;

  try {
    const res = await axios.get(rawUrl, {
      timeout: timeoutMs,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9',
      },
    });

    const html = typeof res.data === 'string' ? res.data : '';
    if (!html) return null;

    // 1. Try OpenGraph Title
    const ogTitleMatch =
      html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i);
    let title = ogTitleMatch ? ogTitleMatch[1].trim() : '';

    // 2. Try HTML <title> tag
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : '';
    }

    // 3. Clean up common brand suffixes
    if (title) {
      title = title
        .replace(/\s*\|\s*MercadoLibre(?:\.com(?:\.uy)?)?/gi, '')
        .replace(/\s*\|\s*Mercado\s*Libre/gi, '')
        .replace(/\s*-\s*Kroser(?:\s*Uruguay)?/gi, '')
        .replace(/\s*\|\s*Sodimac/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 4. Try OpenGraph Description
    const ogDescMatch =
      html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
      html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
    const description = ogDescMatch ? ogDescMatch[1].trim() : '';

    return { title, description };
  } catch (err) {
    logger.debug('URL metadata fetch failed or timed out, relying on slug parsing', {
      url: rawUrl,
      error: err.message,
    });
    return null;
  }
}

const GENERIC_TITLES = new Set([
  'mercado libre',
  'mercadolibre',
  'kroser',
  'kroser uruguay',
  'just a moment...',
  'attention required',
  'access denied',
  '403 forbidden',
  'error',
  'inicio',
  'home',
]);

/**
 * Interprets a single URL combining slug analysis and fast meta fetch
 */
async function interpretUrl(rawUrl, { fetchMeta = true, timeoutMs = 2500 } = {}) {
  const slugInfo = parseUrlSlug(rawUrl) || {
    productName: 'Enlace web',
    platform: 'Web',
  };

  let metaTitle = '';
  let metaDesc = '';

  if (fetchMeta) {
    const meta = await fetchPageMetadata(rawUrl, timeoutMs);
    if (meta && meta.title && meta.title.length >= 3) {
      const lowerMeta = meta.title.toLowerCase().trim();
      if (!GENERIC_TITLES.has(lowerMeta)) {
        metaTitle = meta.title;
        metaDesc = meta.description || '';
      }
    }
  }

  // Use metaTitle if descriptive, otherwise prefer the slug title
  let finalTitle = slugInfo.productName;
  if (metaTitle && metaTitle.length > 5) {
    finalTitle = metaTitle;
  }
  if (!finalTitle || GENERIC_TITLES.has(finalTitle.toLowerCase().trim())) {
    finalTitle = slugInfo.productName || 'Publicación';
  }
  const searchTerms = (finalTitle || '')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    url: rawUrl,
    title: finalTitle,
    platform: slugInfo.platform,
    isMercadoLibre: !!slugInfo.isMercadoLibre,
    isKroser: !!slugInfo.isKroser,
    searchTerms,
    description: metaDesc,
  };
}

/**
 * Extracts and interprets all URLs found in a message
 */
async function processMessageUrls(content, options = {}) {
  if (!content || typeof content !== 'string') {
    return { hasUrls: false, urls: [], urlSummaries: [], combinedSearchTerms: '', enrichedContent: content || '' };
  }

  const matches = content.match(URL_REGEX);
  if (!matches || matches.length === 0) {
    return { hasUrls: false, urls: [], urlSummaries: [], combinedSearchTerms: '', enrichedContent: content };
  }

  // Deduplicate URLs
  const uniqueUrls = Array.from(new Set(matches.map((u) => u.replace(/[.,;:)\]]+$/, ''))));
  const processedUrls = [];
  const urlSummaries = [];
  const searchTermsList = [];

  for (const url of uniqueUrls.slice(0, 3)) {
    try {
      const interpreted = await interpretUrl(url, options);
      processedUrls.push(interpreted);

      if (interpreted.isMercadoLibre) {
        urlSummaries.push(
          `[Enlace analizado de Mercado Libre: Producto "${interpreted.title}" (URL: ${interpreted.url})]`
        );
      } else if (interpreted.isKroser) {
        urlSummaries.push(
          `[Enlace analizado de Kroser: Producto "${interpreted.title}" (URL: ${interpreted.url})]`
        );
      } else {
        urlSummaries.push(
          `[Enlace analizado de ${interpreted.platform}: Producto "${interpreted.title}" (URL: ${interpreted.url})]`
        );
      }

      if (interpreted.searchTerms) {
        searchTermsList.push(interpreted.searchTerms);
      }
    } catch (err) {
      logger.warn('Error interpreting URL in message', { url, error: err.message });
    }
  }

  const combinedSearchTerms = searchTermsList.join(' ').trim();
  const summariesBlock = urlSummaries.join('\n');
  const enrichedContent = summariesBlock ? `${content}\n${summariesBlock}` : content;

  return {
    hasUrls: processedUrls.length > 0,
    urls: processedUrls,
    urlSummaries,
    combinedSearchTerms,
    enrichedContent,
  };
}

module.exports = {
  URL_REGEX,
  parseUrlSlug,
  fetchPageMetadata,
  interpretUrl,
  processMessageUrls,
};
