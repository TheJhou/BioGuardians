import { useState } from 'react';

interface PaginatedSelectProps {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  pageSize?: number;
  disabled?: boolean;
}

// Selector com paginação interna — mostra N itens por página
export default function PaginatedSelect({
  options,
  selected,
  onSelect,
  placeholder = 'Todos',
  pageSize = 5,
  disabled = false,
}: PaginatedSelectProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(options.length / pageSize);
  const pageItems = options.slice(page * pageSize, (page + 1) * pageSize);

  if (disabled) {
    return (
      <div className="paginated-select disabled">
        <span className="paginated-select-empty">Em breve</span>
      </div>
    );
  }

  return (
    <div className="paginated-select">
      <button
        className={`paginated-item ${selected === null ? 'selected' : ''}`}
        onClick={() => onSelect(null)}
      >
        {placeholder}
      </button>

      {pageItems.map((opt) => (
        <button
          key={opt.value}
          className={`paginated-item ${selected === opt.value ? 'selected' : ''}`}
          onClick={() => onSelect(opt.value)}
        >
          {opt.label}
        </button>
      ))}

      {totalPages > 1 && (
        <div className="paginated-nav">
          <button
            className="paginated-nav-btn"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span className="paginated-nav-info">
            {page + 1}/{totalPages}
          </span>
          <button
            className="paginated-nav-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
