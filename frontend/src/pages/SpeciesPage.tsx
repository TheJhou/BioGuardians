import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.js';
import type { Especie } from '../types/index.js';

const TABS = ['Sobre', 'Ocorrências', 'Unidades de Conservação'] as const;

export default function SpeciesPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [result, setResult] = useState<{ data: Especie[]; total: number; total_pages: number } | null>(null);
  const [selected, setSelected] = useState<Especie | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('Sobre');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('busca') || '');

  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const perPage = 8;

  useEffect(() => {
    setLoading(true);
    const busca = searchParams.get('busca') || undefined;
    api.getEspecies({ busca, page, per_page: perPage })
      .then((res) => {
        setResult(res as { data: Especie[]; total: number; total_pages: number });
        const idNum = id ? Number(id) : null;
        const found = idNum ? res.data.find((s: Especie) => s.id === idNum) : null;
        setSelected(found || (res.data[0] as Especie) || null);
      })
      .catch(() => setResult({ data: [], total: 0, total_pages: 0 }))
      .finally(() => setLoading(false));
  }, [searchParams, id]);

  const handleSearch = () => {
    setSearchParams({ page: '1', ...(search ? { busca: search } : {}) });
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(p));
    setSearchParams(params);
  };

  const selectSpecies = (s: Especie) => {
    setSelected(s);
    setSearchParams({ ...Object.fromEntries(searchParams), page: String(page) });
  };

  if (loading) return <div className="loading">Carregando espécies...</div>;

  return (
    <div className="species-page">
      <aside className="species-list-panel">
        <Link to="/especies" className="species-back">← Espécies</Link>
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

        <div className="species-list">
          {result?.data.map((s: Especie) => (
            <div
              key={s.id}
              className={`species-item ${selected?.id === s.id ? 'active' : ''}`}
              onClick={() => selectSpecies(s)}
            >
              <div className="species-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />
                  <path d="M17.8 9.6c1.4 2.2 2.2 4.8 2.2 7.4 0 1.3-.4 2.5-1 3.5" />
                  <path d="M4 17c0-2.6.8-5.2 2.2-7.4" />
                  <path d="M12 19l4 2-3-6" />
                </svg>
              </div>
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
              <div className="species-image">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />
                  <path d="M17.8 9.6c1.4 2.2 2.2 4.8 2.2 7.4 0 1.3-.4 2.5-1 3.5" />
                  <path d="M4 17c0-2.6.8-5.2 2.2-7.4" />
                  <path d="M12 19l4 2-3-6" />
                </svg>
              </div>
              <div className="species-detail-meta">
                <h2>{selected.nome_popular || selected.nome_cientifico}</h2>
                <p className="species-detail-scientific">{selected.nome_cientifico}</p>
                <div className="species-badges">
                  <span className={`cat-badge cat-${selected.categoria_ameaca.toLowerCase()}`}>{selected.categoria_ameaca}</span>
                  <span className="species-source">MMA</span>
                </div>
              </div>
            </div>

            <div className="species-tabs">
              {TABS.map((t) => (
                <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>

            <div className="species-tab-content">
              {tab === 'Sobre' && (
                <div className="species-detail-grid">
                  <div className="detail-card">
                    <h4>Resumo da Espécie</h4>
                    <p>{selected.descricao || 'Sem descrição cadastrada.'}</p>
                  </div>
                  <div className="detail-card stats">
                    <StatCard value={0} label="Ocorrências" />
                    <StatCard value={selected.biomas?.length ?? 0} label="Biomas" />
                    <StatCard value={0} label="UCs com registros" />
                  </div>
                </div>
              )}
              {tab === 'Ocorrências' && <p className="empty-state">Ocorrências da espécie serão carregadas aqui.</p>}
              {tab === 'Unidades de Conservação' && <p className="empty-state">Unidades de conservação com registros serão listadas aqui.</p>}
            </div>
          </>
        ) : (
          <div className="empty-state">Selecione uma espécie para ver os detalhes.</div>
        )}
      </main>
    </div>
  );
}
