/**
 * Indicador de desplazamiento de la ficha técnica.
 *
 * ── POR QUÉ NO BASTA LA BARRA DEL SISTEMA ────────────────────────────────────
 * Las fichas tienen más contenido del que cabe (medido: 502px de sobra en escritorio, 409px
 * en móvil) y no había ninguna señal de ello. La barra del sistema, en el ajuste por defecto
 * de macOS, es superpuesta: solo aparece cuando ya has empezado a desplazar, se desvanece
 * enseguida y encima es oscura sobre un panel oscuro.
 *
 * Se puede pedir una barra clásica con `::-webkit-scrollbar` —y se pide, ver ProductCard—,
 * pero eso depende del navegador y del ajuste del sistema operativo, y no hay forma de
 * comprobarlo desde las pruebas automáticas: el navegador sin interfaz fuerza barras
 * superpuestas y no pinta el estilo. Publicar algo que no se puede verificar no sirve.
 *
 * Por eso este indicador se dibuja por nuestra cuenta: está siempre presente mientras haya
 * algo que leer más abajo, tiene el contraste que decidimos nosotros, y se puede medir.
 *
 * Es DECORATIVO (`aria-hidden`, sin eventos de puntero): no sustituye a la barra real, que
 * sigue estando ahí para arrastrarla. Su único trabajo es avisar de que hay más.
 */

const CLASE_VISIBLE = 'is-visible';

let scroller: HTMLElement | null = null;
let pista: HTMLElement | null = null;
let pulgar: HTMLElement | null = null;
let pedido = 0;

/** Elemento que realmente se desplaza: el cuerpo en escritorio, el panel entero en móvil. */
function buscarScroller(panel: HTMLElement): HTMLElement | null {
  const candidatos = [panel.querySelector<HTMLElement>('.ficha-panel-body'), panel];
  for (const el of candidatos) {
    if (!el) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (/auto|scroll/.test(overflow) && el.scrollHeight - el.clientHeight > 8) return el;
  }
  return null;
}

function pintar(): void {
  pedido = 0;
  if (!scroller || !pista || !pulgar) return;
  const recorrido = scroller.scrollHeight - scroller.clientHeight;
  if (recorrido <= 8) {
    pista.classList.remove(CLASE_VISIBLE);
    return;
  }
  pista.classList.add(CLASE_VISIBLE);
  const alturaPista = pista.clientHeight;
  // Proporción visible, con un mínimo para que el pulgar siga siendo agarrable visualmente.
  const alto = Math.max(28, (scroller.clientHeight / scroller.scrollHeight) * alturaPista);
  const avance = scroller.scrollTop / recorrido;
  pulgar.style.height = `${Math.round(alto)}px`;
  pulgar.style.transform = `translateY(${Math.round(avance * (alturaPista - alto))}px)`;
}

function alDesplazar(): void {
  // Un solo repintado por fotograma: el evento de scroll se dispara muchas más veces.
  if (pedido) return;
  pedido = requestAnimationFrame(pintar);
}

/** Engancha el indicador a la ficha que se acaba de abrir. */
export function activarIndicador(card: HTMLElement): void {
  desactivarIndicador();
  const panel = card.querySelector<HTMLElement>('[data-ficha-panel]');
  if (!panel) return;
  pista = card.querySelector<HTMLElement>('[data-ficha-hint]');
  pulgar = pista?.firstElementChild as HTMLElement | null;
  if (!pista || !pulgar) return;

  scroller = buscarScroller(panel);
  if (!scroller) {
    pista.classList.remove(CLASE_VISIBLE);
    return;
  }
  scroller.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('resize', alDesplazar, { passive: true });
  pintar();
}

/** Lo suelta al cerrar: sin listeners colgando ni referencias a nodos que se mueven. */
export function desactivarIndicador(): void {
  if (pedido) {
    cancelAnimationFrame(pedido);
    pedido = 0;
  }
  scroller?.removeEventListener('scroll', alDesplazar);
  window.removeEventListener('resize', alDesplazar);
  pista?.classList.remove(CLASE_VISIBLE);
  scroller = null;
  pista = null;
  pulgar = null;
}
