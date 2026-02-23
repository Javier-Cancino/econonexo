-- Índice full-text para INEGI (español)
CREATE INDEX IF NOT EXISTS inegi_descripcion_fts 
ON inegi_indicadores 
USING GIN (to_tsvector('spanish', descripcion));

-- Índice full-text para Banxico (español)  
CREATE INDEX IF NOT EXISTS banxico_titulo_fts 
ON banxico_series 
USING GIN (to_tsvector('spanish', titulo));
