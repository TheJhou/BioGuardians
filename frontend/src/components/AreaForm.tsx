import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { UC_CATEGORY_LABELS, SPHERE_LABELS } from '../constants/index.js';
import type { Bioma } from '../types/index.js';

interface AreaFormProps {
  onSave: () => void;
  onCancel: () => void;
}

export default function AreaForm({ onSave, onCancel }: AreaFormProps) {
  const [biomas, setBiomas] = useState<Bioma[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    nome: '',
    categoria_uc: 'protecao_integral',
    esfera: 'federal',
    bioma_id: '',
    area_ha: '',
    geojson: '',
  });

  useEffect(() => {
    api.getBiomas().then(setBiomas);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let geojson: unknown;
      try {
        geojson = JSON.parse(form.geojson);
      } catch {
        setError('Invalid GeoJSON format');
        setSaving(false);
        return;
      }

      await api.createArea({
        nome: form.nome,
        categoria_uc: form.categoria_uc,
        esfera: form.esfera,
        bioma_id: form.bioma_id ? Number(form.bioma_id) : undefined,
        area_ha: form.area_ha ? Number(form.area_ha) : undefined,
        geojson,
      });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-modal">
      <form className="form-card" onSubmit={handleSubmit}>
        <h2>Add Protected Area</h2>
        {error && <div className="error">{error}</div>}

        <label>
          Name *
          <input
            type="text"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="e.g. Parque Nacional do Iguaçu"
            required
          />
        </label>

        <div className="form-row">
          <label>
            Category *
            <select
              value={form.categoria_uc}
              onChange={(e) => setForm({ ...form, categoria_uc: e.target.value })}
            >
              {Object.entries(UC_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Sphere *
            <select
              value={form.esfera}
              onChange={(e) => setForm({ ...form, esfera: e.target.value })}
            >
              {Object.entries(SPHERE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Biome
            <select
              value={form.bioma_id}
              onChange={(e) => setForm({ ...form, bioma_id: e.target.value })}
            >
              <option value="">Select biome...</option>
              {biomas.map((b) => (
                <option key={b.id} value={b.id}>{b.nome}</option>
              ))}
            </select>
          </label>

          <label>
            Area (ha)
            <input
              type="number"
              step="0.01"
              value={form.area_ha}
              onChange={(e) => setForm({ ...form, area_ha: e.target.value })}
              placeholder="e.g. 169895.00"
            />
          </label>
        </div>

        <label>
          GeoJSON Polygon *
          <textarea
            value={form.geojson}
            onChange={(e) => setForm({ ...form, geojson: e.target.value })}
            rows={6}
            placeholder='{"type":"Polygon","coordinates":[[[lng,lat],[lng,lat],...]]}'
            required
          />
          <small className="hint">
            Paste a GeoJSON Polygon geometry. Coordinates are [longitude, latitude] pairs.
          </small>
        </label>

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
