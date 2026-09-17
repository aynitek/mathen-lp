/**
 * Avance automático del catálogo en móvil.
 *
 * En móvil el carrusel NO es el bucle infinito de escritorio: es una fila con scroll táctil
 * nativo y `scroll-snap`, elegida a propósito para que se pueda deslizar con el dedo y
 * funcione aunque el JS no cargue. La contrapartida es que se queda quieta, y el cliente lo
 * notó: las tarjetas no se mueven solas y no invitan a deslizar.
 *
 * Esto le da movimiento SIN quitarle lo que la hace buena: no se toca el scroll nativo, solo
 * se empuja `scrollLeft` de vez en cuando. El dedo manda siempre — en cuanto el usuario toca,
 * se para; y si se queda mirando una tarjeta, no se la movemos de debajo.
 *
 * Va y vuelve en lugar de saltar al principio: un salto de vuelta a la primera tarjeta se ve
 * como un tirón, y aquí no hay tarjetas duplicadas con las que disimularlo (eso es cosa del
 * bucle de escritorio).
 */

interface Opciones {
  /** Milisegundos entre avances. */
  cada?: number;
  /** Silencio tras tocar antes de retomar. */
  esperaTrasTocar?: number;
}

export interface CarruselTactil {
  destruir(): void;
}

export function autoAvanzarEnTactil(track: HTMLElement, opciones: Opciones = {}): CarruselTactil {
  const cada = opciones.cada ?? 3200;
  const esperaTrasTocar = opciones.esperaTrasTocar ?? 4500;

  // Movimiento reducido: no se mueve nada solo. El usuario sigue pudiendo deslizar.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { destruir() {} };
  }

  let direccion: 1 | -1 = 1;
  let tocadoEn = 0;
  let visible = false;
  let timer = 0;

  /** Ancho de una tarjeta más su separación: lo que avanza cada paso. */
  function paso(): number {
    const slide = track.querySelector<HTMLElement>('[data-carousel-slide]');
    if (!slide) return 300;
    const sep = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    return slide.getBoundingClientRect().width + sep;
  }

  function avanzar(): void {
    const ahora = performance.now();
    if (!visible) return;
    if (ahora - tocadoEn < esperaTrasTocar) return;
    // Una ficha abierta ocupa la pantalla entera: mover el carrusel por detrás no tiene
    // sentido y ademas deja la tarjeta en otro sitio al cerrar.
    if (document.querySelector('.ficha-stage.is-open')) return;

    const maximo = track.scrollWidth - track.clientWidth;
    if (maximo <= 4) return;
    if (direccion === 1 && track.scrollLeft >= maximo - 4) direccion = -1;
    else if (direccion === -1 && track.scrollLeft <= 4) direccion = 1;

    const destino = Math.max(0, Math.min(maximo, track.scrollLeft + direccion * paso()));
    track.scrollTo({ left: destino, behavior: 'smooth' });
  }

  const alTocar = () => {
    tocadoEn = performance.now();
  };

  /*
   * La rueda solo cuenta como "el usuario esta usando el carrusel" si es HORIZONTAL. Bajar
   * por la pagina con el puntero encima del catalogo dispara `wheel` sobre la fila, y
   * tomarlo por interaccion lo dejaba en pausa sin que nadie lo hubiera tocado. Con el dedo
   * no pasa: ahi `touchstart` si significa que lo estan tocando.
   */
  const alRodar = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) tocadoEn = performance.now();
  };

  // Solo se mueve mientras el catálogo está a la vista: fuera de pantalla es gasto de
  // bateria por nada.
  const observador = new IntersectionObserver(
    (entradas) => {
      visible = entradas.some((e) => e.isIntersecting);
    },
    { threshold: 0.2 },
  );
  observador.observe(track);

  track.addEventListener('pointerdown', alTocar, { passive: true });
  track.addEventListener('touchstart', alTocar, { passive: true });
  track.addEventListener('wheel', alRodar, { passive: true });
  timer = window.setInterval(avanzar, cada);

  return {
    destruir() {
      window.clearInterval(timer);
      observador.disconnect();
      track.removeEventListener('pointerdown', alTocar);
      track.removeEventListener('touchstart', alTocar);
      track.removeEventListener('wheel', alRodar);
    },
  };
}
