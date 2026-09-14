/**
 * Líneas de cota / anotaciones técnicas que se dibujan solas (DrawSVGPlugin).
 * Es el lenguaje visual del rubro (planos de obra): cotas, marcos de esquina,
 * pines señalando una pieza del 3D detrás. Siempre ScrollTrigger LOCAL, `once`,
 * nunca scrub — el trazo se dibuja una vez al entrar en vista, no se ata a la
 * velocidad de scroll (eso lo reserva el 3D, ver mapa-escenas).
 *
 * Marcado esperado: cualquier <path>/<line>/<rect> con `data-draw` dentro de `root`.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';

let registered = false;
function ensureRegistered() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);
    registered = true;
  }
}

export function drawLinesIn(root: ParentNode | null, selector = '[data-draw]'): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paths = Array.from((root as HTMLElement).querySelectorAll<SVGElement>(selector));
  if (paths.length === 0) return;

  if (reduced) {
    gsap.set(paths, { drawSVG: '100%' });
    return;
  }

  gsap.set(paths, { drawSVG: '0%' });

  ScrollTrigger.batch(paths, {
    start: 'top 85%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        drawSVG: '100%',
        duration: 1.1,
        ease: 'power2.out',
        stagger: 0.15,
      }),
  });
}
