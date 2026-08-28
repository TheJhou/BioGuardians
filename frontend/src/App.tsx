import { useState } from 'react';
import MapView from './components/MapView.js';
import SpeciesList from './components/SpeciesList.js';
import SpeciesForm from './components/SpeciesForm.js';
import AreaForm from './components/AreaForm.js';
import Dashboard from './components/Dashboard.js';
import { BIOME_OPTIONS, CATEGORY_OPTIONS } from './constants/index.js';
import type { Especie } from './types/index.js';

type Tab = 'map' | 'species' | 'areas' | 'dashboard';

export default function App() {
  const [tab, setTab] = useState<Tab>('map');
  const [filters, setFilters] = useState<{
    categoria?: string; bioma?: number; estado?: string; busca?: string;
  }>({});
  const [selectedEspecieId, setSelectedEspecieId] = useState<number | null>(null);
  const [showSpeciesForm, setShowSpeciesForm] = useState(false);
  const [editingEspecie, setEditingEspecie] = useState<Especie | null>(null);
  const [showAreaForm, setShowAreaForm] = useState(false);

  const handleSelectEspecie = (id: number) => {
    setSelectedEspecieId(id);
    setTab('map');
  };

  const handleEditEspecie = (esp: Especie) => {
    setEditingEspecie(esp);
    setShowSpeciesForm(true);
  };

  const handleAddEspecie = () => {
    setEditingEspecie(null);
    setShowSpeciesForm(true);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>BioGuardians</h1>
        <span className="subtitle">Brazilian Biodiversity & Protected Areas</span>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button
          className={`nav-btn ${tab === 'map' ? 'active' : ''}`}
          onClick={() => setTab('map')}
        >Map</button>
        <button
          className={`nav-btn ${tab === 'species' ? 'active' : ''}`}
          onClick={() => setTab('species')}
        >Species</button>
        <button
          className={`nav-btn ${tab === 'areas' ? 'active' : ''}`}
          onClick={() => setTab('areas')}
        >Protected Areas</button>
        <button
          className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setTab('dashboard')}
        >Dashboard</button>
      </nav>

      {/* Filters bar (visible on map and species tabs) */}
      {(tab === 'map' || tab === 'species') && (
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Search species..."
            value={filters.busca || ''}
            onChange={(e) => setFilters({ ...filters, busca: e.target.value || undefined })}
          />
          <select
            value={filters.categoria || ''}
            onChange={(e) => setFilters({ ...filters, categoria: e.target.value || undefined })}
          >
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>
          <select
            value={filters.bioma ? String(filters.bioma) : ''}
            onChange={(e) => setFilters({ ...filters, bioma: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">All biomes</option>
            {BIOME_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.nome}</option>
            ))}
          </select>
          {selectedEspecieId && (
            <button
              className="btn btn-sm"
              onClick={() => setSelectedEspecieId(null)}
            >Clear species filter</button>
          )}
        </div>
      )}

      {/* Main content */}
      <main className="app-main">
        {tab === 'map' && (
          <MapView filters={filters} selectedEspecieId={selectedEspecieId} />
        )}
        {tab === 'species' && (
          <SpeciesList
            filters={filters}
            onSelectEspecie={handleSelectEspecie}
            onEditEspecie={handleEditEspecie}
            onAddEspecie={handleAddEspecie}
          />
        )}
        {tab === 'areas' && (
          <div className="areas-tab">
            <div className="list-header">
              <h2>Protected Areas</h2>
              <button className="btn btn-primary" onClick={() => setShowAreaForm(true)}>
                + Add Area
              </button>
            </div>
            <p className="hint">
              View protected areas on the Map tab. Click a polygon to see
              threatened species inside each area.
            </p>
          </div>
        )}
        {tab === 'dashboard' && <Dashboard />}
      </main>

      {/* Modals */}
      {showSpeciesForm && (
        <SpeciesForm
          especie={editingEspecie}
          onSave={() => { setShowSpeciesForm(false); setEditingEspecie(null); }}
          onCancel={() => { setShowSpeciesForm(false); setEditingEspecie(null); }}
        />
      )}
      {showAreaForm && (
        <AreaForm
          onSave={() => setShowAreaForm(false)}
          onCancel={() => setShowAreaForm(false)}
        />
      )}
    </div>
  );
}
