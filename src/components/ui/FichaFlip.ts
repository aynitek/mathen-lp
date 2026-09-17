/**
 * Ficha técnica del catálogo — animada con GSAP Flip (D3 de la especificación).
 * Es la única forma de cumplir "la tarjeta regresa físicamente a su posición
 * original": se captura el estado con `Flip.getState()`, se muta el DOM (la
 * MISMA tarjeta cambia de padre, nunca se oculta ni se clona) y se interpola
 * con `Flip.from()`. `scale:true` obliga a Flip a resolver el cambio de tamaño
 * con `transform: scale(...)` en vez de animar `width`/`height` cuadro a cuadro
 * (regla dura de rendimiento: solo transform/opacity).
 *
 * Reglas de accesibilidad repuestas a mano (ver spec, sección Accesibilidad):
 *  - Disparador = <button> real, aria-expanded/aria-controls.
 *  - Al abrir: foco entra al panel (al botón de cerrar). Escape cierra.
 *  - Al cerrar: foco vuelve al botón que abrió la ficha.
 *  - Los hermanos no seleccionados se marcan `inert` (no interactivos, pero
 *    siguen en el HTML servido: nunca `display:none`).
 */
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { activarIndicador, desactivarIndicador } from './fichaScrollHint';

let registered = false;
function ensureRegistered() {
  if (!registered) {
    gsap.registerPlugin(Flip);
    registered = true;
  }
}

function isReduced() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface FichaFlipHandle {
  isOpen(): boolean;
  closeIfOpen(): void;
}

export function initFichaFlip(
  root: ParentNode,
  stage: HTMLElement,
  onOpenChange: (open: boolean) => void,
): FichaFlipHandle {
  ensureRegistered();

  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-carousel-card]'));
  let openCard: HTMLElement | null = null;
  let openSlot: HTMLElement | null = null;
  /**
   * Padre REAL del que salió la tarjeta, para devolverla exactamente ahí.
   *
   * La estructura es `[data-carousel-slide] > [data-carousel-slide-inner] > <article>`, y
   * esa separación es deliberada: el bucle escribe `x` en la ranura EXTERIOR y el reparto
   * escribe transform/opacity en el envoltorio INTERIOR, para que nunca escriban la misma
   * propiedad del mismo nodo. Al cerrar se devolvía la tarjeta a la ranura exterior, no al
   * envoltorio: quedaba como HERMANA del envoltorio (que mide 456px y seguía ahí, vacío),
   * así que se apilaba justo debajo. Medido: la tarjeta pasaba de `top` 388 a 840 — los
   * 452px del salto. Y peor, `CarouselLoop` guarda las referencias a los envoltorios al
   * arrancar, así que a partir de ese momento el reparto animaba una caja vacía y esa
   * tarjeta quedaba desconectada para siempre; no se recuperaba ni cambiando de filtro.
   */
  let openParent: HTMLElement | null = null;

  /**
   * Transición en vuelo (la timeline que devuelve `Flip.from`).
   *
   * `close()` pone `openCard = null` en el acto, pero la animación dura 0.55s. En esa
   * ventana, `open()` de otra tarjeta pasaba el guardia `if (openCard) return` y arrancaba,
   * mientras el `onComplete` del cierre anterior llegaba DESPUÉS y ejecutaba
   * `onOpenChange(false)` — reanudando el carrusel con una ficha recién abierta y dejando
   * dos tarjetas marcadas como abiertas a la vez. Reproducido 2 de 29 intentos cerrando una
   * ficha y abriendo otra con ~150ms de diferencia: hace falta insistir mucho, pero ocurre y
   * no se recupera solo.
   *
   * En vez de ignorar el clic (que se sentiría como un clic perdido), se ASIENTA la
   * transición pendiente: se la lleva a su estado final, lo que dispara su `onComplete` y
   * deja el estado coherente, y entonces empieza la nueva. La interfaz sigue respondiendo al
   * instante y nunca hay dos transiciones vivas.
   */
  let transicion: gsap.core.Timeline | null = null;

  function asentarTransicionPendiente() {
    const t = transicion;
    transicion = null;
    if (t && t.isActive()) t.progress(1);
  }
  let openTrigger: HTMLElement | null = null;

  function siblingsOf(card: HTMLElement): HTMLElement[] {
    return cards.filter((c) => c !== card);
  }

  function setSiblingsHidden(card: HTMLElement, hidden: boolean) {
    siblingsOf(card).forEach((sib) => {
      const slot = sib.closest<HTMLElement>('[data-carousel-slide]') ?? sib;
      slot.classList.toggle('is-ficha-sibling-hidden', hidden);
      if (hidden) {
        sib.setAttribute('inert', '');
      } else {
        sib.removeAttribute('inert');
      }
    });
  }

  /**
   * Elementos del fondo a los que ESTE componente les puso `inert`, para quitárselo solo a
   * ellos al cerrar y no pisar los que ya lo tenían por su cuenta.
   */
  let fondoAislado: HTMLElement[] = [];

  /**
   * Aísla todo lo que no es la ficha mientras está abierta.
   *
   * La ficha es un diálogo modal (`role="dialog"`, `aria-modal="true"`), y el patrón ARIA
   * exige que el tabulador no salga de él. Faltaba: tabulando hacia adelante desde el panel
   * el foco se escapaba del catálogo y seguía por el resto de la página, con el diálogo
   * todavía abierto encima.
   *
   * Se resuelve con `inert`, que es la vía NATIVA: el navegador saca del orden de
   * tabulación, de los clics y del árbol de accesibilidad todo lo marcado. No se escribe un
   * atrapador de foco a mano —interceptar Tab, calcular el primer y último elemento
   * enfocable, reenviar el foco— porque eso es otra máquina de estados que mantener, y ya
   * sabemos cómo acaban.
   *
   * Recorre desde el escenario de la ficha hasta `body` marcando a los HERMANOS de cada
   * nivel: así queda accesible exactamente la rama que lleva a la ficha, y nada más.
   */
  function aislarFondo(activar: boolean) {
    if (!activar) {
      for (const el of fondoAislado) el.removeAttribute('inert');
      fondoAislado = [];
      return;
    }
    let nodo: HTMLElement | null = stage;
    while (nodo && nodo !== document.body) {
      const padre = nodo.parentElement;
      if (!padre) break;
      for (const hermano of Array.from(padre.children)) {
        if (hermano === nodo || !(hermano instanceof HTMLElement)) continue;
        if (hermano.hasAttribute('inert')) continue; // ya lo tenía: no es nuestro, no se toca
        hermano.setAttribute('inert', '');
        fondoAislado.push(hermano);
      }
      nodo = padre;
    }
  }

  function open(card: HTMLElement, trigger: HTMLElement) {
    asentarTransicionPendiente();
    if (openCard) return;
    const slot = card.closest<HTMLElement>('[data-carousel-slide]');
    if (!slot) return;

    const panel = card.querySelector<HTMLElement>('[data-ficha-panel]');
    const reduced = isReduced();

    const state = Flip.getState(card, { props: 'borderRadius' });

    openCard = card;
    openSlot = slot;
    openParent = card.parentElement;
    openTrigger = trigger;

    // Mueve el nodo REAL (no un clon) al escenario de ficha. El slot original
    // queda vacío pero con su ancho fijo, así que el track no reacomoda nada.
    stage.appendChild(card);
    stage.classList.add('is-open');
    stage.removeAttribute('inert');
    aislarFondo(true);
    card.dataset.fichaState = 'open';
    trigger.setAttribute('aria-expanded', 'true');
    setSiblingsHidden(card, true);

    // El cruce compacto↔ficha lo resuelve el CSS (opacity/visibility en
    // `article[data-ficha-state]`, ver ProductCard.astro): Flip solo anima la
    // caja del <article>.
    transicion = Flip.from(state, {
      duration: reduced ? 0 : 0.65,
      ease: 'power3.inOut',
      scale: true,
      absolute: true,
      onComplete: () => {
        // `preventScroll` NO es cosmetico. El visor del carrusel mide 28.5rem con
        // `overflow:hidden`, y `overflow:hidden` SIGUE siendo desplazable por programa:
        // al enfocar, el navegador desplaza el contenedor para revelar lo enfocado.
        // Medido: el visor saltaba a `scrollTop` 452 y el carril entero subia 452px con la
        // pagina quieta, dejando las demas tarjetas cortadas por arriba. Ademas no se
        // revertia solo — quedaba asi hasta recargar.
        panel?.focus({ preventScroll: true });
        // Se engancha al terminar de abrir: antes, el panel todavia se esta redimensionando
        // con el Flip y las medidas del desplazamiento no serian las definitivas.
        activarIndicador(card);
      },
    });

    onOpenChange(true);
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    asentarTransicionPendiente();
    if (!openCard || !openSlot) return;
    const card = openCard;
    const slot = openSlot;
    const trigger = openTrigger;
    const reduced = isReduced();

    const state = Flip.getState(card, { props: 'borderRadius' });

    // Devuelve el nodo real a SU PADRE original (el envoltorio interior), no a la ranura:
    // misma posición física, exacta, y sigue formando parte del sistema de reparto.
    (openParent ?? slot).appendChild(card);
    openParent = null;
    desactivarIndicador();
    aislarFondo(false);
    card.dataset.fichaState = 'closed';
    stage.classList.remove('is-open');
    stage.setAttribute('inert', '');
    trigger?.setAttribute('aria-expanded', 'false');
    setSiblingsHidden(card, false);

    transicion = Flip.from(state, {
      duration: reduced ? 0 : 0.55,
      ease: 'power3.inOut',
      scale: true,
      absolute: true,
      onComplete: () => {
        trigger?.focus({ preventScroll: true }); // ver nota en `open`
        // El carrusel retoma SOLO cuando la tarjeta terminó de asentarse en su
        // slot: si se reanuda antes (con el Flip todavía animando), el slot
        // -que ya está siendo movido por el autoplay- es un blanco móvil y la
        // tarjeta no vuelve exactamente a su posición física original.
        onOpenChange(false);
      },
    });

    openCard = null;
    openSlot = null;
    openTrigger = null;
    document.removeEventListener('keydown', onKeydown);
  }

  /** Lo que se puede enfocar DENTRO del panel, en orden de tabulación. */
  const ENFOCABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function enfocablesDelPanel(): HTMLElement[] {
    const panel = openCard?.querySelector<HTMLElement>('[data-ficha-panel]');
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(ENFOCABLE)).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab' || !openCard) return;

    // Cierre del ciclo de tabulación. `inert` sobre el fondo ya impide llegar al resto de
    // la página, pero no cierra el ciclo: al pasar del último elemento, el foco sale al
    // navegador (`activeElement` pasa a ser `body`) y vuelve a entrar en la siguiente
    // pulsación. El patrón de diálogo modal de la WAI pide que Tab en el último lleve al
    // primero y Shift+Tab en el primero lleve al último, así que se rebota en los extremos.
    // Son dos comprobaciones de borde, no un sistema de estado: fuera de los extremos, el
    // navegador sigue gobernando el orden de tabulación.
    const panel = openCard.querySelector<HTMLElement>('[data-ficha-panel]');
    if (!panel) return;
    const lista = enfocablesDelPanel();
    if (lista.length === 0) {
      e.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement;
    const enElPanel = activo instanceof HTMLElement && panel.contains(activo);

    if (e.shiftKey && (activo === primero || activo === panel || !enElPanel)) {
      e.preventDefault();
      ultimo.focus({ preventScroll: true });
    } else if (!e.shiftKey && (activo === ultimo || !enElPanel)) {
      e.preventDefault();
      primero.focus({ preventScroll: true });
    }
  }

  cards.forEach((card) => {
    const trigger = card.querySelector<HTMLElement>('[data-ficha-trigger]');
    const closeBtn = card.querySelector<HTMLElement>('[data-ficha-close]');
    trigger?.addEventListener('click', () => open(card, trigger));
    closeBtn?.addEventListener('click', () => close());
  });

  return {
    isOpen: () => openCard !== null,
    closeIfOpen: () => {
      if (openCard) close();
    },
  };
}
