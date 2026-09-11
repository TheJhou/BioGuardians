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
  /** Duração da transição em ms. Default: 300 */
  duration?: number;
  /**
   * Se true (default), elementos visíveis no primeiro batch aparecem sem
   * animar (entrada de página). Se false, o primeiro batch anima também —
   * útil para listas que só populam quando dados chegam via API.
   */
  instantOnLoad?: boolean;
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
  deps: unknown[] = [],
) {
  const {
    stagger = 50,
    groupSize = 4,
    threshold = 0.1,
    rootMargin = '0px 0px -20px 0px',
    offset = 60,
    duration = 300,
    instantOnLoad = true,
  } = options;

  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const seen = new Set<HTMLElement>();
    let count = 0;
    const prepare = (el: HTMLElement) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.classList.add('sr-reveal');
      el.style.setProperty('--sr-offset', `${offset}px`);
      el.style.setProperty('--sr-duration', `${duration}ms`);
      el.style.transitionDelay = `${(count++ % groupSize) * stagger}ms`;
    };

    const els = root.querySelectorAll<HTMLElement>('[data-reveal]');
    els.forEach(prepare);

    let initial = true;

    const obs = new IntersectionObserver((entries) => {
      const rootTop = root.getBoundingClientRect().top;

      // Muitos itens entrando no mesmo callback = scroll rápido —
      // encurta delay/duração pra lista acompanhar o ritmo.
      const fastBatch = entries.filter((e) => e.isIntersecting).length > groupSize;

      entries.forEach((entry) => {
        const el = entry.target as HTMLElement;

        if (entry.isIntersecting) {
          if (initial && instantOnLoad) el.classList.add('sr-instant');
          if (fastBatch) {
            el.style.transitionDelay = '0ms';
            el.style.setProperty('--sr-duration', `${Math.min(duration, 120)}ms`);
          }
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

    // Observa [data-reveal] adicionados depois (listas dinâmicas / infinite scroll)
    const watchNode = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const fresh: HTMLElement[] = [];
      if (node.matches('[data-reveal]')) fresh.push(node);
      node.querySelectorAll('[data-reveal]').forEach((el) => fresh.push(el as HTMLElement));
      fresh.forEach((el) => {
        prepare(el);
        obs.observe(el);
      });
    };

    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => m.addedNodes.forEach(watchNode));
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      obs.disconnect();
      mo.disconnect();
    };
  }, [stagger, groupSize, threshold, rootMargin, offset, duration, instantOnLoad, ...deps]);

  return ref;
}
