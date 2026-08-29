import { useState } from 'react';

interface ImageWithSkeletonProps {
  src: string | undefined;
  alt: string;
  className?: string;
  skeletonClassName?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export default function ImageWithSkeleton({
  src,
  alt,
  className = '',
  skeletonClassName = '',
  onError,
}: ImageWithSkeletonProps) {
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
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setLoaded(true);
          onError?.(e);
        }}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.2s ease' }}
      />
    </div>
  );
}
