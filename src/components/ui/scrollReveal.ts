/**
 * Entradas de scroll para el HTML (no confundir con el store global de scroll.ts).
 * Cada sección llama a `revealIn(rootEl)` una vez montada, y este helper crea
 * ScrollTriggers LOCALES por elemento (nunca un ScrollTrigger de progreso global:
 * eso ya lo hace src/lib/scroll.ts).
 *
 * Marcado esperado dentro de `root`:
 *   <div data-reveal-group>
 *     <h2 data-reveal data-split="lines">...</h2>   <!-- titular: SplitText con máscara -->
 *     <p data-reveal>...</p>                         <!-- resto: fade+blur en bloque -->
 *   </div>
 *
 * `data-split="lines|words|chars"` en un `[data-reveal]` activa SplitText: la entrada
 * pasa de "fundido plano" a máscara + traslado por línea/palabra/carácter con stagger
 * interno, sin dejar de participar en la cascada de lectura del resto de bloques.
 *
 * Respeta prefers-reduced-motion: sin animación, contenido visible de entrada.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

let registered = false;
function ensureRegistered() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger, SplitText);
    registered = true;
  }
}

type SplitKind = 'lines' | 'words' | 'chars';

const splitCache = new WeakMap<HTMLElement, SplitText>();

function getSplitTargets(item: HTMLElement, kind: SplitKind): Element[] {
  let split = splitCache.get(item);
  if (!split) {
    split = SplitText.create(item, { type: 'lines,words,chars', mask: 'lines' });
    splitCache.set(item, split);
  }
  if (kind === 'chars') return split.chars;
  if (kind === 'words') return split.words;
  return split.lines;
}

/** Construye la entrada (timeline pausada) respetando la cascada de lectura. */
function buildTimelineIn(items: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  const GAP = 0.12; // separación entre bloques top-level (label → título → párrafo → chips)

  items.forEach((item, i) => {
    const kind = item.dataset.split as SplitKind | undefined;
    const start = i * GAP;

    if (kind) {
      const targets = getSplitTargets(item, kind);
      gsap.set(targets, { opacity: 0, yPercent: 115 });
      gsap.set(item, { opacity: 1 }); // el contenedor queda visible; lo oculto son las líneas
      tl.to(
        targets,
        {
          opacity: 1,
          yPercent: 0,
          duration: 0.75,
          ease: 'power3.out',
          stagger: kind === 'chars' ? 0.018 : kind === 'words' ? 0.035 : 0.07,
        },
        start,
      );
    } else {
      gsap.set(item, { opacity: 0, y: 32, filter: 'blur(4px)' });
      tl.to(
        item,
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, ease: 'power2.out' },
        start,
      );
    }
  });

  return tl;
}

/** Salida: siempre más simple y más rápida que la entrada (60%), blur + opacidad. */
function buildTimelineOut(items: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  tl.to(items, {
    opacity: 0,
    y: -16,
    filter: 'blur(4px)',
    duration: 0.42,
    ease: 'power2.in',
    stagger: 0.05,
  });
  return tl;
}

export function revealIn(root: ParentNode | null): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groups = root.querySelectorAll<HTMLElement>('[data-reveal-group]');

  groups.forEach((group) => {
    const items = Array.from(group.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (items.length === 0) return;

    if (reduced) {
      gsap.set(items, { opacity: 1, y: 0, filter: 'none' });
      return;
    }

    const tlIn = buildTimelineIn(items);
    const tlOut = buildTimelineOut(items);

    const setWillChange = (on: boolean) => {
      items.forEach((it) => {
        it.style.willChange = on ? 'transform, opacity, filter' : '';
      });
    };

    // OJO: `pause()` sin argumento, no `pause(0)`. `pause(0)` no solo pausa: hace un
    // seek al tiempo 0 de esa timeline, lo que para los `[data-reveal]` SIN
    // `data-split` (la timeline anima `opacity` del propio elemento, no de líneas
    // internas) fuerza su opacidad de vuelta al valor de arranque de la entrada
    // (0) en el mismo frame, ANTES de que la salida empiece a interpolar — el
    // elemento se apaga de golpe y la salida ya no tiene nada que animar (medido:
    // el párrafo de "cotiza-ahora" pasaba de opacidad 1 a 0 en un solo frame).
    // Para el titular con `data-split` no se notaba porque su opacidad de
    // contenedor ya vale 1 siempre (lo que anima la entrada son las líneas
    // internas), pero el párrafo y cualquier bloque sin `data-split` sí comparten
    // la propiedad `opacity` con la timeline contraria. Pausar sin mover el
    // playhead conserva el valor visual actual y deja que la otra timeline
    // interpole desde ahí.
    const playIn = () => {
      tlOut.pause();
      setWillChange(true);
      tlIn.restart();
    };
    const playOut = () => {
      tlIn.pause();
      setWillChange(true);
      tlOut.restart();
    };

    tlIn.eventCallback('onComplete', () => setWillChange(false));

    // Si el grupo vive dentro de un contenedor que se hace `pin` (el catálogo),
    // ScrollTrigger necesita saberlo: si no, calcula mal la posición del disparador
    // y la entrada nunca llega a ejecutarse — el bloque se queda en opacity:0.
    const pinned = group.closest<HTMLElement>('[data-pin-wrap]');

    // Disparador de ENTRADA: intacto, tal como estaba. `start`/`end` calibrados para
    // el momento en que aparece leyendo hacia abajo; no se toca.
    ScrollTrigger.create({
      trigger: group,
      start: 'top 80%',
      end: 'bottom 15%',
      ...(pinned ? { pinnedContainer: pinned } : {}),
      onEnter: playIn,
      onEnterBack: playIn,
    });

    // Disparadores de SALIDA: dedicados y separados del de entrada (no comparten
    // `start`/`end` con él) para poder darle a la animación de salida un margen de
    // pantalla amplio antes de que el bloque cruce el borde del viewport.
    //
    // Medido con rueda real (900px de viewport, ~2750px/s): con el disparador de
    // entrada reusado para la salida (`start: 'top 80%'` ≈ 720px), al subir solo
    // quedaban ~180px de recorrido antes de salir de cuadro por abajo — la salida,
    // de 0.42s a esa velocidad, terminaba de tocar por completo fuera de pantalla.
    // Adelantar el disparador a 'top 20%'/'bottom 80%' deja ~700px de recorrido
    // visible en cada sentido, suficiente para que la mayor parte del desvanecido
    // ocurra con el elemento todavía dentro del viewport.
    //
    // Un bloque pineado (el catálogo) NO se va de pantalla: se queda fijo mientras
    // dura el pin. Dispararle la salida ahí lo dejaba invisible con el carrusel
    // corriendo debajo y un hueco donde va el titular — se mantiene la exclusión.
    if (!pinned) {
      // Sale por ARRIBA: se sigue bajando más allá de la sección (ya se leyó).
      ScrollTrigger.create({
        trigger: group,
        start: 'top 80%',
        end: 'bottom 80%',
        onLeave: playOut,
      });
      // Sale por ABAJO: se sube de vuelta hacia la sección anterior.
      ScrollTrigger.create({
        trigger: group,
        start: 'top 20%',
        end: 'bottom top',
        onLeaveBack: playOut,
      });
    }
  });
}

/** Cascada simple para grillas (tarjetas de catálogo, galería). */
export function revealBatch(root: ParentNode | null, selector = '[data-reveal-card]'): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = Array.from((root as HTMLElement).querySelectorAll<HTMLElement>(selector));
  if (cards.length === 0) return;

  if (reduced) {
    gsap.set(cards, { opacity: 1, y: 0, filter: 'none' });
    return;
  }

  gsap.set(cards, { opacity: 0, y: 24, filter: 'blur(4px)' });

  ScrollTrigger.batch(cards, {
    start: 'top 85%',
    once: true,
    interval: 0.08,
    batchMax: 3,
    onEnter: (batch) =>
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.08,
      }),
  });
}

/**
 * Profundidad sutil por capas: el bloque de texto se desplaza unos px en `transform`
 * (nunca top/left) mientras el usuario lo atraviesa. `scrub` corto y solo sobre
 * transform: no fuerza layout, es puramente compositor (GPU).
 * Uso selectivo: solo en secciones con tramos vacíos que necesitan sensación de
 * profundidad (no se aplica en cascada global).
 */
export function addDepthParallax(root: ParentNode | null, amountPx = 22): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  const groups = root.querySelectorAll<HTMLElement>('[data-reveal-group]');
  groups.forEach((group) => {
    gsap.fromTo(
      group,
      { y: amountPx },
      {
        y: -amountPx,
        ease: 'none',
        scrollTrigger: {
          trigger: group,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6,
        },
      },
    );
  });
}
