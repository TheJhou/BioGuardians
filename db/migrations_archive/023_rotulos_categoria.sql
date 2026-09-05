-- ---------- Rotulos em portugues claro das categorias ----------
-- Padroniza os nomes de exibicao para linguagem acessivel ao publico.

-- Ordem importa: NE deve sair de 'Sem Risco' antes de LC assumir o nome
UPDATE categoria_ameaca SET nome = 'Não Avaliada',                     descricao = 'Espécie não avaliada para risco de extinção (não-fauna).' WHERE codigo = 'NE';
UPDATE categoria_ameaca SET nome = 'Entrando em Extinção',             descricao = 'População entrando em processo de extinção.'               WHERE codigo = 'EN';
UPDATE categoria_ameaca SET nome = 'Alto Risco de Entrar em Extinção', descricao = 'Alto risco de entrar em extinção na natureza.'             WHERE codigo = 'VU';
UPDATE categoria_ameaca SET nome = 'Em Ameaça',                        descricao = 'Espécie sob ameaça, próxima de risco elevado.'             WHERE codigo = 'NT';
UPDATE categoria_ameaca SET nome = 'Sem Risco',                        descricao = 'Ampla distribuição, população estável.'                    WHERE codigo = 'LC';
UPDATE categoria_ameaca SET nome = 'Sem Dados para Avaliar',           descricao = 'Informação insuficiente para avaliar o risco.'             WHERE codigo = 'DD';
