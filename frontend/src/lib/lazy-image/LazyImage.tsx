import { useState, type CSSProperties, type SyntheticEvent } from 'react';

interface LazyImageProps {
  src: string | undefined;
  alt: string;
  className?: string;
  skeletonClassName?: string;
  style?: CSSProperties;
  /** 'lazy' (default) adia o download até a imagem se aproximar da viewport. 'eager' para imagens acima da dobra. */
  loading?: 'lazy' | 'eager';
  onError?: (e: SyntheticEvent<HTMLImageElement>) => void;
}

/**
 * Imagem com lazy loading nativo, decode assíncrono e skeleton de placeholder
 * enquanto carrega. `loading="lazy"` é o padrão — use `eager` apenas para
 * imagens visíveis logo na primeira dobra da página.
 */
export default function LazyImage({
  src,
  alt,
  className = '',
  skeletonClassName = '',
  loading = 'lazy',
  onError,
  style,
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);

  if (!src) {
    return <div className={`skeleton ${skeletonClassName}`} aria-label="Carregando imagem" />;
  }

  return (
    <div className="image-skeleton-wrapper" style={{ position: 'relative' }}>
      {!loaded && (
        <div
          className={`skeleton ${skeletonClassName}`}
          style={{ position: 'absolute', inset: 0 }}
          aria-label="Carregando imagem"
        />
      )}
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setLoaded(true);
          onError?.(e);
        }}
        style={{ ...style, opacity: loaded ? (style?.opacity ?? 1) : 0, transition: 'opacity 0.2s ease' }}
      />
    </div>
  );
}
