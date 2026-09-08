const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const scraperController = require('../controllers/scraperController');

describe('System Audit Improvements & Uruchat Rebranding Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Rebranding to Uruchat in admin/index.html', () => {
    test('No contiene la palabra "Chatwoot" visible para el usuario en títulos ni descripciones', () => {
      const htmlPath = path.join(__dirname, '../../admin/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Check title
      expect(htmlContent).toContain('<title>KroserBot AI — Panel de Control & Consola Uruchat</title>');
      expect(htmlContent).not.toContain('Simulador Chatwoot');

      // Check Sandbox console heading
      expect(htmlContent).toContain('<h3>💬 Consola de Chat & Sandbox RAG (Uruchat)</h3>');
      expect(htmlContent).not.toContain('Estilo Chatwoot');

      // Check Uruchat server configuration
      expect(htmlContent).toContain('<h3>Configuración de Servidor Uruchat</h3>');
      expect(htmlContent).not.toContain('Servidor Uruchat / Chatwoot');

      // Verify no remaining visible "Chatwoot" mentions
      const matches = htmlContent.match(/Chatwoot/g);
      expect(matches).toBeNull();
    });
  });

  describe('2. Migración 1786214600000_embedding_and_unaccent_indexes.sql', () => {
    test('El archivo de migración existe y contiene las columnas e índices funcionales', () => {
      const migPath = path.join(__dirname, '../../db/migrations/1786214600000_embedding_and_unaccent_indexes.sql');
      expect(fs.existsSync(migPath)).toBe(true);

      const sql = fs.readFileSync(migPath, 'utf8');
      expect(sql).toContain('embedding_updated_at TIMESTAMPTZ');
      expect(sql).toContain('idx_productos_nombre_unaccent_trgm');
      expect(sql).toContain('idx_productos_categoria_unaccent_trgm');
      expect(sql).toContain('idx_productos_marca_unaccent_trgm');
    });
  });

  describe('3. Corrección del bucle de embeddings en generateEmbeddings.js', () => {
    test('El archivo utiliza embedding_updated_at en lugar de updated_at > 1 day', () => {
      const filePath = path.join(__dirname, '../services/embeddings/generateEmbeddings.js');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('embedding_updated_at');
      expect(content).toContain('embedding = $1::vector, embedding_updated_at = NOW()');
      expect(content).not.toContain("updated_at > NOW() - INTERVAL '1 day'");
    });
  });

  describe('4. Rollback completo en db/migrate.js', () => {
    test('migrate.js down incluye las tablas creadas en migraciones recientes', () => {
      const filePath = path.join(__dirname, '../../db/migrate.js');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('DROP TABLE IF EXISTS guias_tecnicas CASCADE;');
      expect(content).toContain('DROP TABLE IF EXISTS zonas_envio CASCADE;');
      expect(content).toContain('DROP TABLE IF EXISTS formas_pago CASCADE;');
      expect(content).toContain('DROP TABLE IF EXISTS prompt_history CASCADE;');
    });
  });

  describe('5. Controlador de Scraper (scraperController.js)', () => {
    test('startScraper inicia corrida e inserta en DB retornando 202', async () => {
      const origQuery = db.query;
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // no active run
        .mockResolvedValueOnce({ rows: [{ id: 45, status: 'running', started_at: new Date() }] }); // insert

      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      try {
        await scraperController.startScraper({}, res, next);
        expect(status).toBe(202);
        expect(body.message).toBe('Scraping iniciado');
        expect(body.run.id).toBe(45);
        expect(next).not.toHaveBeenCalled();
      } finally {
        db.query = origQuery;
      }
    });

    test('startScraper rechaza con 400 si ya existe corrida running', async () => {
      const origQuery = db.query;
      db.query = jest.fn().mockResolvedValueOnce({ rows: [{ id: 44, status: 'running' }] });

      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      try {
        await scraperController.startScraper({}, res, next);
        expect(status).toBe(400);
        expect(body.error).toMatch(/ya se encuentra en ejecución/i);
      } finally {
        db.query = origQuery;
      }
    });
  });
});
