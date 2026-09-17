/**
 * Fuente única de verdad del scroll.
 * Lenis maneja el scroll suave; GSAP ScrollTrigger se sincroniza con él.
 * El canvas 3D NUNCA lee el DOM: solo consume este store.
 * Ver _brief/03-mapa-escenas.md para los rangos canónicos.
 */
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useSyncExternalStore } from 'react';

export const SCENES = [
  { id: 'hero',           start: 0.00, end: 0.12 },
  { id: 'la-materia',     start: 0.12, end: 0.26 },
  { id: 'como-se-arma',   start: 0.26, end: 0.42 },
  { id: 'catalogo',       start: 0.42, end: 0.62 },
  { id: 'a-tu-medida',    start: 0.62, end: 0.74 },
  { id: 'nosotros',       start: 0.74, end: 0.84 },
  { id: 'planta-y-obras', start: 0.84, end: 0.93 },
  { id: 'cotiza-ahora',   start: 0.93, end: 1.00 },
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

export type ScrollState = {
  /** 0 → 1 a lo largo de toda la página */
  progress: number;
  /** índice 0–7 de la escena activa */
  scene: number;
  /** 0 → 1 dentro de la escena activa */
  local: number;
};

const state: ScrollState = { progress: 0, scene: 0, local: 0 };

/**
 * Límites reales de cada escena, medidos del DOM.
 * Los valores de SCENES son solo el fallback de diseño: si el contenido crece
 * (copy más largo, <details> abiertos) o el usuario hace zoom al 200%, las
 * fracciones fijas dejan de coincidir con lo que el usuario está viendo y el
 * 3D se desincroniza del texto. Medir el `offsetTop` real elimina ese riesgo.
 */
let bounds: number[] = SCENES.map((s) => s.start);

function measureScenes() {
  if (typeof document === 'undefined') return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return;

  const measured: number[] = [];
  for (const scene of SCENES) {
    const el = document.getElementById(scene.id);
    if (!el) return; // falta una sección: se conserva el fallback de diseño
    measured.push(Math.min(1, Math.max(0, el.offsetTop / scrollable)));
  }
  measured[0] = 0;
  // Monotonía estricta: una sección vacía o solapada no debe invertir el orden.
  for (let i = 1; i < measured.length; i++) {
    if (measured[i] <= measured[i - 1]) measured[i] = Math.min(1, measured[i - 1] + 0.001);
  }
  bounds = measured;
}

/** Mutable, leído cada frame por el canvas (sin re-render de React). */
export const scrollState = state;

let lenis: Lenis | null = null;
let started = false;
const listeners = new Set<() => void>();
let snapshot: ScrollState = { ...state };
/** Debe ser una referencia ESTABLE: si se devuelve un objeto nuevo en cada llamada,
 *  React entra en bucle infinito ("The result of getServerSnapshot should be cached"). */
const SERVER_SNAPSHOT: ScrollState = { progress: 0, scene: 0, local: 0 };

function emit() {
  snapshot = { ...state };
  listeners.forEach((l) => l());
}

function setProgress(p: number) {
  const clamped = Math.min(1, Math.max(0, p));
  state.progress = clamped;
  let i = bounds.length - 1;
  for (let k = 0; k < bounds.length; k++) {
    if (clamped < (k + 1 < bounds.length ? bounds[k + 1] : 1.0000001)) {
      i = k;
      break;
    }
  }
  const start = bounds[i];
  const end = i + 1 < bounds.length ? bounds[i + 1] : 1;
  state.scene = i;
  state.local = end > start ? (clamped - start) / (end - start) : 0;
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function isLowPower() {
  if (typeof window === 'undefined') return false;
  /*
   * Se mira el LADO CORTO, no el ancho. Con `max-width: 768px` el mismo teléfono giraba a
   * horizontal, pasaba a 844px de ancho y dejaba de considerarse móvil: recibía la calidad
   * completa de escritorio (postprocesado, entorno procedural, geometría de detalle) sobre
   * una GPU de móvil. Medido en horizontal: ~49% de fotogramas con tirones, peor que en
   * vertical. El lado corto no cambia al girar, que es justo lo que hace falta aquí.
   */
  const ladoCorto = Math.min(window.innerWidth, window.innerHeight);
  return ladoCorto <= 768 || navigator.hardwareConcurrency <= 4;
}

/** Arranca Lenis + ScrollTrigger. Idempotente. */
export function initScroll() {
  if (started || typeof window === 'undefined') return;
  started = true;

  gsap.registerPlugin(ScrollTrigger);

  const reduced = prefersReducedMotion();

  if (!reduced) {
    lenis = new Lenis({
      lerp: 0.11,
      duration: 1.1,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.3,
      smoothWheel: true,
      syncTouch: false,
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis!.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // Progreso global 0→1 atado al documento completo.
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      setProgress(self.progress);
      emit();
    },
  });

  measureScenes();
  ScrollTrigger.addEventListener('refresh', measureScenes);

  // ScrollTrigger toma sus medidas al crear los disparadores, y eso ocurre ANTES de que
  // terminen de cargar las fuentes de Google y las imágenes de producto. Cuando llegan,
  // cambian las alturas de las secciones y los disparadores quedan desfasados: con caché
  // fría el reparto del catálogo no llegaba a ejecutarse (reportado en Chrome; en un
  // navegador con las fuentes ya cacheadas no se reproducía).
  // Volver a medir cuando fuentes e imágenes han aterrizado, y ante cambios de layout.
  const revalidar = () => ScrollTrigger.refresh();

  if (document.readyState === 'complete') revalidar();
  else window.addEventListener('load', revalidar, { once: true });

  if (document.fonts?.ready) document.fonts.ready.then(revalidar).catch(() => {});

  // OJO: NO re-medir por cada imagen `loading="lazy"`. Esas aterrizan mientras el
  // usuario ya está scrolleando, y cada `refresh()` recalcula posiciones en pleno
  // movimiento: medido, introducía saltos de hasta 725px en el carrusel. Las imágenes
  // llevan `width`/`height` explícitos, así que no desplazan el layout al cargar.

  setProgress(0);
  emit();
}

export function scrollTo(target: string) {
  if (lenis) lenis.scrollTo(target, { offset: 0 });
  else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
}

/** Hook de React para el HTML (nav, indicador de progreso). El 3D usa `scrollState` directo. */
export function useScrollProgress(): ScrollState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}
