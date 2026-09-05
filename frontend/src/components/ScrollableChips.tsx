import { useRef } from 'react';

interface ScrollableChipsProps {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

// Selector em chips com scroll horizontal interno
export default function ScrollableChips({
  options,
  selected,
  onSelect,
  placeholder = 'Todos',
  disabled = false,
}: ScrollableChipsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' });
  };

  if (disabled) {
    return (
      <div className="chip-scroll-wrapper disabled">
        <div className="chip-scroll">
          {options.slice(0, 8).map((opt) => (
            <span key={opt.value} className="chip disabled-chip">{opt.label}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chip-scroll-wrapper">
      <button className="chip-scroll-btn" onClick={() => scroll(-1)} aria-label="Anterior">‹</button>
      <div className="chip-scroll" ref={scrollRef}>
        <button
          className={`chip ${selected === null ? 'selected' : ''}`}
          onClick={() => onSelect(null)}
        >
          {placeholder}
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`chip ${selected === opt.value ? 'selected' : ''}`}
            onClick={() => onSelect(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <button className="chip-scroll-btn" onClick={() => scroll(1)} aria-label="Próximo">›</button>
    </div>
  );
}
