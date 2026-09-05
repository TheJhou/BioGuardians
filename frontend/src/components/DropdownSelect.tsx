import { useState, useRef, useEffect } from 'react';

interface DropdownSelectProps {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

// Dropdown que abre pra baixo, mostra até 5 itens com scroll interno
export default function DropdownSelect({
  options,
  selected,
  onSelect,
  placeholder = 'Todos',
  disabled = false,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((o) => o.value === selected)?.label ?? placeholder;

  const pick = (value: string | null) => {
    onSelect(value);
    setOpen(false);
  };

  return (
    <div className={`dropdown-select ${disabled ? 'disabled' : ''}`} ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className="dropdown-trigger-label">{disabled ? 'Em breve' : selectedLabel}</span>
        <span className={`dropdown-arrow ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <ul className="dropdown-list">
          <li
            className={`dropdown-item ${selected === null ? 'selected' : ''}`}
            onClick={() => pick(null)}
          >
            {placeholder}
          </li>
          {options.map((opt) => (
            <li
              key={opt.value}
              className={`dropdown-item ${selected === opt.value ? 'selected' : ''}`}
              onClick={() => pick(opt.value)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
