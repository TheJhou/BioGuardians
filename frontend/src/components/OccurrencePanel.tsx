import ImageWithSkeleton from './ImageWithSkeleton.js';
import { CATEGORY_LABELS } from '../constants/index.js';
import type { OcorrenciaProperties } from '../types/index.js';

interface OccurrencePanelProps {
  ocorrencia: OcorrenciaProperties;
  onClose: () => void;
}

export default function OccurrencePanel({ ocorrencia, onClose }: OccurrencePanelProps) {
  return (
    <div className="map-bottom-panel open">
      <button className="bottom-panel-close" onClick={onClose} aria-label="Fechar">
        ×
      </button>
      <div className="bottom-panel-content">
        <div className="bottom-panel-media">
          {ocorrencia.imagem_url ? (
            <ImageWithSkeleton
              src={ocorrencia.imagem_url || undefined}
              alt={ocorrencia.nome_cientifico}
              className="bottom-panel-img"
              skeletonClassName="bottom-panel-img-skeleton"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="bottom-panel-img-placeholder">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />
                <path d="M17.8 9.6c1.4 2.2 2.2 4.8 2.2 7.4 0 1.3-.4 2.5-1 3.5" />
                <path d="M4 17c0-2.6.8-5.2 2.2-7.4" />
                <path d="M12 19l4 2-3-6" />
              </svg>
            </div>
          )}
        </div>
        <div className="bottom-panel-body">
          <h4 className="bottom-panel-title">
            {ocorrencia.nome_popular || ocorrencia.nome_cientifico}
          </h4>
          <p className="bottom-panel-subtitle">{ocorrencia.nome_cientifico}</p>
          <span className={`cat-badge cat-${ocorrencia.categoria_ameaca.toLowerCase()}`}>
            {CATEGORY_LABELS[ocorrencia.categoria_ameaca] || ocorrencia.categoria_ameaca}
          </span>
          <div className="bottom-panel-meta">
            <span><strong>Data:</strong> {ocorrencia.data_evento || 'N/A'}</span>
            <span><strong>Fonte:</strong> {ocorrencia.fonte}</span>
            {ocorrencia.base_registro && (
              <span><strong>Base:</strong> {ocorrencia.base_registro}</span>
            )}
            {ocorrencia.confianca_ia != null && (
              <span><strong>IA:</strong> {Math.round(ocorrencia.confianca_ia * 100)}%</span>
            )}
            <span>{ocorrencia.lat.toFixed(4)}, {ocorrencia.lon.toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
