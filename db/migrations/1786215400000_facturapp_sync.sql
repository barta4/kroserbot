-- Migration: 1786215400000_facturapp_sync.sql
-- Description: Sincronización incremental del catálogo Facturapp (identificador estable + estado reanudable)

-- 1. Identidad Facturapp en el catálogo local
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_codigo VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_codigo_barras VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_updated_at TIMESTAMPTZ;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_activo BOOLEAN;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_actual NUMERIC(14,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(14,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(20);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id_ramo INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id_familia INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id_grupo INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id_marca INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_id_proveedor INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS facturapp_raw JSONB;

-- Clave estable de sincronización. Un índice único permite múltiples NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_facturapp_id
  ON productos(facturapp_id);

CREATE INDEX IF NOT EXISTS idx_productos_facturapp_updated_at
  ON productos(facturapp_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_productos_fuente_facturapp
  ON productos(fuente_origen)
  WHERE fuente_origen = 'facturapp';

-- 2. Estado global de sincronización (una sola fila)
CREATE TABLE IF NOT EXISTS facturapp_sync_state (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_success_at   TIMESTAMPTZ,
  last_cutoff       TIMESTAMPTZ,
  pending_mode      VARCHAR(20) CHECK (pending_mode IN ('initial', 'incremental')),
  pending_cutoff    TIMESTAMPTZ,
  pending_desde_id  INTEGER,
  pending_run_id    BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO facturapp_sync_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 3. Historial de corridas (auditoría, reanudación y consumo de créditos)
CREATE TABLE IF NOT EXISTS facturapp_sync_runs (
  id               BIGSERIAL PRIMARY KEY,
  mode             VARCHAR(20) NOT NULL CHECK (mode IN ('initial', 'incremental')),
  status           VARCHAR(20) NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  triggered_by     VARCHAR(30) NOT NULL DEFAULT 'manual',
  dry_run          BOOLEAN NOT NULL DEFAULT FALSE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  cutoff           TIMESTAMPTZ,
  desde_id_inicial INTEGER NOT NULL DEFAULT 0,
  last_desde_id    INTEGER,
  max_pages        INTEGER,
  pages_processed  INTEGER NOT NULL DEFAULT 0,
  articles_received INTEGER NOT NULL DEFAULT 0,
  inserted         INTEGER NOT NULL DEFAULT 0,
  updated          INTEGER NOT NULL DEFAULT 0,
  unchanged        INTEGER NOT NULL DEFAULT 0,
  deactivated      INTEGER NOT NULL DEFAULT 0,
  credits_start    INTEGER,
  credits_consumed INTEGER NOT NULL DEFAULT 0,
  credits_end      INTEGER,
  errors           INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_request_id  VARCHAR(100),
  stop_reason      VARCHAR(50),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturapp_runs_status
  ON facturapp_sync_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_facturapp_runs_mode
  ON facturapp_sync_runs(mode, finished_at DESC);
