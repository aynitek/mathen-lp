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
  // Separación entre bloques de la cascada. Medido: con 0.12 la cascada completa de un
  // grupo de 6 elementos duraba ~1.3s. Bajando rápido (~6800px/s) el último elemento
  // todavía no había empezado cuando ya se disparaba la salida: el titular entraba y el
  // cuerpo de la sección no llegaba a aparecer nunca. Se comprime la cascada para que
  // quepa dentro del recorrido visible sin perder la sensación de lectura escalonada.
  const GAP = 0.05;

  items.forEach((item, i) => {
    const kind = item.dataset.split as SplitKind | undefined;
    const start = i * GAP;

    if (kind) {
      const targets = getSplitTargets(item, kind);
      gsap.set(targets, { opacity: 0, yPercent: 115 });
      gsap.set(item, { opacity: 1 }); // el contenedor queda visible; lo oculto son las líneas
      // El contenedor se restituye DENTRO de la timeline, no solo al montar. La salida
      // (`buildTimelineOut`) anima la opacidad del propio contenedor a 0: si la entrada
      // solo reanima las líneas internas, al volver a entrar quedan animándose dentro de
      // un contenedor invisible y el titular no reaparece nunca. Era la causa de que el
      // texto "desapareciera y no volviera".
      tl.set(item, { opacity: 1, y: 0, filter: 'none' }, start);
      tl.to(
        targets,
        {
          opacity: 1,
          yPercent: 0,
          duration: 0.55,
          ease: 'power3.out',
          stagger: kind === 'chars' ? 0.018 : kind === 'words' ? 0.035 : 0.07,
        },
        start,
      );
    } else {
      gsap.set(item, { opacity: 0, y: 32, filter: 'blur(4px)' });
      tl.to(
        item,
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: 'power2.out' },
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

    // Estado de la salida-al-subir (ver disparador dedicado más abajo): mientras está
    // "armada", el onUpdate de ese disparador escribe directamente el progreso de
    // `tlIn` cuadro a cuadro. Se desarma en cuanto la entrada vuelve a tomar el control
    // (playIn) para que un `restart()` nunca compita con el scrub.
    const outUp = { armed: false };

    const playIn = () => {
      outUp.armed = false;
      tlOut.pause(0);
      setWillChange(true);
      tlIn.restart();
    };
    const playOut = () => {
      tlIn.pause(0);
      setWillChange(true);
      tlOut.restart();
    };

    tlIn.eventCallback('onComplete', () => setWillChange(false));

    // Si el grupo vive dentro de un contenedor que se hace `pin` (el catálogo),
    // ScrollTrigger necesita saberlo: si no, calcula mal la posición del disparador
    // y la entrada nunca llega a ejecutarse — el bloque se queda en opacity:0.
    const pinned = group.closest<HTMLElement>('[data-pin-wrap]');

    ScrollTrigger.create({
      trigger: group,
      start: 'top 92%',
      // `end` marca cuándo se dispara la salida hacia abajo. Con 'bottom 15%' se
      // disparaba cuando el borde inferior del GRUPO llegaba al 15% de la pantalla: en
      // grupos altos (Nosotros tiene titular + misión + visión + 3 pilares) los últimos
      // elementos seguían perfectamente visibles y se apagaban recién aparecidos — eso es
      // el parpadeo que se reportó. Con 'bottom top' la salida hacia abajo ocurre cuando
      // el grupo ya cruzó el borde superior, es decir fuera de la vista: nadie la ve
      // apagarse. La salida que SÍ se ve es la de subir, que tiene su propio disparador
      // escrubeado más abajo.
      end: 'bottom top',
      ...(pinned ? { pinnedContainer: pinned } : {}),
      onEnter: playIn,
      onEnterBack: playIn,
      // La salida existe para cuando el bloque se va de pantalla. Un bloque pineado
      // NO se va: se queda fijo mientras dura el pin. Dispararle la salida ahí lo
      // dejaba invisible con el carrusel corriendo debajo y un hueco donde va el titular.
      // La salida hacia abajo (se sigue bajando, el bloque sale por arriba) no se toca:
      // es donde se rompió todo las dos veces anteriores.
      ...(pinned ? {} : { onLeave: playOut }),
    });

    // Salida al SUBIR: la entrada reproducida al revés, atada al progreso del scroll
    // (no a una duración fija) — así es visible sea cual sea la velocidad de la rueda.
    //
    // Rango físico, no arbitrario: 'top 80%' es el MISMO borde que usa el disparador
    // de entrada (arriba) — el punto en el que, subiendo, el bloque empieza a irse por
    // el borde inferior. 'top 100%' es el borde inferior del propio viewport, el punto
    // en que ya está completamente fuera. Ese tramo (~150-180px a 900px de viewport) es
    // exactamente el recorrido visible que describe el brief; no hay un segundo número
    // inventado cerca de 'bottom 15%' (ahí fue el fracaso nº1: un disparador de salida
    // se solapaba con el `onEnterBack` de la entrada y la sección se apagaba estando
    // centrada en pantalla).
    //
    // `onEnterBack`/`onLeaveBack` de ESTE disparador (dirección "subiendo" únicamente)
    // arman/desarman el scrub; `onUpdate` solo escribe `tlIn.progress()` mientras está
    // armado, así que nunca toca la entrada normal (`onEnter` bajando, más arriba, sigue
    // siendo un `restart()` idéntico a como estaba).
    // La salida-al-subir SOLO se activa cuando el titular del grupo usa `data-split`.
    // Motivo medido, no preventivo: con `data-split`, la entrada anima las LÍNEAS internas
    // y la salida anima el CONTENEDOR — nodos distintos, sin conflicto. Sin `data-split`
    // (caso de `planta-y-obras` y `catalogo`) ambas animan la MISMA propiedad del MISMO
    // nodo, y la carrera entre la entrada por tiempo y la salida escrubeada deja el bloque
    // invisible estando centrado en pantalla: caída de opacidad de 1.00 a 0 en un solo
    // frame, reproducida a dos velocidades de rueda distintas.
    // En esas dos secciones la salida sigue siendo la de siempre (`onLeave`), que nadie
    // ha reportado como defectuosa.
    const tieneSplit = items.some((it) => Boolean(it.dataset.split));

    if (!pinned && tieneSplit) {
      ScrollTrigger.create({
        trigger: group,
        // La banda cubre desde que el bloque está a media pantalla ('top 40%') hasta
        // justo antes de irse por abajo ('top 90%'): ~425px a 850px de viewport.
        // Dos calibraciones que costaron medir:
        //  - Con una banda corta (~170px) el recorrido se cruzaba en ~85ms: la salida se
        //    ejecutaba pero era imperceptible.
        //  - El extremo NO puede ser 'top 100%'. Al invertir la cascada, el titular es el
        //    PRIMER elemento de la timeline, así que solo cambia cuando el progreso se
        //    acerca a 0, es decir al final del tramo. Si ese final coincide con el borde
        //    inferior, el titular se desvanece ya fuera de pantalla — justo el defecto que
        //    el cliente reportó. Terminando en 'top 90%' el progreso llega a 0 con el
        //    bloque todavía visible.
        start: 'top 90%',
        end: 'top 40%',
        onEnterBack: () => {
          outUp.armed = true;
          // `tlIn` puede seguir REPRODUCIÉNDOSE (la entrada la lanza con `restart()`).
          // No basta con pausarla: hay que LLEVARLA A SU ESTADO FINAL. Si la entrada se
          // queda congelada a medio camino (bloque a opacidad 0.1, por ejemplo) y la
          // salida arranca desde ahí, el bloque se apaga de golpe estando centrado en
          // pantalla. Medido en `planta-y-obras`, que usa un titular SIN `data-split`:
          // ahí `tlIn` y `tlOut` animan la MISMA propiedad del MISMO nodo y la carrera
          // entre ambas es visible. Forzando la entrada a completarse, la salida siempre
          // parte del bloque plenamente visible.
          tlIn.progress(1).pause();
          tlOut.pause(0);
          setWillChange(true);
        },
        onLeaveBack: () => {
          outUp.armed = false;
          tlOut.progress(1); // ya fuera de pantalla: queda en el mismo estado oculto que tras salir
          setWillChange(false);
        },
        onUpdate: (self) => {
          if (!outUp.armed) return;
          // `self.progress` va de 1 (bloque a media pantalla) a 0 (bloque saliendo por
          // abajo) conforme se sube. La salida avanza al revés: de 0 a 1.
          //
          // Se escrubea `tlOut` y NO `tlIn` invertida, aunque el cliente sugirió reutilizar
          // la entrada al revés. Motivo medido: la entrada es una CASCADA (label → titular
          // → párrafo → chips). Al invertirla, el titular —que es el primer elemento— solo
          // se mueve en el último 10% del recorrido, es decir justo cuando el bloque ya se
          // fue por abajo: exactamente el defecto que se quería corregir. `tlOut` anima
          // todos los bloques a la vez, así que el desvanecido se reparte por todo el tramo
          // y se ve de principio a fin.
          // Se limita cuánto puede avanzar el progreso en un solo frame. Con la rueda
          // rápida el objetivo puede saltar de 0 a 1 de golpe, y escribirlo en seco haría
          // desaparecer el texto de un fotograma al siguiente — justo lo que se quiere
          // evitar. Un tope por frame convierte ese salto en un desvanecido corto.
          //
          // Se hace con aritmética y NO creando un tween por frame: esa primera versión
          // costaba 6 fps de mediana y metía hasta 5 frames lentos por recorrido (medido).
          const objetivo = 1 - self.progress;
          const actual = tlOut.progress();
          const paso = 0.14;
          const delta = objetivo - actual;
          tlOut.progress(
            Math.abs(delta) <= paso ? objetivo : actual + Math.sign(delta) * paso,
          );
        },
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
