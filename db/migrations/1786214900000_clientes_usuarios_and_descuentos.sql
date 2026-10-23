-- Migration: 1786214900000_clientes_usuarios_and_descuentos.sql
-- Description: Tabla de clientes_usuarios y soporte de descuentos por cliente y categoría para Cotibot

CREATE TABLE IF NOT EXISTS clientes_usuarios (
  id                   SERIAL PRIMARY KEY,
  email                VARCHAR(255) UNIQUE NOT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  nombre               VARCHAR(200) NOT NULL,
  empresa_razon_social VARCHAR(200),
  rut_ci               VARCHAR(50),
  telefono             VARCHAR(50),
  categoria            VARCHAR(50) NOT NULL DEFAULT 'minorista'
                         CHECK (categoria IN ('minorista', 'profesional', 'gremio', 'empresa', 'mayorista')),
  descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  activo               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_usuarios_email ON clientes_usuarios(email);
CREATE INDEX IF NOT EXISTS idx_clientes_usuarios_categoria ON clientes_usuarios(categoria);

-- Seed de clientes de demostración con diferentes niveles de descuento
-- Password demo para todos: "Cotibot123!" ($2a$10$yF83rTGBgQoRvh8z34QxauYf.Ytq8z0qL6y9oW7JdYdO4B17fM8o2)
INSERT INTO clientes_usuarios (email, password_hash, nombre, empresa_razon_social, rut_ci, telefono, categoria, descuento_porcentaje)
VALUES
  ('minorista@cotibot.uy', '$2b$10$6P8Iu73pXs9nnfcIr7JUrOautm2sGHaJPeow1yCxm/eFMeTpYVFWy', 'Consumidor Final', 'Particular', '4.567.890-1', '099111222', 'minorista', 0.00),
  ('profesional@cotibot.uy', '$2b$10$6P8Iu73pXs9nnfcIr7JUrOautm2sGHaJPeow1yCxm/eFMeTpYVFWy', 'Martín Técnico', 'Instalaciones MT', '3.456.789-0', '099333444', 'profesional', 10.00),
  ('gremio@cotibot.uy', '$2b$10$6P8Iu73pXs9nnfcIr7JUrOautm2sGHaJPeow1yCxm/eFMeTpYVFWy', 'Taller Los Amigos', 'Los Amigos SRL', '219876540012', '099555666', 'gremio', 15.00),
  ('empresa@cotibot.uy', '$2b$10$6P8Iu73pXs9nnfcIr7JUrOautm2sGHaJPeow1yCxm/eFMeTpYVFWy', 'Constructora Sur', 'Sur Construcciones SA', '211234560018', '099777888', 'empresa', 20.00)
ON CONFLICT (email) DO NOTHING;
