import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Animated tabs — sliding underline indicator + crossfade content.
 * Sem dependências (sem framer-motion). Usa CSS transition no underline
 * e keyframes no conteúdo para o efeito de crossfade.
 */
export function useAnimatedTabs<T extends string>(tabs: readonly T[], initial: T) {
  const [active, setActive] = useState<T>(initial);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback((tab: T) => {
    const el = refs.current[tab];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, []);

  const select = useCallback((tab: T) => {
    setActive(tab);
    updateIndicator(tab);
  }, [updateIndicator]);

  useEffect(() => {
    updateIndicator(active);
    const onResize = () => updateIndicator(active);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active, updateIndicator]);

  const setRef = useCallback((tab: T) => (el: HTMLButtonElement | null) => {
    refs.current[tab] = el;
  }, []);

  return { active, select, setRef, indicator };
}
