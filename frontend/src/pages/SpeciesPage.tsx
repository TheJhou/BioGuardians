import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useEffect } from 'react';
import type { Especie } from '../types/index.js';

const mockSpecies: Especie[] = [
  { id: 1, nome_cientifico: 'Panthera onca', nome_popular: 'Onça-pintada', categoria_ameaca: 'VU', status: 'ativo' },
  { id: 2, nome_cientifico: 'Ara ararauna', nome_popular: 'Arara-azul-grande', categoria_ameaca: 'LC', status: 'ativo' },
];

export default function SpeciesPage() {
  const [species, setSpecies] = useState<Especie[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Especie | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEspecies({})
      .then((data) => { setSpecies(Array.isArray(data) ? data as Especie[] : mockSpecies); })
      .catch(() => setSpecies(mockSpecies))
      .finally(() => setLoading(false));
  }, []);

  const filtered = species.filter((s) =>
    s.nome_cientifico.toLowerCase().includes(search.toLowerCase()) ||
    (s.nome_popular && s.nome_popular.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) return <div className="loading">Carregando espécies...</div>;

  return (
    <div className="species-page">
      <aside className="species-list-panel">
        <div className="species-search">
          <input
            type="text"
            placeholder="Buscar espécie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="species-list">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`species-item ${selected?.id === s.id ? 'active' : ''}`}
              onClick={() => setSelected(s)}
            >
              <img className="species-thumb" src="/placeholder-animal.png" alt={s.nome_popular || ''} />
              <div className="species-info">
                <span className="species-name">{s.nome_popular || s.nome_cientifico}</span>
                <span className="species-scientific">{s.nome_cientifico}</span>
                <span className={`cat-badge cat-${s.categoria_ameaca.toLowerCase()}`}>{s.categoria_ameaca}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="pagination">
          <button className="page-btn">1</button>
          <button className="page-btn">2</button>
          <button className="page-btn">3</button>
          <button className="page-btn">4</button>
          <button className="page-btn">5</button>
        </div>
      </aside>

      <main className="species-detail">
        {selected ? (
          <>
            <div className="species-detail-header">
              <img className="species-image" src="/placeholder-animal-large.png" alt={selected.nome_popular || ''} />
              <div>
                <h2>{selected.nome_popular || selected.nome_cientifico}</h2>
                <p className="species-detail-scientific">{selected.nome_cientifico}</p>
                <span className={`cat-badge cat-${selected.categoria_ameaca.toLowerCase()}`}>{selected.categoria_ameaca}</span>
                <span className="species-source">MMA</span>
              </div>
            </div>
            <div className="species-tabs">
              <button className="tab active">Sobre</button>
              <button className="tab">Ocorrências</button>
              <button className="tab">Unidades de Conservação</button>
            </div>
            <div className="species-tab-content">
              <p>Informações sobre a espécie em análise.</p>
            </div>
          </>
        ) : (
          <div className="empty-state">Selecione uma espécie para ver os detalhes.</div>
        )}
      </main>
    </div>
  );
}
