-- Migration: Reactivate in-catalog products marked discontinued
-- Ensures active models like Hidrolavadora Alpha-Pro 1600W are available in search

UPDATE productos
SET discontinuado = FALSE
WHERE sku = '820HL7125M2';
