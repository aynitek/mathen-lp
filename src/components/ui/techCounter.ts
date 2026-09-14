/**
 * Contadores numéricos atados al scroll para cifras técnicas (espesores, núcleos).
 * Dos modos:
 *  - `bindScrubNumber`: el número "se lee" del scroll (Escena 3 del mapa: núcleo
 *    30→200mm sincronizado con el uniform del 3D). `scrub` corto sobre un valor
 *    JS puro (no transform/layout): solo reescribe `textContent` de un elemento
 *    aislado con ancho mínimo fijo (evita reflow de vecinos).
 *  - `countUpOnce`: cuenta una sola vez al entrar en vista (sin scrub), para
 *    cifras que no necesitan ir "pegadas" al dedo del usuario.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let registered = false;
function ensureRegistered() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
}

function isReduced() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function bindScrubNumber(
  el: HTMLElement,
  trigger: Element,
  from: number,
  to: number,
  suffix = '',
  decimals = 0,
): void {
  if (typeof window === 'undefined') return;
  ensureRegistered();

  if (isReduced()) {
    el.textContent = `${to.toFixed(decimals)}${suffix}`;
    return;
  }

  const obj = { v: from };
  el.textContent = `${from.toFixed(decimals)}${suffix}`;

  gsap.to(obj, {
    v: to,
    ease: 'none',
    scrollTrigger: {
      trigger,
      start: 'top 75%',
      end: 'bottom 25%',
      scrub: 0.35,
    },
    onUpdate: () => {
      el.textContent = `${obj.v.toFixed(decimals)}${suffix}`;
    },
  });
}

export function countUpOnce(
  el: HTMLElement,
  trigger: Element,
  from: number,
  to: number,
  suffix = '',
  duration = 1.1,
): void {
  if (typeof window === 'undefined') return;
  ensureRegistered();

  if (isReduced()) {
    el.textContent = `${to}${suffix}`;
    return;
  }

  const obj = { v: from };
  el.textContent = `${from}${suffix}`;

  ScrollTrigger.create({
    trigger,
    start: 'top 85%',
    once: true,
    onEnter: () =>
      gsap.to(obj, {
        v: to,
        duration,
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = `${Math.round(obj.v)}${suffix}`;
        },
      }),
  });
}
