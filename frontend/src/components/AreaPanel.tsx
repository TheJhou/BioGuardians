import { CATEGORY_LABELS } from '../constants/index.js';
import type { EspecieEmArea } from '../types/index.js';

interface AreaPanelProps {
  areaId: number;
  areaName: string;
  species: EspecieEmArea[];
  onClose: () => void;
}

export default function AreaPanel({ areaId, areaName, species, onClose }: AreaPanelProps) {
  return (
    <div className="map-bottom-panel open">
      <button className="bottom-panel-close" onClick={onClose} aria-label="Fechar">
        ×
      </button>
      <div className="bottom-panel-content">
        <div className="bottom-panel-body">
          <h4 className="bottom-panel-title">{areaName || `UC #${areaId}`}</h4>
          <p className="bottom-panel-subtitle">Espécies protegidas nesta UC</p>
          {species.length === 0 ? (
            <p className="bottom-panel-empty">Nenhuma espécie ameaçada encontrada.</p>
          ) : (
            <ul className="bottom-panel-list">
              {species.map((sp) => (
                <li key={sp.especie_id} className="bottom-panel-list-item">
                  <strong>{sp.nome_cientifico}</strong>
                  {sp.nome_popular && ` (${sp.nome_popular})`}
                  <span className={`cat-badge cat-${sp.categoria.toLowerCase()}`}>
                    {CATEGORY_LABELS[sp.categoria] || sp.categoria}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
