import { useRef, useCallback } from 'react';

interface TiltOptions {
  intensity?: number;
  scale?: number;
  glare?: boolean;
}

export function useTilt<T extends HTMLElement = HTMLDivElement>({
  intensity = 12,
  scale = 1.04,
  glare = true,
}: TiltOptions = {}) {
  const ref = useRef<T | null>(null);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<T>) => {
      const el = ref.current;
      if (!el) return;
      el.style.transition = 'transform 0.08s ease-out';
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const rotX = (0.5 - py) * intensity;
      const rotY = (px - 0.5) * intensity;
      el.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
      if (glare) el.style.setProperty('--tilt-glare-x', `${px * 100}%`);
      if (glare) el.style.setProperty('--tilt-glare-y', `${py * 100}%`);
      if (glare) el.style.setProperty('--tilt-glare-opacity', '1');
    },
    [intensity, scale, glare],
  );

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = 'perspective(800px) rotateX(0) rotateY(0) scale(1)';
    if (glare) el.style.setProperty('--tilt-glare-opacity', '0');
  }, [glare]);

  return { ref, onMouseMove, onMouseLeave };
}
