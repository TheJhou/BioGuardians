-- ---------- Aplica NE nas especies nao-fauna ----------

INSERT INTO categoria_ameaca (codigo, nome, descricao, ordem_prioridade)
VALUES ('NE', 'Sem Risco', 'Espécie não avaliada para risco de extinção (não-fauna: humanos, animais domésticos).', 7)
ON CONFLICT (codigo) DO NOTHING;

UPDATE especie
   SET categoria_ameaca = 'NE',
       categoria_fonte = 'manual',
       status = 'inativo',
       atualizado_em = now()
 WHERE nome_cientifico IN (
     'homo sapiens',
     'bos taurus',
     'canis familiaris',
     'canis lupus familiaris',
     'felis catus',
     'equus caballus',
     'equus asinus',
     'sus scrofa',
     'capra hircus',
     'ovis aries',
     'gallus gallus',
     'bubalus bubalis'
 );
