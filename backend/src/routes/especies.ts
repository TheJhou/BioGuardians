import { Router } from 'express';
import { query } from '../db/pool.js';
import { validateId } from '../middleware/validateId.js';
import { cacheInvalidateAll } from '../cache/cache.js';
import { parseParam, getParam } from '../utils/params.js';
import { paginate, getPaginationParams } from '../utils/paginate.js';

const router = Router();

// GET /api/especies?categoria=CR&bioma=1&estado=SP&status=ativo&busca=onca&page=1&per_page=20
router.get('/', async (req, res, next) => {
  try {
    const { categoria, bioma, estado, status, busca } = req.query;
    const { page, perPage, offset } = getPaginationParams(req.query);

    // Full-text search takes priority when 'busca' is provided.
    if (busca && typeof busca === 'string') {
      const searchConditions: string[] = ["e.tsv_busca @@ plainto_tsquery('portuguese', $1)"];
      const searchParams: unknown[] = [busca];
      let searchIdx = 2;

      if (categoria) {
        searchConditions.push(`e.categoria_ameaca = $${searchIdx++}`);
        searchParams.push(categoria);
      }
      if (status) {
        searchConditions.push(`e.status = $${searchIdx++}`);
        searchParams.push(status);
      }
      if (bioma) {
        searchConditions.push(`EXISTS (SELECT 1 FROM especie_bioma eb WHERE eb.especie_id = e.id AND eb.bioma_id = $${searchIdx++})`);
        searchParams.push(parseParam(bioma));
      }
      if (estado) {
        searchConditions.push(`EXISTS (SELECT 1 FROM especie_estado ee WHERE ee.especie_id = e.id AND ee.estado_uf = $${searchIdx++})`);
        searchParams.push(estado);
      }

      const { rows } = await query(
        `SELECT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca, e.imagem_url,
                COUNT(*) OVER() AS full_count
         FROM especie e
         WHERE ${searchConditions.join(' AND ')}
         ORDER BY ts_rank(e.tsv_busca, plainto_tsquery('portuguese', $1)) DESC
         LIMIT $${searchIdx++} OFFSET $${searchIdx++}`,
        [...searchParams, perPage, offset]
      );

      const total = rows.length > 0 ? Number(rows[0].full_count) : 0;
      const data = rows.map((r: any) => {
        const { full_count, ...rest } = r;
        return rest;
      });

      res.json(paginate(data, page, perPage, total));
      return;
    }

    // Build dynamic WHERE with parameterized query.
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (categoria) {
      conditions.push(`e.categoria_ameaca = $${idx++}`);
      params.push(categoria);
    }
    if (status) {
      conditions.push(`e.status = $${idx++}`);
      params.push(status);
    }
    if (bioma) {
      conditions.push(`EXISTS (SELECT 1 FROM especie_bioma eb WHERE eb.especie_id = e.id AND eb.bioma_id = $${idx++})`);
      params.push(parseParam(bioma));
    }
    if (estado) {
      conditions.push(`EXISTS (SELECT 1 FROM especie_estado ee WHERE ee.especie_id = e.id AND ee.estado_uf = $${idx++})`);
      params.push(estado);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const { rows } = await query(
      `SELECT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca, e.imagem_url,
              COUNT(*) OVER() AS full_count
       FROM especie e
       ${where}
       ORDER BY e.nome_cientifico
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, perPage, offset]
    );

    const total = rows.length > 0 ? Number(rows[0].full_count) : 0;
    const data = rows.map((r: any) => {
      const { full_count, ...rest } = r;
      return rest;
    });

    res.json(paginate(data, page, perPage, total));
  } catch (err) { next(err); }
});

// GET /api/especies/:id — detail with biomes, states, genus
router.get('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;

    const { rows: espRows } = await query(
      `SELECT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca,
              e.descricao, e.imagem_url, e.status, e.criado_em, e.atualizado_em,
              g.id AS genero_id, g.nome AS genero_nome
       FROM especie e
       JOIN taxon g ON g.id = e.genero_id
       WHERE e.id = $1`,
      [id]
    );

    if (espRows.length === 0) {
      res.status(404).json({ error: 'Species not found' });
      return;
    }

    const especie = espRows[0];

    const { rows: biomas } = await query(
      `SELECT b.id, b.nome FROM especie_bioma eb
       JOIN bioma b ON b.id = eb.bioma_id WHERE eb.especie_id = $1 ORDER BY b.nome`,
      [id]
    );

    const { rows: estados } = await query(
      `SELECT s.uf, s.nome FROM especie_estado ee
       JOIN estado s ON s.uf = ee.estado_uf WHERE ee.especie_id = $1 ORDER BY s.uf`,
      [id]
    );

    res.json({ ...especie, biomas, estados });
  } catch (err) { next(err); }
});

// GET /api/especies/:id/areas-protegidas — spatial query
router.get('/:id/areas-protegidas', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rows } = await query('SELECT * FROM areas_protegem_especie($1)', [id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/especies
router.post('/', async (req, res, next) => {
  try {
    const { nome_cientifico, nome_popular, categoria_ameaca, genero_id, descricao, biomas, estados } = req.body;

    if (!nome_cientifico || !categoria_ameaca || !genero_id) {
      res.status(400).json({ error: 'nome_cientifico, categoria_ameaca and genero_id are required' });
      return;
    }

    const result = await query(
      `INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id, descricao)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nome_cientifico.toLowerCase().trim(), nome_popular || null, categoria_ameaca, genero_id, descricao || null]
    );

    const newId = result.rows[0].id;

    if (Array.isArray(biomas) && biomas.length > 0) {
      const values = biomas.map((_: number, i: number) => `($1, $${i + 2})`).join(', ');
      await query(`INSERT INTO especie_bioma (especie_id, bioma_id) VALUES ${values}`, [newId, ...biomas]);
    }

    if (Array.isArray(estados) && estados.length > 0) {
      const values = estados.map((_: string, i: number) => `($1, $${i + 2})`).join(', ');
      await query(`INSERT INTO especie_estado (especie_id, estado_uf) VALUES ${values}`, [newId, ...estados]);
    }

    cacheInvalidateAll(['route:/api/especies', 'route:/api/dashboard']);
    res.status(201).json({ id: newId, message: 'Species created' });
  } catch (err) { next(err); }
});

// PUT /api/especies/:id
router.put('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { nome_cientifico, nome_popular, categoria_ameaca, genero_id, descricao, status: st } = req.body;

    const { rowCount } = await query(
      `UPDATE especie SET
         nome_cientifico = COALESCE($1, nome_cientifico),
         nome_popular = COALESCE($2, nome_popular),
         categoria_ameaca = COALESCE($3, categoria_ameaca),
         genero_id = COALESCE($4, genero_id),
         descricao = COALESCE($5, descricao),
         status = COALESCE($6, status)
       WHERE id = $7`,
      [nome_cientifico?.toLowerCase().trim(), nome_popular, categoria_ameaca, genero_id, descricao, st, id]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Species not found' });
      return;
    }

    cacheInvalidateAll(['route:/api/especies', 'route:/api/dashboard']);
    res.json({ message: 'Species updated' });
  } catch (err) { next(err); }
});

// DELETE /api/especies/:id
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rowCount } = await query('DELETE FROM especie WHERE id = $1', [id]);

    if (rowCount === 0) {
      res.status(404).json({ error: 'Species not found' });
      return;
    }

    cacheInvalidateAll(['route:/api/especies', 'route:/api/dashboard']);
    res.json({ message: 'Species deleted' });
  } catch (err) { next(err); }
});

export default router;
