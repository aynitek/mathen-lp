/**
 * Cámara atada al scroll — v2 "recorrido espacial" (`_brief/04-recorrido-espacial.md`).
 * En vez de un objeto que muta frente a una cámara casi fija, ahora es la
 * cámara la que recorre una nave industrial fija: una única
 * `CatmullRomCurve3` (posición) + otra (target) construidas con un punto por
 * cada fila de la tabla de trayectoria del brief (más un par de anclas
 * intermedias en escenas largas, para controlar el "atravesar materia" de
 * `como-se-arma` y el sobrevuelo de `la-materia`).
 *
 * Las anclas NO están espaciadas uniformemente en el parámetro de la curva:
 * cada una lleva su propio `t` (progreso global 0→1, ver `src/lib/scroll.ts`).
 * `sampleCurves()` traduce `progress` al parámetro uniforme `u` que esperan
 * las curvas remapeando linealmente dentro del tramo [anchors[i].t, anchors[i+1].t]
 * — así se respetan los rangos de scroll canónicos de `03-mapa-escenas.md`
 * mientras la trayectoria en sí es una curva suave (sin los quiebres rectos
 * de un lerp punto a punto).
 *
 * `prefersReducedMotion()` → cámara fija en una composición interior bella
 * (dentro de la nave, mirando la estructura de techo), sin animar nada en
 * `useFrame`: el recorrido no se cancela, pero no hay movimiento de cámara
 * por frame (regla dura del brief v2).
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { scrollState, prefersReducedMotion } from '../../lib/scroll';
import { dampScalar, dampVector3 } from './useSceneValue';

interface CameraAnchor {
  /** progreso global 0→1 en el que la cámara alcanza este estado */
  t: number;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

// Una ancla por fila de la tabla de `_brief/04-recorrido-espacial.md`, más
// anclas intermedias donde la escena es larga o necesita control fino
// (el sobrevuelo de `la-materia`, el atravesar-materia de `como-se-arma`).
// Eje Z: +Z = afuera / portón (lado del atardecer), -Z = fondo de la nave.
const ANCHORS: CameraAnchor[] = [
  // hero (0.00–0.12) — EXTERIOR: silueta 3/4 baja, bien afuera del portón
  // (gateZ=6, halfLength=6), con la línea del techo a dos aguas dominando el
  // encuadre. Cámara baja (por debajo del alero) mirando ligeramente hacia
  // arriba, en deriva lenta de aproximación hacia el portón.
  { t: 0.0, pos: [7.6, 1.4, 10.2], target: [0, 1.9, 3.0], fov: 36 },
  { t: 0.12, pos: [5.4, 1.7, 7.6], target: [0.2, 2.1, 3.6], fov: 31 },

  // la-materia (0.12–0.26) — vuelo ascendente hacia la cubierta; la escala
  // pasa de detalle a paisaje al acercarse a las crestas del TR4.
  { t: 0.19, pos: [1.8, 2.4, 4.2], target: [0.4, 2.8, 3.2], fov: 26 },
  // Llega POR ENCIMA del panel de cubierta (SandwichPanel, mount en
  // [0, ridgeHeight≈2.9, 1.0]) mirando hacia abajo a su cara exterior: la
  // franja delgada horizontal del panel llena el encuadre en vez de verse
  // de canto (que es lo que dejaba pantalla negra — ver nota abajo).
  { t: 0.26, pos: [0.35, 3.3, 1.35], target: [0.02, 2.92, 1.0], fov: 30 },

  // como-se-arma (0.26–0.42) — atraviesa la lámina exterior, el núcleo y la
  // interior del panel de cubierta.
  // NOTA (fix del "tramo vacío" que veía el cliente, `_brief/05-rediseno.md`):
  // el panel es una franja HORIZONTAL delgada (fino en Y). Las anclas viejas
  // mantenían la cámara casi en el mismo plano Y que el panel durante todo el
  // tramo → se veía de canto (una línea) con todo lo demás fuera de cuadro:
  // pantalla negra en capturas de 28%-40%. Y peor: la ancla de salida subía
  // por encima de la cumbrera (y=3.55 > ridgeHeight=2.9) hacia el exterior/
  // cielo, en vez de bajar hacia el interior de la nave como pide el
  // storyboard ("sale por la lámina interior") — ahí no hay geometría.
  // Fix: cruce con fov muy abierto a distancia mínima (lee como "atravesando
  // el material" de cerca) y luego la cámara BAJA (Y decrece) hacia el
  // interior de la nave, con el objetivo apuntando a los pórticos/piso/
  // entrepiso — siempre algo reconocible en cuadro.
  { t: 0.34, pos: [0.05, 2.95, 1.05], target: [0, 2.84, 0.9], fov: 48 },
  { t: 0.42, pos: [0, 2.35, 0.4], target: [0, 1.25, -2.4], fov: 36 },

  // catalogo (0.42–0.62) — retroceso amplio: la nave se ensambla pieza por
  // pieza (cada línea de producto se ilumina en su lugar estructural real).
  { t: 0.5, pos: [5.2, 3.6, 5.2], target: [0, 1.8, 0.5], fov: 36 },
  { t: 0.62, pos: [4.6, 2.2, -1.2], target: [0, 1.6, -1.2], fov: 34 },

  // a-tu-medida (0.62–0.74) — elevación lateral: la nave se estira con cotas.
  { t: 0.68, pos: [6.6, 1.8, -2.4], target: [0, 1.4, -2.4], fov: 40 },
  { t: 0.74, pos: [4.6, 1.6, -4.2], target: [0, 1.3, -4.2], fov: 36 },

  // nosotros (0.74–0.84) — a nivel de piso, mirando hacia la estructura.
  { t: 0.8, pos: [0.6, 0.6, -5.2], target: [0.2, 3.1, -5.4], fov: 34 },
  { t: 0.84, pos: [0, 0.5, -6.0], target: [0, 3.2, -6.0], fov: 32 },

  // planta-y-obras (0.84–0.93) — luz cenital, la cámara desciende al piso.
  { t: 0.88, pos: [0, 0.32, -3.4], target: [0, 3.0, -3.4], fov: 34 },
  { t: 0.93, pos: [0, 0.4, 0], target: [0, 2.9, 0], fov: 34 },

  // cotiza-ahora (0.93–1.00) — avanza y sale por el portón: cierra el loop
  // con la MISMA silueta 3/4 baja exterior del hero (t=1.0 == ANCHORS[0]).
  { t: 0.97, pos: [4.6, 1.5, 8.6], target: [0, 2.0, 4.2], fov: 34 },
  { t: 1.0, pos: [7.6, 1.4, 10.2], target: [0, 1.9, 3.0], fov: 36 },
];

// Composición fija de `prefers-reduced-motion`: dentro de la nave, mirando
// la estructura de techo — la misma pose que ancla `nosotros`.
const REDUCED_POSE: CameraAnchor = { t: 0, pos: [0.6, 0.7, -5.0], target: [0.2, 3.0, -5.2], fov: 34 };

function toVec3(p: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/** Traduce `progress` (0→1) al parámetro uniforme que esperan las curvas + el índice de tramo para el fov. */
function resolveSegment(progress: number): { u: number; i: number; localT: number } {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  let i = 0;
  while (i < ANCHORS.length - 2 && p >= ANCHORS[i + 1].t) i++;
  const a = ANCHORS[i];
  const b = ANCHORS[i + 1];
  const span = b.t - a.t || 1;
  const localT = THREE.MathUtils.clamp((p - a.t) / span, 0, 1);
  const n = ANCHORS.length - 1;
  const u = (i + localT) / n;
  return { u, i, localT };
}

export default function Rig(): ReactElement | null {
  const { camera } = useThree();
  const currentLook = useRef(new THREE.Vector3(REDUCED_POSE.target[0], REDUCED_POSE.target[1], REDUCED_POSE.target[2]));
  const reduced = prefersReducedMotion();

  // Curvas Catmull-Rom "centrípetas" (el tipo más estable frente a puntos no
  // uniformemente espaciados: evita loops/overshoots en los tramos cortos
  // como `cotiza-ahora`). Se construyen una sola vez.
  const posCurve = useMemo(
    () => new THREE.CatmullRomCurve3(ANCHORS.map((a) => toVec3(a.pos)), false, 'centripetal'),
    [],
  );
  const targetCurve = useMemo(
    () => new THREE.CatmullRomCurve3(ANCHORS.map((a) => toVec3(a.target)), false, 'centripetal'),
    [],
  );

  // Modo estático: se posiciona una sola vez en la pose fija y no se vuelve
  // a tocar ni desde useFrame ni desde el scroll — regla dura del brief v2.
  useEffect(() => {
    if (!reduced) return;
    camera.position.set(...REDUCED_POSE.pos);
    camera.lookAt(...REDUCED_POSE.target);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = REDUCED_POSE.fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, reduced]);

  useFrame((_, delta) => {
    if (reduced) return;

    const { u, i, localT } = resolveSegment(scrollState.progress);
    const targetPos = posCurve.getPoint(u);
    const targetLook = targetCurve.getPoint(u);
    const fov = THREE.MathUtils.lerp(ANCHORS[i].fov, ANCHORS[i + 1].fov, localT);

    dampVector3(camera.position, targetPos, 4.5, delta);
    dampVector3(currentLook.current, targetLook, 4.5, delta);
    camera.lookAt(currentLook.current);

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = dampScalar(camera.fov, fov, 4.5, delta);
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
