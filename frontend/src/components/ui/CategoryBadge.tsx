import { CATEGORY_LABELS, getCategoryColor, getCategoryTextColor } from '../../constants/index.js';

interface CategoryBadgeProps {
  /** Código da categoria de ameaça (CR, EN, VU, NT, LC, DD, NE). */
  code: string;
}

// Badge da categoria de ameaça. A cor vem de CATEGORY_COLORS (mesma fonte do
// mapa e da legenda); o formato fica em styles/components/category-badge.css.
export default function CategoryBadge({ code }: CategoryBadgeProps) {
  return (
    <span
      className="cat-badge"
      style={{ background: getCategoryColor(code), color: getCategoryTextColor(code) }}
    >
      {CATEGORY_LABELS[code] || code}
    </span>
  );
}
