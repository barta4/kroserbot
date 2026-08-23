-- Migration: 1723140000000_init_schema.sql
-- Description: Create initial tables for Kroserbot (productos, configuracion, locales, pedidos, etc.)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla: productos
CREATE TABLE IF NOT EXISTS productos (
  id            SERIAL PRIMARY KEY,
  sku           VARCHAR(100) UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  precio        NUMERIC(10,2),
  precio_oferta NUMERIC(10,2),
  marca         VARCHAR(200),
  categoria     VARCHAR(200),
  descripcion   TEXT,
  imagen_url    TEXT,
  producto_url  TEXT,
  stock_status  VARCHAR(50) DEFAULT 'in_stock',
  embedding     vector(768),
  discontinuado BOOLEAN DEFAULT FALSE,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: configuracion (system_prompt y mensajes fijos)
CREATE TABLE IF NOT EXISTS configuracion (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: locales
CREATE TABLE IF NOT EXISTS locales (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(200) NOT NULL,
  zona      VARCHAR(200),
  direccion TEXT,
  telefono  VARCHAR(50),
  horario   TEXT
);

-- Tabla: pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id              SERIAL PRIMARY KEY,
  conversation_id VARCHAR(100),
  account_id      VARCHAR(100),
  cliente         JSONB,
  items           JSONB,
  estado          VARCHAR(50) DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','confirmado','rechazado','cancelado','entregado')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: pedidos_historial (auditoria)
CREATE TABLE IF NOT EXISTS pedidos_historial (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  estado_anterior VARCHAR(50),
  estado_nuevo    VARCHAR(50),
  cambiado_por    VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: conversaciones (log historico)
CREATE TABLE IF NOT EXISTS conversaciones (
  id              SERIAL PRIMARY KEY,
  conversation_id VARCHAR(100) NOT NULL,
  mensaje         TEXT NOT NULL,
  rol             VARCHAR(20) NOT NULL CHECK (rol IN ('user', 'assistant', 'system')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: scraper_runs
CREATE TABLE IF NOT EXISTS scraper_runs (
  id                     SERIAL PRIMARY KEY,
  status                 VARCHAR(50) DEFAULT 'running'
                           CHECK (status IN ('running','stopped','completed','failed','error')),
  started_at             TIMESTAMPTZ DEFAULT NOW(),
  finished_at            TIMESTAMPTZ,
  pagina_actual          INTEGER DEFAULT 0,
  productos_nuevos       INTEGER DEFAULT 0,
  productos_actualizados INTEGER DEFAULT 0,
  stop_requested         BOOLEAN DEFAULT FALSE,
  url_error              TEXT
);
