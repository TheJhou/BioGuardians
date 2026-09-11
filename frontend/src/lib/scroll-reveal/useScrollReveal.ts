import { useLayoutEffect, useRef } from 'react';

export interface ScrollRevealOptions {
  /** Delay entre itens de um mesmo grupo (ms). Default: 50 */
  stagger?: number;
  /** Itens por grupo de stagger. Default: 4 */
  groupSize?: number;
  /** Threshold do IntersectionObserver. Default: 0.1 */
  threshold?: number;
  /** Root margin do observer. Default: '0px 0px -20px 0px' */
  rootMargin?: string;
  /** Distância (px) do translateY na animação. Default: 60 */
  offset?: number;
}

/** Remove a flag de exibição instantânea após dois frames, liberando animações futuras. */
function clearInstantFlags(root: HTMLElement) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.querySelectorAll('.sr-instant').forEach((el) => el.classList.remove('sr-instant'));
    });
  });
}

/**
 * Scroll reveal — elementos com [data-reveal] dentro do container
 * ganham .sr-reveal (invisível + translateY) e recebem .sr-visible
 * quando entram na viewport. delay escalonado em grupos.
 *
 * - Na entrada da página: visíveis aparecem sem animar (sr-instant)
 * - Ao rolar: elementos entram/saem animando nas duas direções
 * - Saiu por cima → volta descendo; saiu por baixo → volta subindo
 *
 * Requer o CSS de `scroll-reveal.css` importado no projeto.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: ScrollRevealOptions = {},
) {
  const {
    stagger = 50,
    groupSize = 4,
    threshold = 0.1,
    rootMargin = '0px 0px -20px 0px',
    offset = 60,
  } = options;

  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const els = root.querySelectorAll<HTMLElement>('[data-reveal]');
    els.forEach((el, i) => {
      el.classList.add('sr-reveal');
      el.style.setProperty('--sr-offset', `${offset}px`);
      el.style.transitionDelay = `${(i % groupSize) * stagger}ms`;
    });

    let initial = true;

    const obs = new IntersectionObserver((entries) => {
      const rootTop = root.getBoundingClientRect().top;

      entries.forEach((entry) => {
        const el = entry.target as HTMLElement;

        if (entry.isIntersecting) {
          if (initial) el.classList.add('sr-instant');
          el.classList.add('sr-visible');
          el.classList.remove('sr-from-top');
        } else {
          el.classList.remove('sr-visible');
          el.classList.toggle('sr-from-top', entry.boundingClientRect.top < rootTop);
        }
      });

      initial = false;

      if (root.querySelector('.sr-instant')) {
        clearInstantFlags(root);
      }
    }, { threshold, rootMargin });

    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [stagger, groupSize, threshold, rootMargin, offset]);

  return ref;
}
