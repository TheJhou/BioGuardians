import { useState } from 'react';
import MapView from '../components/MapView.js';
import { BIOME_OPTIONS, CATEGORY_OPTIONS } from '../constants/index.js';

export default function MapPage() {
  const [filters, setFilters] = useState<{
    busca?: string;
    bioma?: number;
    categoria?: string;
    camadas: { unidades: boolean; ocorrencias: boolean; especies: boolean };
  }>({
    camadas: { unidades: true, ocorrencias: true, especies: false },
  });

  return (
    <div className="map-page">
      <aside className="map-sidebar">
        <h3 className="sidebar-title">Filtros</h3>
        <button
          className="map-clear-btn"
          onClick={() => setFilters({ camadas: { unidades: true, ocorrencias: true, especies: false } })}
        >
          Limpar
        </button>

        <div className="filter-group">
          <label className="filter-label">Buscar localização</label>
          <input
            type="text"
            className="filter-input"
            placeholder="Ex: Pantanal, Amazônia..."
            value={filters.busca || ''}
            onChange={(e) => setFilters({ ...filters, busca: e.target.value || undefined })}
          />
        </div>

        <div className="filter-group">
          <label className="filter-label">Bioma</label>
          <select
            className="filter-select"
            value={filters.bioma ? String(filters.bioma) : ''}
            onChange={(e) => setFilters({ ...filters, bioma: e.target.value ? Number(e.target.value) : undefined })}
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
            value={filters.categoria || ''}
            onChange={(e) => setFilters({ ...filters, categoria: e.target.value || undefined })}
          >
            <option value="">Todas</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Esfera</label>
          <select className="filter-select">
            <option value="">Todas</option>
            <option value="Federal">Federal</option>
            <option value="Estadual">Estadual</option>
            <option value="Municipal">Municipal</option>
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Camadas</label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.camadas.unidades}
              onChange={(e) => setFilters({ ...filters, camadas: { ...filters.camadas, unidades: e.target.checked } })}
            />
            Unidades de Conservação
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.camadas.ocorrencias}
              onChange={(e) => setFilters({ ...filters, camadas: { ...filters.camadas, ocorrencias: e.target.checked } })}
            />
            Ocorrências
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.camadas.especies}
              onChange={(e) => setFilters({ ...filters, camadas: { ...filters.camadas, especies: e.target.checked } })}
            />
            Espécies
          </label>
        </div>

        <button className="filter-apply">Aplicar Filtros</button>

        <div className="map-legend">
          <h4>Legenda</h4>
          <div className="legend-item"><span className="legend-dot dot-uc-fed"></span> UCs Federais</div>
          <div className="legend-item"><span className="legend-dot dot-uc-est"></span> UCs Estaduais</div>
          <div className="legend-item"><span className="legend-dot dot-uc-mun"></span> UCs Municipais</div>
          <div className="legend-item"><span className="legend-dot dot-occ"></span> Ocorrências</div>
        </div>
      </aside>

      <div className="map-wrapper">
        <MapView
          filters={{ bioma: filters.bioma, categoria: filters.categoria, busca: filters.busca }}
          selectedEspecieId={null}
        />
      </div>
    </div>
  );
}
