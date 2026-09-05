-- ---------- Nova categoria NE (Sem Risco / Not Evaluated) ----------
-- Usada para especies que nao sao fauna silvestre (humanos, animais
-- domesticos) ou que nunca serao avaliadas para risco de extincao.
-- NOTA: ADD VALUE nao pode ser usada na mesma transacao que consome o
-- novo valor — por isso o UPDATE esta na migration 022.

ALTER TYPE categoria_ameaca_tipo ADD VALUE IF NOT EXISTS 'NE';
