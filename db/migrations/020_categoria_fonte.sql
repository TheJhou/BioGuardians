-- ---------- Fonte da categoria de ameaca ----------
-- A categoria_ameaca pode vir de fontes diferentes (lista oficial MMA,
-- IUCN via GBIF, chute da IA, ajuste manual). Esta coluna registra a
-- procedencia para que o frontend/relatorios possam distinguir dado
-- oficial de dado estimado.

ALTER TABLE especie
    ADD COLUMN IF NOT EXISTS categoria_fonte VARCHAR(20) NOT NULL DEFAULT 'manual';

-- Especies carregadas pela lista oficial do MMA recebem fonte 'mma'
UPDATE especie SET categoria_fonte = 'mma' WHERE criado_em::date < '2026-09-05';

-- Especies criadas pela pipeline de IA recebem fonte 'ai'
UPDATE especie SET categoria_fonte = 'ai'
 WHERE id IN (
     SELECT DISTINCT especie_id FROM deteccao
      WHERE metodo_classificacao = 'ai' AND status = 'classified'
   )
   AND categoria_fonte = 'manual';
