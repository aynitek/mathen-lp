/**
 * Helpers de interpolación continua por escena.
 * Nada de esto es un hook de React con estado: son funciones puras (o que
 * mutan un `THREE.Vector3` recibido) pensadas para llamarse dentro de
 * `useFrame`, cada frame, leyendo `scrollState` por mutación directa.
 *
 * Filosofía: el scroll (GSAP/Lenis, vía `scrollState`) ya da la posición
 * "objetivo" continua a lo largo de `progress`; aquí solo suavizamos con
 * `THREE.MathUtils.damp` para que un salto de scroll rápido no se sienta
 * como un corte, y calculamos pesos de cross-fade entre las distintas
 * representaciones geométricas del mismo objeto.
 */
import * as THREE from 'three';
import { SCENES } from '../../lib/scroll';

/** Suaviza un escalar hacia un objetivo usando damp exponencial dependiente de delta. */
export function dampScalar(current: number, target: number, lambda: number, delta: number): number {
  return THREE.MathUtils.damp(current, target, lambda, delta);
}

/** Suaviza un Vector3 in-place hacia un objetivo, eje por eje. */
export function dampVector3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number): void {
  current.x = THREE.MathUtils.damp(current.x, target.x, lambda, delta);
  current.y = THREE.MathUtils.damp(current.y, target.y, lambda, delta);
  current.z = THREE.MathUtils.damp(current.z, target.z, lambda, delta);
}

/** Interpola linealmente entre dos Vector3 (constantes) sin mutar los originales. */
export function lerpVector3(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  out.x = THREE.MathUtils.lerp(a.x, b.x, t);
  out.y = THREE.MathUtils.lerp(a.y, b.y, t);
  out.z = THREE.MathUtils.lerp(a.z, b.z, t);
  return out;
}

/** Clamp + smoothstep (0→1) para transiciones sin picos de aceleración. */
export function smooth01(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Peso de presencia (0→1) de una escena dada, a partir del progreso global.
 * Vale 1 mientras `progress` está dentro del rango `[start, end)` de la
 * escena `sceneIndex` (ver `src/lib/scroll.ts`), y cae suavemente (smoothstep)
 * en una pluma `feather` a cada lado — así el cross-fade entre las distintas
 * geometrías que representan al mismo objeto (plancha, panel, policarbonato…)
 * nunca es un corte duro.
 */
export function scenePresence(progress: number, sceneIndex: number, feather = 0.03): number {
  const scene = SCENES[sceneIndex];
  if (!scene) return 0;
  const { start, end } = scene;
  if (progress <= start - feather || progress >= end + feather) return 0;
  const fadeIn = smooth01((progress - (start - feather)) / feather);
  const fadeOut = smooth01((end + feather - progress) / feather);
  return Math.min(fadeIn, fadeOut);
}

/**
 * Peso de un "sub-beat" dentro del progreso local [0,1] de una escena
 * (usado por la escena `catalogo`, que agrupa varios beats del storyboard
 * original: pliegue de techo, policarbonato, placa colaborante, grilla).
 */
export function subBeatWeight(local: number, segStart: number, segEnd: number, feather = 0.08): number {
  if (local <= segStart - feather || local >= segEnd + feather) return 0;
  const fadeIn = smooth01((local - (segStart - feather)) / feather);
  const fadeOut = smooth01((segEnd + feather - local) / feather);
  return Math.min(fadeIn, fadeOut);
}

/** Interpola un array de keyframes escalares repartidos uniformemente en [0,1]. */
export function lerpKeyframes(t: number, values: number[]): number {
  if (values.length === 1) return values[0];
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const segments = values.length - 1;
  const scaled = clamped * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const localT = scaled - i;
  return THREE.MathUtils.lerp(values[i], values[i + 1], localT);
}
