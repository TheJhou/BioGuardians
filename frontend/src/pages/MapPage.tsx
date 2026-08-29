import { useState } from 'react';
import MapView from '../components/MapView.js';
import { BIOME_OPTIONS, UC_CATEGORY_OPTIONS, SPHERE_OPTIONS } from '../constants/index.js';

interface MapFilters {
  busca?: string;
  bioma?: number;
  categoria?: string;
  esfera?: string;
}

interface MapLayers {
  unidades: boolean;
  ocorrencias: boolean;
  especies: boolean;
}

const defaultFilters: MapFilters = {};
const defaultLayers: MapLayers = { unidades: true, ocorrencias: true, especies: false };

export default function MapPage() {
  const [draft, setDraft] = useState<MapFilters>(defaultFilters);
  const [applied, setApplied] = useState<MapFilters>(defaultFilters);
  const [layers, setLayers] = useState<MapLayers>(defaultLayers);

  const handleApply = () => {
    setApplied(draft);
  };

  const handleClear = () => {
    setDraft(defaultFilters);
    setApplied(defaultFilters);
    setLayers(defaultLayers);
  };

  const updateDraft = (patch: Partial<MapFilters>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="map-page">
      <aside className="map-sidebar">
        <h3 className="sidebar-title">Filtros</h3>
        <button className="map-clear-btn" onClick={handleClear}>
          Limpar
        </button>

        <div className="filter-group">
          <label className="filter-label">Buscar UC</label>
          <input
            type="text"
            className="filter-input"
            placeholder="Ex: Pantanal..."
            value={draft.busca || ''}
            onChange={(e) => updateDraft({ busca: e.target.value || undefined })}
          />
        </div>

        <div className="filter-group">
          <label className="filter-label">Bioma</label>
          <select
            className="filter-select"
            value={draft.bioma ? String(draft.bioma) : ''}
            onChange={(e) => updateDraft({ bioma: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Todos</option>
            {BIOME_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.nome}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Categoria da UC</label>
          <select
            className="filter-select"
            value={draft.categoria || ''}
            onChange={(e) => updateDraft({ categoria: e.target.value || undefined })}
          >
            <option value="">Todas</option>
            {UC_CATEGORY_OPTIONS.map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Esfera</label>
          <select
            className="filter-select"
            value={draft.esfera || ''}
            onChange={(e) => updateDraft({ esfera: e.target.value || undefined })}
          >
            <option value="">Todas</option>
            {SPHERE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.nome}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Camadas</label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.unidades}
              onChange={(e) => setLayers({ ...layers, unidades: e.target.checked })}
            />
            Unidades de Conservação
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.ocorrencias}
              onChange={(e) => setLayers({ ...layers, ocorrencias: e.target.checked })}
            />
            Ocorrências
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layers.especies}
              onChange={(e) => setLayers({ ...layers, especies: e.target.checked })}
            />
            Espécies
          </label>
        </div>

        <button className="filter-apply" onClick={handleApply}>
          Aplicar Filtros
        </button>

        <div className="map-legend">
          <h4>Legenda</h4>
          <div className="legend-section">
            <span className="legend-section-title">Unidades de Conservação</span>
            <div className="legend-item"><span className="legend-dot dot-uc-fed"></span> Federal</div>
            <div className="legend-item"><span className="legend-dot dot-uc-est"></span> Estadual</div>
            <div className="legend-item"><span className="legend-dot dot-uc-mun"></span> Municipal</div>
            <div className="legend-item"><span className="legend-dot dot-uc-part"></span> Particular</div>
          </div>
          <div className="legend-section">
            <span className="legend-section-title">Registros</span>
            <div className="legend-item"><span className="legend-dot dot-occ"></span> Ocorrências</div>
          </div>
        </div>
      </aside>

      <div className="map-wrapper">
        <MapView
          filters={applied}
          layers={layers}
          selectedEspecieId={null}
        />
      </div>
    </div>
  );
}
