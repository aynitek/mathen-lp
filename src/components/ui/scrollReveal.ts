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

/**
 * Revisores de "bloque atascado invisible", uno por grupo.
 * Se ejecutan con un temporizador propio y NO solo desde el `onUpdate` de
 * ScrollTrigger: ese callback solo se dispara mientras el scroll se mueve, así que si
 * el usuario se detiene justo después de dejar un bloque en mal estado, nunca se
 * volvía a comprobar y el texto se quedaba invisible mientras él miraba la sección.
 */
const revisores: Array<() => void> = [];
let revisorTimer = 0;

/**
 * Última dirección de scroll: +1 bajando, -1 subiendo.
 * La despedida al subir solo tiene sentido mientras el usuario SIGUE subiendo. Si se
 * detiene o cambia a bajar, un bloque a media pantalla debe volver a leerse: no puede
 * quedarse invisible delante de él.
 */
let ultimaDireccion = 1;
let ultimoY = 0;
/** Marca de tiempo del último movimiento de scroll: sirve para saber si el usuario
 *  sigue en movimiento o ya se detuvo a leer. */
let ultimoMovimiento = 0;

function arrancarRevisor(): void {
  if (revisorTimer) return;
  ultimoY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      if (Math.abs(y - ultimoY) > 2) {
        ultimaDireccion = y > ultimoY ? 1 : -1;
        ultimoY = y;
        ultimoMovimiento = performance.now();
      }
    },
    { passive: true },
  );
  revisorTimer = window.setInterval(() => {
    for (const rev of revisores) rev();
  }, 250);
}
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
      tl.set(item, { opacity: 1, y: 0 }, start);
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
      // Sin `filter` en la ENTRADA. El navegador rasteriza el texto de otra forma
      // mientras tiene un filtro aplicado (pierde el suavizado subpíxel) y lo vuelve a
      // dibujar nítido en cuanto el filtro desaparece: ese re-dibujado del último
      // fotograma se percibe como un parpadeo justo antes de que el bloque se estabilice.
      // Es el defecto que el cliente reportó en "Siete líneas, un solo proveedor", y no
      // lo detecta ninguna sonda de opacidad porque no es un cambio de opacidad.
      // La entrada se consigue igual de bien con opacidad + desplazamiento.
      // Recorrido algo mayor y salida más marcada que antes: los textos informativos SÍ
      // se animaban (18 pasos intermedios de opacidad, medido), pero el gesto era
      // demasiado corto para leerse como animación, sobre todo desde que se quitó el
      // desenfoque. Se mantiene la jerarquía: titulares por líneas, cuerpo con fundido
      // ascendente — line-revelar párrafos largos los vuelve pesados y lentos.
      gsap.set(item, { opacity: 0, y: 44 });
      tl.to(item, { opacity: 1, y: 0, duration: 0.62, ease: 'power3.out' }, start);
    }
  });

  return tl;
}

/** Salida: siempre más simple y más rápida que la entrada (60%), blur + opacidad. */
function buildTimelineOut(items: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  // Sin `filter` tampoco aquí: el texto no debe pasar nunca por un filtro, ni entrando
  // ni saliendo. Al escrubear la salida hacia atrás el bloque volvería de desenfocado a
  // nítido estando visible, y ese re-dibujado es justo el parpadeo que se quiere eliminar.
  tl.to(items, {
    opacity: 0,
    y: -16,
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
      gsap.set(items, { opacity: 1, y: 0 });
      return;
    }

    const tlIn = buildTimelineIn(items);
    const tlOut = buildTimelineOut(items);

    // Antes se ponía y se QUITABA `will-change` alrededor de cada animación. Quitarlo
    // obliga al navegador a destruir la capa de composición del elemento y a repintarlo:
    // con un `filter` aplicado encima, ese repintado se ve como un destello justo cuando
    // la animación termina — el parpadeo que reportó el cliente en "Siete líneas, un solo
    // proveedor". No lo detectaba ninguna sonda de opacidad porque no es un cambio de
    // opacidad, sino de capa.
    // Se declara una sola vez, de forma estable, y no se toca más: el elemento se queda
    // en su propia capa y no hay promoción/destrucción repetida.
    items.forEach((it) => {
      it.style.willChange = 'transform, opacity';
    });
    const setWillChange = (_on: boolean) => {};

    // Estado de la salida-al-subir (ver disparador dedicado más abajo): mientras está
    // "armada", el onUpdate de ese disparador escribe directamente el progreso de
    // `tlIn` cuadro a cuadro. Se desarma en cuanto la entrada vuelve a tomar el control
    // (playIn) para que un `restart()` nunca compita con el scrub.
    const outUp = { armed: false };
    let ultimaRevision = 0;
    // ¿El grupo ya está en su estado "entrado y visible"? Sirve para no relanzar la
    // entrada cuando no hace falta.
    let yaEntrado = false;
    // Última vez que el escrubeo de la salida-al-subir escribió algo. Si el estado
    // "armado" se queda colgado (el usuario cambia de dirección a media transición y el
    // disparador nunca llega a desarmarse), la red de seguridad quedaría bloqueada y el
    // bloque se quedaría invisible. Se considera caduco pasados 400ms sin actividad.
    let ultimoScrub = 0;

    const playIn = () => {
      outUp.armed = false;
      // Si el grupo YA está entrado y completo, no se reinicia. Reiniciarlo pone la
      // opacidad a 0 y vuelve a animar: al revisitar una sección (bajar, subir y volver
      // a bajar) los bloques ya visibles se apagaban un instante y entraban otra vez.
      // Medido: 9 elementos con ese destello en la segunda bajada.
      // Se evita relanzar la entrada en dos casos:
      //  - ya terminó (progreso 1): reiniciar apagaría un bloque que ya se lee.
      //  - está EN CURSO: reiniciarla a media animación hace que el texto ya visible se
      //    apague y vuelva a entrar. Es lo que el cliente describió como "sale precargado,
      //    desaparece y aparece con la animación".
      if (yaEntrado && (tlIn.isActive() || tlIn.progress() === 1) && !tlOut.isActive()) return;
      yaEntrado = true;
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

    const revisar = () => {
      const t = performance.now();
      if (outUp.armed && t - ultimoScrub > 400) outUp.armed = false; // armado caduco
      if (outUp.armed || tlIn.isActive() || tlOut.isActive()) return;
      if (t - ultimaRevision < 200) return;
      ultimaRevision = t;
      const r = group.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      // Se decide por POSICIÓN y POR ELEMENTO, no por una bandera de estado ni por la
      // posición del grupo:
      //  - Una bandera se desincroniza con el scroll errático y deja el bloque apagado
      //    para siempre (reportado en "Se fabrica a la medida de tu obra").
      //  - Mirar el grupo tampoco basta: en grupos altos un párrafo puede estar en zona
      //    de lectura mientras el grupo entero todavía no lo está, y ese párrafo se
      //    quedaba invisible (reportado en "Acero Aluzinc": "Es la base de todas...").
      //
      // Regla: un elemento debe verse si está en la ZONA DE LECTURA (por encima del 40%
      // de la pantalla) o si el usuario ya NO está subiendo. La despedida al subir solo
      // se respeta mientras el gesto de subir continúa; en cuanto el usuario se detiene o
      // baja, un bloque a media pantalla tiene que volver a leerse.
      //
      // Medido: parándose tras scroll errático, había bloques invisibles en `top` 487 y
      // 748 de un viewport de 850 — muy por debajo del 40%, pero delante de los ojos del
      // usuario. Mirar solo la posición los dejaba apagados; mirar solo la dirección
      // rompía la despedida. Hacen falta las dos cosas.
      // La despedida se respeta MIENTRAS el usuario sigue subiendo. En cuanto se detiene
      // a mirar, no puede quedar texto invisible delante de él: si lleva medio segundo
      // quieto, se restituye lo que esté en pantalla.
      // Es la única forma de honrar los dos requisitos del cliente a la vez:
      //   "cuando subo, la despedida debe quedarse" (mientras se mueve)
      //   "nunca debería dejar de aparecer cuando estoy en ese lugar" (cuando se detiene)
      const zonaLectura = window.innerHeight * 0.4;
      const subiendo = ultimaDireccion < 0;
      const quieto = t - ultimoMovimiento > 500;
      const oculto = items.some((it) => {
        const rect = it.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
        // despidiéndose y todavía en movimiento: no se toca
        if (subiendo && !quieto && rect.top > zonaLectura) return false;
        return Number(gsap.getProperty(it, 'opacity')) < 0.9;
      });
      if (!oculto) return;
      yaEntrado = false;
      playIn();
    };

    revisores.push(revisar);
    arrancarRevisor();

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
      // Red de seguridad. Sobre la opacidad de un mismo elemento escriben tres cosas:
      // la entrada, la salida, y el escrubeo de la salida-al-subir. Con scroll errático
      // (ráfagas cortas cambiando de dirección) el orden de los eventos puede dejar un
      // bloque en opacidad 0 sin que quede ningún disparador pendiente que lo recupere:
      // reproducido, un bloque de `la-materia` se quedaba invisible en pantalla de forma
      // permanente. Mientras el grupo está dentro del rango de lectura y no se está
      // ejecutando ninguna animación, si algo quedó invisible se relanza la entrada.
      onUpdate: revisar,
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
          // Se marca actividad AL ARMAR. Si no, `ultimoScrub` vale 0 y la caducidad de
          // 400ms se cumple en el primer frame: la salida se desarmaba antes de empezar
          // y no llegaba a verse nunca.
          ultimoScrub = performance.now();
          yaEntrado = false; // la salida va a ocultarlo: la próxima entrada sí debe animar
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
          ultimoScrub = performance.now();
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
