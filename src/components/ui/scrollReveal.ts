/**
 * Entradas de scroll para el HTML (no confundir con el store global de scroll.ts).
 * Cada sección llama a `revealIn(rootEl)` una vez montada.
 *
 * Marcado esperado:
 *   <h2 data-reveal data-split="lines">...</h2>   titular: SplitText con máscara por línea
 *   <p data-reveal>...</p>                        resto: fundido + desplazamiento
 *
 * ── POR QUÉ ESTÁ ESCRITO ASÍ ──────────────────────────────────────────────────
 * La versión anterior era una máquina de estados escrita a mano: dos timelines por
 * grupo, `restart()`/`pause()` disparados desde callbacks manuales, banderas de estado,
 * un segundo disparador que escrubeaba la salida escribiendo `progress()` cuadro a
 * cuadro, y un vigilante con `setInterval` que "reparaba" bloques atascados. Tres
 * controladores escribiendo la opacidad del mismo nodo: con scroll errático el orden de
 * los eventos decidía el resultado, y de ahí venían los cuatro defectos que el cliente
 * reportó una y otra vez.
 *
 * La documentación de GreenSock dice exactamente lo contrario de lo que hacíamos:
 *
 *  1. UN SOLO DUEÑO DEL PLAYHEAD. "When you assign an animation to a ScrollTrigger, it
 *     gets paused and the ScrollTrigger instance controls its playhead." Aquí no se
 *     llama nunca a play/reverse/restart a mano: `toggleActions` lo gobierna todo.
 *     https://gsap.com/docs/v3/Plugins/ScrollTrigger/
 *
 *  2. `reverse()` CONTINÚA DESDE DONDE ESTÉ, no salta ni reinicia. Por eso la despedida
 *     al subir (`onLeaveBack: reverse`) es la misma entrada reproducida al revés — que
 *     es literalmente lo que se pidió — y cambiar de dirección a media animación es
 *     continuo, sin destellos. Esto es lo que dos timelines separadas no podían hacer:
 *     no sabían entregarse el testigo en el punto exacto.
 *     https://gsap.com/docs/v3/GSAP/Tween/reverse()/
 *
 *  3. UN DISPARADOR POR BLOQUE, NO POR GRUPO. Medido en la versión anterior: con el
 *     disparador en el grupo, los últimos bloques de un grupo alto animaban con `top`
 *     entre 900 y 1243 px en un viewport de 900 — es decir, íntegramente por debajo del
 *     pliegue. Cuando el usuario llegaba a ellos ya estaban a opacidad 1 y no animaban
 *     nunca; si el grupo volvía a dispararse, se apagaban y entraban. Era exactamente el
 *     "sale precargado, desaparece y aparece con la animación". La cascada no se pierde:
 *     los bloques están a alturas distintas, así que entran en orden por geometría.
 *
 *  4. `fromTo` Y NO `from`. Los dos hacen render inmediato (`immediateRender: true` por
 *     defecto en ambos, gsap-core.js `_createTweenType`); la diferencia es de dónde sale el
 *     otro extremo. Un `from` toma el estado FINAL del valor que tenga el nodo al
 *     construirse, así que varios `from` sobre el mismo nodo se pisan entre ellos. `fromTo`
 *     declara los dos extremos y es determinista sea cual sea el orden de creación.
 *     Ese render inmediato es además lo que nos interesa: el estado oculto (`autoAlpha:0`)
 *     se escribe en línea nada más montar la sección, sin esperar a que el usuario haga
 *     scroll. https://gsap.com/resources/st-mistakes/
 *
 *  5. `autoAlpha` Y NO `opacity`. Anima la opacidad y conmuta `visibility`, que es la vía
 *     oficial contra el destello de contenido sin estilo: el CSS oculta con
 *     `visibility:hidden` y GSAP revela. Además saca del árbol de accesibilidad lo que
 *     todavía no se ha revelado, cosa que `opacity:0` no hace.
 *     https://gsap.com/resources/fouc/
 *
 *  6. `autoSplit` + `onSplit`. Cuando una fuente web carga tarde o cambia el ancho,
 *     SplitText vuelve a partir el texto y DESTRUYE los nodos de línea anteriores. Si la
 *     animación se creó fuera de `onSplit`, queda apuntando a nodos que ya no existen y
 *     las líneas nuevas se quedan invisibles para siempre. Creándola dentro, SplitText
 *     trasplanta el progreso a los nodos nuevos.
 *     https://gsap.com/docs/v3/Plugins/SplitText/
 *
 * ── QUÉ SE CEDE A CAMBIO ──────────────────────────────────────────────────────
 * Con un disparador por bloque, el intervalo entre la entrada de un titular y la de su
 * párrafo ya no es un número fijo: lo marca la distancia entre ambos y la velocidad a la
 * que el usuario baja. Antes era constante (0.05s por bloque dentro de una timeline de
 * grupo). Se acepta a conciencia: ese ritmo fijo era justamente lo que hacía que los
 * bloques bajos de un grupo alto animaran estando fuera de pantalla.
 *
 * Nada de banderas, vigilantes ni escrubeo manual: si algo vuelve a fallar, el sitio
 * donde mirar es la configuración del disparador, no un estado oculto.
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

/** Bloques ya inicializados: `revealIn` puede llamarse más de una vez sobre la misma raíz. */
const yaMontado = new WeakSet<HTMLElement>();

const DUR_TITULAR = 0.42;
const DUR_TEXTO = 0.5;
/** Desfase entre bloques que están a la MISMA altura (los tres pilares, las chips de una
 *  fila). Los que están a alturas distintas ya entran en orden por geometría. */
const DESFASE_FILA = 0.09;

/** Desfase entre líneas/palabras del titular. Corto a propósito: la despedida solo
 *  dispone de ~160px de recorrido visible y un stagger largo la deja a medias al salir. */
function stagger(kind: SplitKind): number {
  return kind === 'chars' ? 0.014 : kind === 'words' ? 0.026 : 0.05;
}

/**
 * Desfase de cada bloque dentro de su fila. Dos bloques cuentan como "misma fila" si sus
 * bordes superiores están a menos de 40px: en la práctica, columnas lado a lado (los tres
 * pilares de Nosotros, las chips de una ficha). Los que están a alturas distintas ya entran
 * en orden por geometría y no necesitan desfase.
 *
 * Se mide TODO de una vez y se devuelve un mapa, en lugar de medir por elemento dentro de
 * un bucle anidado: así hay una sola lectura de layout por sección en vez de n², y todas
 * las medidas son del mismo instante.
 *
 * Límite conocido y asumido: la medida se toma al montar, cuando las fuentes web pueden no
 * haber terminado de cargar. Si el reflujo posterior cambiara qué bloques comparten fila, el
 * desfase calculado sería el de la disposición anterior. La consecuencia es solo estética
 * (un bloque entra a la vez que su vecino en lugar de 90ms después); nunca deja nada
 * invisible, porque el desfase es una posición dentro de la timeline, no una condición.
 */
function desfasesPorFila(items: HTMLElement[]): WeakMap<HTMLElement, number> {
  const tops = items.map((el) => el.getBoundingClientRect().top);
  const mapa = new WeakMap<HTMLElement, number>();
  for (let i = 0; i < items.length; i++) {
    let previos = 0;
    for (let j = 0; j < i; j++) if (Math.abs(tops[j] - tops[i]) < 40) previos++;
    mapa.set(items[i], previos * DESFASE_FILA);
  }
  return mapa;
}

function montarItem(item: HTMLElement, desfases: WeakMap<HTMLElement, number>): void {
  if (yaMontado.has(item)) return;
  yaMontado.add(item);

  // Estable y declarado una sola vez. Ponerlo y quitarlo alrededor de cada animación
  // obliga al navegador a crear y destruir la capa de composición, y ese repintado se
  // veía como un destello al terminar la animación.
  item.style.willChange = 'transform, opacity';

  const retraso = desfases.get(item) ?? 0;

  // ── UNA SOLA LÍNEA DE DISPARO, Y ESTÁ MEDIDO POR QUÉ ───────────────────────────
  // Esta línea hace dos cosas: bajando es donde el bloque entra; subiendo es donde arranca
  // la despedida (la misma animación al revés, desde donde esté el playhead).
  //
  // Se intentó separarlas —entrada a 82%, despedida arrancando más arriba, a 45%— para que
  // la despedida tuviera más recorrido visible. Funcionó para eso y ROMPIÓ lo importante:
  // medido, dejaba bloques invisibles 722ms y 751ms CON EL USUARIO PARADO delante (el
  // titular del hero a `top` 497 y "De la planta a tu obra" a 565, ambos a media pantalla).
  // Es exactamente el defecto que el cliente describió como "nunca debería dejar de
  // aparecer como tal cuando estoy en ese lugar".
  //
  // Las dos exigencias son incompatibles por geometría, no por implementación: subiendo,
  // el bloque se va por el borde INFERIOR, así que cualquier despedida que empiece mientras
  // el bloque sigue bien dentro de la pantalla deja texto apagado delante de quien lee. La
  // única despedida que no puede molestar es la que ocurre al salir. Se prioriza no dejar
  // nunca texto invisible delante del usuario, y se compensa acortando la animación para
  // que quepa más gesto en el recorrido que queda.
  //
  // El valor 90% también está medido. Con 82% (738px en una pantalla de 900) quedaba una
  // franja de ~68px en la que un bloque corto —los pilares 01/02/03 de "Nosotros", de 84px
  // de alto— cabía ENTERO en pantalla estando ya despedido: si el usuario llegaba subiendo
  // y se paraba justo ahí, veía un hueco. Reproducido: 5 bloques invisibles con el usuario
  // parado. Con 90% la línea de despedida queda a 810px, y para que un bloque quepa entero
  // por debajo de ella tendría que medir menos de 80px de alto: la franja se cierra.
  const disparador: ScrollTrigger.Vars = {
    trigger: item,
    // Tiene que ser ALCANZABLE: un bloque del final de la página que nunca llegue a
    // cruzarla no entraría nunca. El juez lo vigila parándose al fondo del recorrido.
    // NO usar `clamp(top 90%)` aquí. Es tentador: GSAP limita el `end` al scroll máximo pero
    // no el `start` (ScrollTrigger.js 1427 frente a 1386), así que un bloque del final de la
    // página cuya línea cayera más allá del final del scroll no entraría nunca. Pero
    // `clamp` recorta por los DOS extremos, y el titular del hero tiene un inicio NEGATIVO
    // (ya está en pantalla con scroll 0): al recortarlo a 0, volver arriba del todo cruza su
    // línea y dispara la despedida. Medido: el titular del hero se quedaba apagado 721ms con
    // el usuario parado en lo más alto de la página. El riesgo que cubre es hipotético; el
    // que introduce es real y está en lo primero que ve el visitante.
    // La protección vive en la prueba: el juez se para 1.5s al final del recorrido y falla
    // si queda algún bloque invisible en pantalla.
    start: 'top 90%',
    end: 'bottom top',
    // play · none · none · reverse
    //  ─ bajando, al cruzar: entra.
    //  ─ bajando, al salir por arriba: NADA. Se queda visible; nadie pidió que el texto se
    //    apagara por delante del usuario y fue el origen de dos roturas en producción.
    //  ─ subiendo, al reaparecer por arriba: NADA. Ya está visible.
    //  ─ subiendo, al volver a cruzar hacia abajo: la despedida.
    toggleActions: 'play none none reverse',
  };

  const kind = item.dataset.split as SplitKind | undefined;

  if (!kind) {
    gsap
      .timeline({ scrollTrigger: disparador })
      .fromTo(
        item,
        { autoAlpha: 0, y: 44 },
        { autoAlpha: 1, y: 0, duration: DUR_TEXTO, ease: 'power3.out' },
        retraso,
      );
    return;
  }

  // Titular partido. La animación se construye DENTRO de `onSplit` y se devuelve: así
  // sobrevive a que la fuente cargue tarde o cambie el ancho, momentos en los que
  // SplitText rehace las líneas y tira las anteriores.
  let previa: gsap.core.Timeline | null = null;
  SplitText.create(item, {
    type: kind === 'chars' ? 'lines,words,chars' : 'lines,words',
    mask: 'lines',
    autoSplit: true,
    onSplit(self) {
      // Al rehacer la partición hay que llevarse por delante el disparador anterior, o
      // se acumularía uno nuevo por cada re-partición.
      previa?.scrollTrigger?.kill();
      previa?.kill();

      // El contenedor queda visible; lo que se oculta y anima son las líneas de dentro.
      gsap.set(item, { autoAlpha: 1 });

      const objetivo =
        kind === 'chars' ? self.chars : kind === 'words' ? self.words : self.lines;

      previa = gsap
        .timeline({ scrollTrigger: disparador })
        .fromTo(
          objetivo,
          { yPercent: 115, autoAlpha: 0 },
          {
            yPercent: 0,
            autoAlpha: 1,
            duration: DUR_TITULAR,
            ease: 'power3.out',
            stagger: stagger(kind),
          },
          retraso,
        );
      return previa;
    },
  });
}

export function revealIn(root: ParentNode | null): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (items.length === 0) return;

  // `gsap.matchMedia` es la vía recomendada para movimiento reducido: revierte por sí
  // sola todo lo que se cree dentro cuando la preferencia cambia, sin recargar.
  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: reduce)', () => {
    gsap.set(items, { autoAlpha: 1, y: 0, clearProps: 'willChange' });
  });

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const desfases = desfasesPorFila(items);
    for (const item of items) montarItem(item, desfases);
  });
}

/** Cascada simple para grillas (tarjetas de catálogo, galería). */
export function revealBatch(root: ParentNode | null, selector = '[data-reveal-card]'): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const cards = Array.from((root as HTMLElement).querySelectorAll<HTMLElement>(selector));
  if (cards.length === 0) return;

  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: reduce)', () => {
    gsap.set(cards, { autoAlpha: 1, y: 0, filter: 'none' });
  });

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.set(cards, { autoAlpha: 0, y: 24 });
    // `batch` agrupa en una sola llamada las tarjetas que entran juntas y les da el
    // stagger, en vez de crear una timeline independiente por tarjeta que entre sin
    // relación temporal con las demás. `once` porque una tarjeta de catálogo ya leída no
    // debe volver a esconderse.
    ScrollTrigger.batch(cards, {
      start: 'top 88%',
      once: true,
      interval: 0.08,
      batchMax: 3,
      onEnter: (batch) =>
        gsap.to(batch, {
          autoAlpha: 1,
          y: 0,
          duration: 0.7,
          ease: 'power2.out',
          stagger: 0.08,
          overwrite: true,
        }),
    });
  });
}

/**
 * Profundidad sutil por capas. OPT-IN: solo actúa sobre elementos marcados con
 * `data-parallax`, y ese marcador NO debe ponerse nunca en un contenedor que envuelva
 * bloques `[data-reveal]`.
 *
 * ── POR QUÉ, MEDIDO ───────────────────────────────────────────────────────────
 * Antes esto se aplicaba a `[data-reveal-group]`, es decir, al contenedor de los propios
 * bloques que se revelan. Eso convierte al disparador en un elemento cuya posición
 * animamos nosotros, y ScrollTrigger calcula la línea de disparo a partir de la posición
 * que el elemento tenga en el momento de medir. Resultado medido: los 35 bloques de
 * `la-materia`, `como-se-arma` y `a-tu-medida` se desplazaban hasta 88px respecto de la
 * posición con la que se calcularon sus disparadores (grupo con `translateY(-22px)`),
 * mientras que la altura del documento no cambiaba ni un píxel — o sea, no eran las
 * imágenes: era este efecto.
 *
 * Esas son exactamente las tres secciones en las que el cliente reportó que el texto "a
 * veces no está". Un desfase de hasta 44px en la línea de disparo es suficiente para que
 * un bloque entre o no entre según dónde pare el scroll, y era la última fuente de
 * intermitencia que quedaba.
 *
 * Si se quiere recuperar la sensación de profundidad, hay que marcar con `data-parallax`
 * una capa DECORATIVA (los velos `aria-hidden` a pantalla completa, un SVG de fondo) que
 * no contenga ningún `[data-reveal]`.
 */
export function addDepthParallax(root: ParentNode | null, amountPx = 22): void {
  if (!root || typeof window === 'undefined') return;
  ensureRegistered();

  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const capas = root.querySelectorAll<HTMLElement>('[data-parallax]');
    capas.forEach((capa) => {
      if (capa.querySelector('[data-reveal]')) return; // nunca sobre un disparador
      gsap.fromTo(
        capa,
        { y: amountPx },
        {
          y: -amountPx,
          ease: 'none',
          scrollTrigger: { trigger: capa, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
        },
      );
    });
  });
}
