import * as cheerio from 'cheerio';
import { ProductData, ProductPreview, AvailabilityStatus, ProductPrice } from './types.js';
import { getSessionStatus } from './fetcher.js';

const BASE_URL = 'https://www.equus.uy';

export function parseCategoryProducts(html: string, baseUrl: string = BASE_URL): ProductPreview[] {
  const $ = cheerio.load(html);
  const products: ProductPreview[] = [];

  $('article.prod_item').each((_, el) => {
    const $item = $(el);

    const relUrl = $item.find('h2 a').attr('href') || $item.find('.foto a').attr('href') || '';
    if (!relUrl) return;

    const fullUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).toString();

    const name = $item.find('h2 a span').text().trim() || $item.find('h2 a').text().trim();
    const skuRaw = $item.find('.prodcod span:last-child').text().trim() 
      || $item.find('.prodcod').text().replace(/Cód\.?/i, '').trim();

    const inStock = $item.find('.enstock').length > 0;

    const pMoneda = $item.find('.pmoneda').text().trim();
    const pPrecio = $item.find('.pprecio').text().replace(/[^0-9.]/g, '').trim();
    const priceAmount = pPrecio ? parseFloat(pPrecio) : undefined;
    const currency = pMoneda.includes('USD') || pMoneda.includes('U$S') ? 'USD' : (pMoneda.includes('$') ? 'UYU' : pMoneda || undefined);

    const imgRel = $item.find('.foto img').attr('src') || '';
    const imageUrl = imgRel ? (imgRel.startsWith('http') ? imgRel : new URL(imgRel, baseUrl).toString()) : undefined;

    products.push({
      sku: skuRaw || 'SIN_CODIGO',
      name,
      url: fullUrl,
      priceAmount,
      currency,
      inStock,
      imageUrl
    });
  });

  return products;
}

export function parseProductDetail(html: string, pageUrl: string): ProductData {
  const $ = cheerio.load(html);

  let jsonLdProduct: any = null;
  const breadcrumbs: string[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html()?.trim();
      if (!content) return;
      const data = JSON.parse(content);

      if (data['@type'] === 'Product') {
        jsonLdProduct = data;
      } else if (data['@type'] === 'BreadcrumbList' && Array.isArray(data.itemListElement)) {
        for (const item of data.itemListElement) {
          if (item?.item?.name) {
            breadcrumbs.push(item.item.name.trim());
          }
        }
      }
    } catch {
      // Ignorar bloques JSON-LD malformados
    }
  });

  // 1. Nombre
  const name = jsonLdProduct?.name 
    || $('h1.nombre').text().trim() 
    || $('h1').text().trim();

  // 2. SKU / Código
  const sku = jsonLdProduct?.sku 
    || $('.item:contains("Código")').text().replace(/Código:\s*/i, '').trim()
    || $('.prodcod').text().replace(/Cód\.?/i, '').trim()
    || '';

  // 3. ID interno (ej. 5610)
  const internalIdMatch = html.match(/id="ids(\d+)"/) || html.match(/id=(\d+)&path=/);
  const internal_id = internalIdMatch ? internalIdMatch[1] : undefined;

  // 4. Descripción
  const description = jsonLdProduct?.description 
    || $('h2.copete_ficha').text().trim() 
    || $('.copete').text().trim();

  // 5. Imágenes
  let images: string[] = [];
  if (Array.isArray(jsonLdProduct?.image)) {
    images = jsonLdProduct.image;
  } else if (typeof jsonLdProduct?.image === 'string') {
    images = [jsonLdProduct.image];
  } else {
    $('img[id^="img_producto"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) images.push(src.startsWith('http') ? src : new URL(src, BASE_URL).toString());
    });
  }

  // 6. Precio y Moneda
  let priceAmount = 0;
  let currency = 'UYU';

  if (jsonLdProduct?.offers?.price) {
    priceAmount = parseFloat(jsonLdProduct.offers.price) || 0;
    currency = jsonLdProduct.offers.priceCurrency || 'UYU';
  } else {
    const rawMoneda = $('.pmoneda').first().text().trim();
    const rawPrecio = $('.pprecio').first().text().replace(/[^0-9.]/g, '').trim();
    if (rawPrecio) priceAmount = parseFloat(rawPrecio);
    currency = rawMoneda.includes('USD') || rawMoneda.includes('U$S') ? 'USD' : 'UYU';
  }

  // 7. Disponibilidad / Stock
  let availability: AvailabilityStatus = 'in_stock';
  if (jsonLdProduct?.offers?.availability) {
    if (jsonLdProduct.offers.availability.includes('InStock')) {
      availability = 'in_stock';
    } else if (jsonLdProduct.offers.availability.includes('OutOfStock')) {
      availability = 'out_of_stock';
    }
  } else {
    const hasInStockBadge = $('.enstock').length > 0;
    const isConsultar = $('a[href*="/contacto/?subject="]').length > 0;
    if (hasInStockBadge) {
      availability = 'in_stock';
    } else if (isConsultar) {
      availability = 'on_request';
    } else {
      availability = 'out_of_stock';
    }
  }

  // 8. Especificaciones técnicas (tabla .gendata)
  const specs: Record<string, string> = {};
  $('table.gendata tr').each((_, tr) => {
    const lab = $(tr).find('td.lab').text().trim();
    const data = $(tr).find('td.data').text().trim();
    if (lab && data && data !== '-') {
      specs[lab] = data;
    }
  });

  // 9. Categoría
  const category = breadcrumbs.length > 0 
    ? breadcrumbs.join(' / ') 
    : (jsonLdProduct?.category || 'Sin categoría');

  const sessionStatus = getSessionStatus();
  const price: ProductPrice = {
    amount: priceAmount,
    currency,
    tax_included: true,
    is_wholesale: sessionStatus.isLoggedIn,
    wholesale_user: sessionStatus.user || undefined
  };

  return {
    source: 'equus.uy',
    source_id: sku,
    internal_id,
    name,
    category,
    breadcrumbs,
    price,
    availability,
    description,
    images,
    product_url: pageUrl,
    specs,
    last_checked_at: new Date().toISOString()
  };
}
