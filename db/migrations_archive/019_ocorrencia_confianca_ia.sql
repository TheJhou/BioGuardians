-- ---------- Confianca da IA na ocorrencia ----------
-- A confianca do classificador ficava embutida em base_registro como
-- texto ("Auto-classification (openrouter, confianca: 0.70)").
-- Agora vira coluna numerica propria.

ALTER TABLE ocorrencia
    ADD COLUMN IF NOT EXISTS confianca_ia NUMERIC(5,4);

-- Backfill: extrai a confianca do texto antigo em base_registro
UPDATE ocorrencia
   SET confianca_ia = substring(base_registro from 'confianca: ([0-9.]+)')::numeric
 WHERE confianca_ia IS NULL
   AND base_registro ~ 'confianca: [0-9.]+';

-- Limpa o texto para algo legivel
UPDATE ocorrencia
   SET base_registro = 'Classificacao automatica por IA'
 WHERE base_registro LIKE 'Auto-classification%';
