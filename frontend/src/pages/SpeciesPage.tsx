import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.js';
import type { Especie, PaginatedResponse } from '../types/index.js';

const TABS = ['Sobre', 'Ocorrências', 'Unidades de Conservação'] as const;
const PER_PAGE = 15;

export default function SpeciesPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<Especie[]>([]);
  const [selected, setSelected] = useState<Especie | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('Sobre');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(searchParams.get('busca') || '');

  const busca = searchParams.get('busca') || undefined;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (pageToLoad: number, append: boolean) => {
    if (pageToLoad === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await api.getEspecies({ busca, page: pageToLoad, per_page: PER_PAGE }) as PaginatedResponse<Especie>;
      setTotal(res.total);
      setItems((prev) => append ? [...prev, ...res.data] : res.data);
      setHasMore(res.data.length > 0 && (append ? prev.length + res.data.length : res.data.length) < res.total);
      setPage(pageToLoad);

      const idNum = id ? Number(id) : null;
      const found = idNum ? res.data.find((s) => s.id === idNum) : null;
      if (!append && (found || res.data[0])) {
        setSelected(found || res.data[0] || null);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [busca, id]);

  useEffect(() => {
    setPage(1);
    load(1, false);
  }, [busca, load]);

  useEffect(() => {
    if (page <= 1) return;
    load(page, true);
  }, [page]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
          setPage((p) => p + 1);
        }
      },
      { root: null, rootMargin: '100px', threshold: 0.1 }
    );

    const current = sentinelRef.current;
    if (current) observer.observe(current);
    return () => { if (current) observer.unobserve(current); };
  }, [hasMore, loadingMore, loading]);

  const handleSearch = () => {
    if (search) setSearchParams({ busca: search });
    else setSearchParams({});
  };

  const selectSpecies = (s: Especie) => {
    setSelected(s);
  };

  if (loading && items.length === 0) return <div className="loading">Carregando espécies...</div>;

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
          {items.map((s, index) => (
            <div
              key={s.id}
              ref={index === items.length - 1 ? sentinelRef : undefined}
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
          {loadingMore && <div className="loading">Carregando mais...</div>}
          {!hasMore && items.length > 0 && <div className="empty-state">Fim da lista</div>}
        </div>
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
