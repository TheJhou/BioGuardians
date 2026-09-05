-- Add image URL column to especie.
-- Stores a single representative image URL for each species (Wikipedia, Wikidata, iNaturalist).

ALTER TABLE especie ADD COLUMN IF NOT EXISTS imagem_url TEXT;

-- Index for fast lookup of species without image.
CREATE INDEX IF NOT EXISTS idx_especie_imagem_url ON especie (id) WHERE imagem_url IS NULL;
