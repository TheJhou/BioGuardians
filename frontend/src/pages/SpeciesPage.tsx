import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { Especie } from '../types/index.js';
import StatCard from '../components/ui/StatCard.js';

const PLACEHOLDER = '/placeholder-animal.png';

export default function SpeciesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState<{ data: Especie[]; total: number; total_pages: number } | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Especie | null>(null);
  const [loading, setLoading] = useState(true);

  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const perPage = 20;

  useEffect(() => {
    const busca = searchParams.get('busca') || undefined;
    setSearchParams({ page: String(page), ...(busca ? { busca } : {}) }, { replace: true });

    setLoading(true);
    api.getEspecies({ busca, page, per_page: perPage })
      .then(setResult)
      .catch(() => setResult({ data: [], total: 0, total_pages: 0 }))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const handleSearch = () => {
    setSearchParams({ page: '1', ...(search ? { busca: search } : {}) });
  };

  const goToPage = (p: number) => {
    const busca = searchParams.get('busca');
    setSearchParams({ page: String(p), ...(busca ? { busca } : {}) });
  };

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
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} className="filter-apply">Buscar</button>
        </div>

        <div className="species-stats">
          {result && (
            <>
              <StatCard value={result.total} label="Total de espécies" variant="info" />
              <StatCard value={result.total_pages} label="Páginas" variant="info" />
            </>
          )}
        </div>

        <div className="species-list">
          {result?.data.map((s) => (
            <div
              key={s.id}
              className={`species-item ${selected?.id === s.id ? 'active' : ''}`}
              onClick={() => setSelected(s)}
            >
              <img className="species-thumb" src={PLACEHOLDER} alt={s.nome_popular || ''} />
              <div className="species-info">
                <span className="species-name">{s.nome_popular || s.nome_cientifico}</span>
                <span className="species-scientific">{s.nome_cientifico}</span>
                <span className={`cat-badge cat-${s.categoria_ameaca.toLowerCase()}`}>{s.categoria_ameaca}</span>
              </div>
            </div>
          ))}
        </div>

        {result && result.total_pages > 1 && (
          <div className="pagination">
            <button className="page-btn" disabled={page === 1} onClick={() => goToPage(page - 1)}>‹</button>
            {Array.from({ length: result.total_pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className={`page-btn ${p === page ? 'active' : ''}`}
                onClick={() => goToPage(p)}
              >
                {p}
              </button>
            ))}
            <button className="page-btn" disabled={page === result.total_pages} onClick={() => goToPage(page + 1)}>›</button>
          </div>
        )}
      </aside>

      <main className="species-detail">
        {selected ? (
          <>
            <div className="species-detail-header">
              <img className="species-image" src={PLACEHOLDER} alt={selected.nome_popular || ''} />
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
              <p>{selected.descricao || 'Sem descrição cadastrada.'}</p>
            </div>
          </>
        ) : (
          <div className="empty-state">Selecione uma espécie para ver os detalhes.</div>
        )}
      </main>
    </div>
  );
}
