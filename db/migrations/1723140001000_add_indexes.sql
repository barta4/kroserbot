-- Migration: 1723140001000_add_indexes.sql
-- Description: Create vector HNSW index and standard indexes for fast lookups

-- Indice vectorial HNSW sobre productos.embedding (distancia coseno)
CREATE INDEX IF NOT EXISTS idx_productos_embedding 
  ON productos USING hnsw (embedding vector_cosine_ops);

-- Indices normales
CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos (sku);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos (categoria);
CREATE INDEX IF NOT EXISTS idx_productos_discontinuado ON productos (discontinuado);

CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos (estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_conversation ON pedidos (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversaciones_conversation ON conversaciones (conversation_id);
