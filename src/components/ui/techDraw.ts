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

  // Las cotas se redibujan cada vez que se entra a la sección, en cualquier sentido:
  // antes usaban `once: true` y quedaban trazadas para siempre, así que al volver a
  // subir no pasaba nada y el sitio se sentía inconsistente.
  // La primera vez se dibujan con calma; a partir de ahí, más rápido — con vaivén de
  // scroll una cascada de 1.1s por sección (A tu medida tiene 6 trazos) cansa.
  const yaDibujado = new WeakSet<Element>();

  const dibujar = (batch: Element[]) => {
    const primeraVez = batch.some((el) => !yaDibujado.has(el));
    batch.forEach((el) => yaDibujado.add(el));
    gsap.to(batch, {
      drawSVG: '100%',
      duration: primeraVez ? 1.1 : 0.45,
      ease: 'power2.out',
      stagger: primeraVez ? 0.15 : 0.06,
      overwrite: true,
    });
  };

  // Al salir de la sección se rebobinan sin animación: el redibujado debe verse al
  // volver a entrar, no al irse.
  const rebobinar = (batch: Element[]) => {
    gsap.killTweensOf(batch);
    gsap.set(batch, { drawSVG: '0%' });
  };

  ScrollTrigger.batch(paths, {
    start: 'top 85%',
    end: 'bottom 15%',
    onEnter: dibujar,
    onEnterBack: dibujar,
    onLeave: rebobinar,
    onLeaveBack: rebobinar,
  });
}
