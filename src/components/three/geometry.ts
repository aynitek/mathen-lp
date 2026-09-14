/**
 * Funciones puras de geometría.
 * Construyen `THREE.Shape` / `THREE.BufferGeometry` a partir de parámetros
 * numéricos — cero dependencias de React, cero assets externos, memoizables
 * con `useMemo` en los componentes que las consumen.
 *
 * Todas las proporciones citadas (ángulos, espesores) provienen de
 * `_brief/02-direccion-visual-y-3d.md` §4 y de la ficha técnica del perfil TR4.
 */
import * as THREE from 'three';

/** Parámetros de un perfil trapezoidal genérico (TR4 y variantes de placa colaborante). */
export interface TrapezoidalProfileParams {
  /** Ancho de una repetición cresta+valle. */
  pitch: number;
  /** Altura de la cresta sobre el valle. */
  height: number;
  /** Ancho plano de la cresta (arriba). */
  crestWidth: number;
  /** Ancho plano del valle (abajo). */
  valleyWidth: number;
  /** Número de repeticiones cresta-valle dibujadas en el Shape. */
  repeats: number;
}

export const TR4_PROFILE: TrapezoidalProfileParams = {
  pitch: 0.4,
  height: 0.18,
  crestWidth: 0.16,
  valleyWidth: 0.16,
  repeats: 3,
};

/** Placa colaborante: perfil más profundo y anguloso (steel deck 38/60/75mm reales). */
export const STEEL_DECK_PROFILE: TrapezoidalProfileParams = {
  pitch: 0.44,
  height: 0.34,
  crestWidth: 0.12,
  valleyWidth: 0.2,
  repeats: 3,
};

/**
 * Dibuja el perfil trapezoidal cresta-valle-cresta (ángulos duros 90°/45°)
 * como un `THREE.Shape` 2D listo para `ExtrudeGeometry`.
 * El resultado es una franja delgada de "rebanada" de plancha, no un sólido macizo:
 * se dibuja el contorno superior (ondulado) y el inferior (plano), unidos en los bordes.
 */
export function createTrapezoidalShape(params: TrapezoidalProfileParams, thickness = 0.05): THREE.Shape {
  const { pitch, height, crestWidth, valleyWidth, repeats } = params;
  const slope = (pitch - crestWidth - valleyWidth) / 2 || 0.02;
  const shape = new THREE.Shape();

  const totalWidth = pitch * repeats;
  let x = -totalWidth / 2;
  const y0 = 0;

  shape.moveTo(x, y0);
  for (let i = 0; i < repeats; i++) {
    // valle plano
    shape.lineTo(x + valleyWidth, y0);
    x += valleyWidth;
    // rampa ascendente (45°)
    shape.lineTo(x + slope, y0 + height);
    x += slope;
    // cresta plana
    shape.lineTo(x + crestWidth, y0 + height);
    x += crestWidth;
    // rampa descendente
    shape.lineTo(x + slope, y0);
    x += slope;
  }
  // borde derecho hacia abajo (espesor de chapa)
  shape.lineTo(x, y0 - thickness);
  // contorno inferior de regreso (plano, cara posterior de la chapa)
  shape.lineTo(-totalWidth / 2, y0 - thickness);
  shape.closePath();

  return shape;
}

/** Extruye el perfil trapezoidal en una rebanada corta (lectura como "corte de 5cm"). */
export function createTrapezoidalGeometry(
  params: TrapezoidalProfileParams,
  depth = 0.4,
  thickness = 0.05,
): THREE.ExtrudeGeometry {
  const shape = createTrapezoidalShape(params, thickness);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.008,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.center();
  return geometry;
}

/**
 * Perfil alveolar de policarbonato: dos pieles planas unidas por una serie
 * de arcos internos (las "cámaras de aire"). Se dibuja como un Shape con
 * agujeros circulares (los `THREE.Path` internos) para que el `ExtrudeGeometry`
 * deje huecos reales — sin textura, solo geometría.
 */
export function createAlveolarShape(cells = 4, cellWidth = 0.5, height = 0.24): THREE.Shape {
  const width = cells * cellWidth;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  const radius = height * 0.34;
  for (let i = 0; i < cells; i++) {
    const cx = -width / 2 + cellWidth * (i + 0.5);
    const hole = new THREE.Path();
    hole.absellipse(cx, height / 2, radius, radius, 0, Math.PI * 2, false, 0);
    shape.holes.push(hole);
  }
  return shape;
}

export function createAlveolarGeometry(cells = 4, cellWidth = 0.5, height = 0.24, depth = 1.4): THREE.ExtrudeGeometry {
  const shape = createAlveolarShape(cells, cellWidth, height);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.center();
  return geometry;
}

/** Ruido pseudo-Perlin barato en GLSL (para roughnessMap procedural del núcleo EPS). Solo texto de shader, no textura. */
export const GLSL_CHEAP_NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
`;

/**
 * Layout compartido de "la nave" — un solo lugar de verdad para las
 * dimensiones del edificio, consumido tanto por `IndustrialHall.tsx` (que
 * construye la geometría) como por `Rig.tsx` (que calcula la trayectoria de
 * cámara) y por los componentes reutilizados (`SandwichPanel`, `Polycarbonate`,
 * `SteelDeck`) que ahora viven empotrados en la estructura real del edificio
 * en vez de flotar en el vacío. Ver `_brief/04-recorrido-espacial.md`.
 *
 * Eje Z: +Z es "afuera" (el portón, lado del atardecer del hero/cierre de
 * `cotiza-ahora`); -Z es el fondo de la nave (donde vive `nosotros`).
 */
export const HALL_LAYOUT = {
  width: 5.2,
  length: 12,
  eaveHeight: 1.7,
  ridgeHeight: 2.9,
  frameSpacing: 1.5,
  frameCountHigh: 9,
  frameCountLow: 5,
  gateWidth: 2.2,
  gateHeight: 2.0,
  /** Posición Z del muro frontal (el portón por el que se entra/sale). */
  gateZ: 6,
} as const;

/** Ángulo de la cubierta a dos aguas (mismo trazo que el isotipo). */
export const HALL_PITCH_ANGLE = Math.atan2(
  HALL_LAYOUT.ridgeHeight - HALL_LAYOUT.eaveHeight,
  HALL_LAYOUT.width / 2,
);

/**
 * Altura del perfil corrugado en un punto `x` (misma matemática que el
 * `trapezoidWave` GLSL de la antigua `MetalSheet.tsx`, pero evaluada en JS
 * una sola vez por vértice porque ahora la cubierta es geometría estática:
 * no necesita re-mutarse por frame, así que no necesita shader.
 */
function trapezoidHeight(x: number, params: TrapezoidalProfileParams): number {
  const { pitch, height } = params;
  const phase = ((x % pitch) + pitch) % pitch / pitch;
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const flatRatio = 0.3;
  const t = THREE.MathUtils.clamp((tri - flatRatio) / (1 - 2 * flatRatio), 0, 1);
  return (t - 0.5) * height;
}

/** Perfil de cubierta a escala de nave: mismo pitch que TR4, cresta mucho más
 * baja (la ficha de detalle vive en `TR4_PROFILE`; a escala de edificio esa
 * altura se vería como dientes de sierra, no como una cubierta real). */
export const HALL_ROOF_PROFILE: TrapezoidalProfileParams = {
  ...TR4_PROFILE,
  height: 0.035,
};

export interface RoofSlopeOptions {
  profile: TrapezoidalProfileParams;
  /** Punto (x,y) en el alero, extremo `u=0` de la pendiente. */
  from: THREE.Vector2;
  /** Punto (x,y) en la cumbrera, extremo `u=1` de la pendiente. */
  to: THREE.Vector2;
  /** Extensión de la nave a lo largo de Z (dirección de las crestas). */
  length: number;
  /** Sub-rango de la pendiente a generar — permite dejar un hueco (tragaluz). */
  uStart?: number;
  uEnd?: number;
  segmentsAlongSlope?: number;
  segmentsAlongLength?: number;
}

/**
 * Genera un paño de cubierta a dos aguas: una franja recta en el plano
 * vertical que va del alero (`from`) a la cumbrera (`to`), desplazada en su
 * eje perpendicular (normal 2D hacia afuera y hacia arriba) según el perfil
 * corrugado, evaluado a lo largo de Z. Construida a mano (no como
 * `PlaneGeometry` rotada) porque la dirección de las crestas (Z) es distinta
 * de la dirección de la pendiente (X/Y combinados).
 */
export function createRoofSlopeGeometry(opts: RoofSlopeOptions): THREE.BufferGeometry {
  const {
    profile,
    from,
    to,
    length,
    uStart = 0,
    uEnd = 1,
    segmentsAlongSlope = 6,
    segmentsAlongLength = 96,
  } = opts;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const slopeLen = Math.hypot(dx, dy) || 1;
  // Normal 2D perpendicular a la pendiente, forzada a apuntar "hacia arriba" (ny > 0).
  let nx = dy / slopeLen;
  let ny = -dx / slopeLen;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const su = Math.max(1, segmentsAlongSlope);
  const sz = Math.max(1, segmentsAlongLength);

  for (let iu = 0; iu <= su; iu++) {
    const u = THREE.MathUtils.lerp(uStart, uEnd, iu / su);
    const baseX = THREE.MathUtils.lerp(from.x, to.x, u);
    const baseY = THREE.MathUtils.lerp(from.y, to.y, u);
    for (let iz = 0; iz <= sz; iz++) {
      const z = THREE.MathUtils.lerp(-length / 2, length / 2, iz / sz);
      const h = trapezoidHeight(z, profile);
      positions.push(baseX + nx * h, baseY + ny * h, z);
    }
  }

  const rowLen = sz + 1;
  for (let iu = 0; iu < su; iu++) {
    for (let iz = 0; iz < sz; iz++) {
      const a = iu * rowLen + iz;
      const b = a + rowLen;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
