import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type { Especie } from '../types/index.js';

const PAGE_SIZE = 15;
const VISIBLE_ITEMS = 5;

interface SpeciesSearchProps {
  onSelect: (especie: Especie) => void;
}

// Busca de espécies com scroll infinito — carrega a próxima página
// da API quando o usuário chega no fim da lista.
export default function SpeciesSearch({ onSelect }: SpeciesSearchProps) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Especie[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef('');

  const loadPage = useCallback(async (term: string, pageNum: number, append: boolean) => {
    setLoading(true);
    try {
      const res = await api.getEspecies({ busca: term, page: pageNum, per_page: PAGE_SIZE });
      const data = res.data as Especie[];
      setResults((prev) => (append ? [...prev, ...data] : data));
      setHasMore(data.length === PAGE_SIZE);
      setPage(pageNum);
    } catch {
      if (!append) setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setSearch(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setHasMore(false);
      setOpen(false);
      return;
    }
    searchRef.current = value;
    debounceRef.current = setTimeout(() => {
      void loadPage(value, 1, false);
    }, 350);
  };

  // Scroll infinito: ao chegar perto do fim, busca próxima página
  const handleScroll = () => {
    const el = listRef.current;
    if (!el || loading || !hasMore) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    if (nearBottom) {
      void loadPage(searchRef.current, page + 1, true);
    }
  };

  // Fecha ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (especie: Especie) => {
    onSelect(especie);
    setSearch('');
    setOpen(false);
    setResults([]);
    setHasMore(false);
  };

  return (
    <div className="species-search-map" ref={wrapRef}>
      <input
        type="text"
        className="filter-input"
        placeholder="Ex: onça, arara, jacaré..."
        value={search}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />
      {loading && results.length === 0 && <span className="species-search-hint">Buscando...</span>}

      {open && results.length > 0 && (
        <div
          className="species-search-results"
          ref={listRef}
          onScroll={handleScroll}
          style={{ maxHeight: `${VISIBLE_ITEMS * 44}px` }}
        >
          {results.map((s) => (
            <button
              key={s.id}
              className="species-search-item"
              onClick={() => handleSelect(s)}
            >
              <strong>{s.nome_popular || s.nome_cientifico}</strong>
              <span className="species-search-scientific">{s.nome_cientifico}</span>
            </button>
          ))}
          {loading && <div className="species-search-loading">Carregando...</div>}
          {!hasMore && !loading && results.length > 0 && (
            <div className="species-search-end">Fim dos resultados</div>
          )}
        </div>
      )}

    </div>
  );
}
