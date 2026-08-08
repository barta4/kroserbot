-- Migration: 1723140003000_prompt_history.sql
-- Description: Create prompt_history table for system prompt versioning

CREATE TABLE IF NOT EXISTS prompt_history (
  id           SERIAL PRIMARY KEY,
  version      INTEGER NOT NULL,
  prompt       TEXT NOT NULL,
  cambiado_por VARCHAR(100) DEFAULT 'admin',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
