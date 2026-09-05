-- ---------- Fonte de ocorrencia: deteccao por IA ----------
-- A pipeline do ML service usa 'deteccao_ia' para ocorrencias vindas de
-- fontes genericas (local_dir, futuras fontes sem enum proprio).

ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'deteccao_ia';
