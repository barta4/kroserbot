import fs from 'node:fs';
import path from 'node:path';
import { ProductData } from './types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadProducts(): ProductData[] {
  ensureDataDir();
  if (!fs.existsSync(PRODUCTS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
    return JSON.parse(raw) as ProductData[];
  } catch (err) {
    console.error('Error al leer products.json:', err);
    return [];
  }
}

export function saveProducts(products: ProductData[]): void {
  ensureDataDir();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

export function upsertProducts(newProducts: ProductData[]): { inserted: number; updated: number; total: number } {
  const current = loadProducts();
  const map = new Map<string, ProductData>();

  for (const p of current) {
    map.set(p.source_id, p);
  }

  let inserted = 0;
  let updated = 0;

  for (const p of newProducts) {
    if (map.has(p.source_id)) {
      updated++;
    } else {
      inserted++;
    }
    map.set(p.source_id, p);
  }

  const all = Array.from(map.values());
  saveProducts(all);

  return {
    inserted,
    updated,
    total: all.length
  };
}
