export interface ProductPrice {
  amount: number;
  currency: string;
  tax_included: boolean;
  is_wholesale?: boolean;
  wholesale_user?: string;
}

export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'on_request';

export interface ProductData {
  source: 'equus.uy';
  source_id: string; // SKU e.g. "R16005"
  internal_id?: string; // numeric ID e.g. "5610"
  name: string;
  category: string;
  breadcrumbs: string[];
  price: ProductPrice;
  availability: AvailabilityStatus;
  description: string;
  images: string[];
  product_url: string;
  specs: Record<string, string>;
  last_checked_at: string;
}

export interface CategoryItem {
  name: string;
  url: string;
  pathId?: string;
}

export interface ProductPreview {
  sku: string;
  name: string;
  url: string;
  priceAmount?: number;
  currency?: string;
  inStock: boolean;
  imageUrl?: string;
}
