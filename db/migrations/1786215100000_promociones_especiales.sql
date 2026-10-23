-- Migration: 1786215100000_promociones_especiales.sql
-- Gestión dinámica de Banners y Promociones Especiales para Cotibot y Admin

CREATE TABLE IF NOT EXISTS promociones_especiales (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    subtitulo TEXT,
    badge VARCHAR(100) DEFAULT 'OFERTA ESPECIAL',
    descuento_porcentaje NUMERIC(5,2) DEFAULT 0,
    link_accion VARCHAR(255) DEFAULT '',
    imagen_url TEXT,
    gradiente VARCHAR(50) DEFAULT 'amber',
    texto_boton VARCHAR(100) DEFAULT 'Ver Oferta',
    activo BOOLEAN DEFAULT TRUE,
    orden INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promociones_activo_orden ON promociones_especiales (activo, orden ASC, id DESC);

-- Seed de promociones iniciales destacadas
INSERT INTO promociones_especiales (titulo, subtitulo, badge, descuento_porcentaje, link_accion, gradiente, texto_boton, activo, orden)
VALUES
('Super Oferta Equus: Escaleras Profesionales', 'Escaleras telescópicas y articuladas de aluminio de alta resistencia con entrega inmediata.', '⚡ EQUUS DESTACADO', 25.00, 'Equus', 'amber', 'Ver Escaleras', true, 1),
('Combo Pinturas & Acabados de Temporada', 'Membrana líquida fibrada, látex antihongo y esmaltes sintéticos con bonificación por balde.', '🎨 PROMO PINTURA', 15.00, 'Pinturas', 'emerald', 'Ver Línea Pinturas', true, 2),
('Descuentos Exclusivos para Profesionales & Gremio', 'Precios bonificados del 10% al 20% para electricistas, sanitarios, constructores y talleres.', '👷‍♂️ GREMIO & OBRA', 20.00, 'Herramientas', 'blue', 'Explorar Catálogo', true, 3),
('Línea Herramientas Eléctricas & Inalámbricas', 'Rotomartillos, amoladoras y taladros de percusión con garantía oficial Kroser.', '🔥 LIQUIDACIÓN', 18.00, 'Taladro', 'purple', 'Ver Herramientas', true, 4)
ON CONFLICT DO NOTHING;
