import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { STATUS_OPTIONS } from '../constants/index.js';
import type { Bioma, Estado, Categoria, Taxon, Especie } from '../types/index.js';

interface SpeciesFormProps {
  especie?: Especie | null;
  onSave: () => void;
  onCancel: () => void;
}

export default function SpeciesForm({ especie, onSave, onCancel }: SpeciesFormProps) {
  const [biomas, setBiomas] = useState<Bioma[]>([]);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [generos, setGeneros] = useState<Taxon[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    nome_cientifico: especie?.nome_cientifico || '',
    nome_popular: especie?.nome_popular || '',
    categoria_ameaca: especie?.categoria_ameaca || 'VU',
    genero_id: especie?.genero_id || '',
    descricao: especie?.descricao || '',
    status: especie?.status || 'ativo',
    biomas: [] as number[],
    estados: [] as string[],
  });

  useEffect(() => {
    Promise.all([
      api.getBiomas(), api.getEstados(), api.getCategorias(), api.getTaxonomia('genero'),
    ]).then(([b, e, c, g]) => {
      setBiomas(b); setEstados(e); setCategorias(c); setGeneros(g);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (especie?.id) {
        await api.updateEspecie(especie.id, {
          nome_cientifico: form.nome_cientifico,
          nome_popular: form.nome_popular,
          categoria_ameaca: form.categoria_ameaca,
          genero_id: Number(form.genero_id),
          descricao: form.descricao,
          status: form.status,
        });
      } else {
        await api.createEspecie({
          nome_cientifico: form.nome_cientifico,
          nome_popular: form.nome_popular,
          categoria_ameaca: form.categoria_ameaca,
          genero_id: Number(form.genero_id),
          descricao: form.descricao,
          biomas: form.biomas,
          estados: form.estados,
        });
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleBioma = (id: number) => {
    setForm((f) => ({
      ...f,
      biomas: f.biomas.includes(id)
        ? f.biomas.filter((b) => b !== id)
        : [...f.biomas, id],
    }));
  };

  const toggleEstado = (uf: string) => {
    setForm((f) => ({
      ...f,
      estados: f.estados.includes(uf)
        ? f.estados.filter((e) => e !== uf)
        : [...f.estados, uf],
    }));
  };

  return (
    <div className="form-modal">
      <form className="form-card" onSubmit={handleSubmit}>
        <h2>{especie ? 'Edit Species' : 'Add Species'}</h2>
        {error && <div className="error">{error}</div>}

        <label>
          Scientific Name *
          <input
            type="text"
            value={form.nome_cientifico}
            onChange={(e) => setForm({ ...form, nome_cientifico: e.target.value.toLowerCase() })}
            placeholder="e.g. panthera onca"
            required
          />
        </label>

        <label>
          Popular Name
          <input
            type="text"
            value={form.nome_popular}
            onChange={(e) => setForm({ ...form, nome_popular: e.target.value })}
            placeholder="e.g. onca-pintada"
          />
        </label>

        <div className="form-row">
          <label>
            Threat Category *
            <select
              value={form.categoria_ameaca}
              onChange={(e) => setForm({ ...form, categoria_ameaca: e.target.value })}
            >
              {categorias.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.codigo} - {c.nome}</option>
              ))}
            </select>
          </label>

          <label>
            Genus *
            <select
              value={form.genero_id}
              onChange={(e) => setForm({ ...form, genero_id: Number(e.target.value) })}
              required
            >
              <option value="">Select genus...</option>
              {generos.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
          </label>
        </div>

        {especie && (
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Description
          <textarea
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            rows={3}
          />
        </label>

        {!especie && (
          <>
            <fieldset>
              <legend>Biomes</legend>
              <div className="checkbox-group">
                {biomas.map((b) => (
                  <label key={b.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.biomas.includes(b.id)}
                      onChange={() => toggleBioma(b.id)}
                    />
                    {b.nome}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>States (UF)</legend>
              <div className="checkbox-group">
                {estados.map((e) => (
                  <label key={e.uf} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.estados.includes(e.uf)}
                      onChange={() => toggleEstado(e.uf)}
                    />
                    {e.uf}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
