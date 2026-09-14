/**
 * Corte de panel sándwich — protagonista de la escena `como-se-arma`
 * (0.26 → 0.42). Ya no flota en el vacío: vive empotrado en la cumbrera de
 * `IndustrialHall` (mismo punto que las anclas de `Rig.tsx` en ese tramo),
 * así que la cámara literalmente asciende y lo atraviesa — entra por la
 * lámina exterior, cruza el núcleo, sale por la lámina interior hacia el
 * interior de la nave. Tres mallas hijas (piel superior, núcleo, piel
 * inferior) representan la misma pieza vista "por dentro". El núcleo
 * interpola su altura entre los espesores reales de catálogo
 * (30/40/50/75/100/150/200mm, normalizados) y se revela mediante un
 * `clippingPlane` que barre la sección al entrar a la escena.
 *
 * El núcleo alterna dos variantes de material (PUR espuma rígida / EPS con
 * ruido procedural en la rugosidad) por cross-fade de opacidad — el
 * "scroll-snap interno" del brief, sin desmontar mallas.
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLSL_CHEAP_NOISE, HALL_LAYOUT } from './geometry';
import { scrollState, isLowPower } from '../../lib/scroll';
import { dampScalar, scenePresence, smooth01, lerpKeyframes } from './useSceneValue';

// Espesores reales de catálogo (mm), normalizados a unidades de escena.
const CORE_THICKNESS_MM = [30, 40, 50, 75, 100, 150, 200];
const CORE_WORLD_SCALE = 1 / 220;

const EPS_ROUGHNESS_UNIFORMS = /* glsl */ `${GLSL_CHEAP_NOISE}`;

export default function SandwichPanel(): ReactElement {
  const lowPower = isLowPower();
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const epsCoreRef = useRef<THREE.Mesh>(null);
  const topSkinRef = useRef<THREE.Mesh>(null);
  const bottomSkinRef = useRef<THREE.Mesh>(null);
  const purMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const epsMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const topMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const bottomMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const colorScratch = useRef(new THREE.Color());

  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(1, 0.1, -1).normalize(), 1.6), []);
  const clipPlanes = useMemo(() => [clipPlane], [clipPlane]);

  const width = 1.6;
  const depth = 1.0;
  const skinThickness = 0.045;
  // Empotrado en la cumbrera de la nave: la cámara lo atraviesa ascendiendo en Y.
  const mountPosition: [number, number, number] = [0, HALL_LAYOUT.ridgeHeight, 1.0];

  const skinGeometry = useMemo(() => new THREE.BoxGeometry(width, skinThickness, depth), []);
  const coreGeometry = useMemo(() => new THREE.BoxGeometry(width, 1, depth, 1, lowPower ? 1 : 4, 1), [lowPower]);

  const epsBeforeCompile = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${EPS_ROUGHNESS_UNIFORMS}`)
        .replace(
          '#include <roughnessmap_fragment>',
          // Ruido en espacio de pantalla (no depende de UV, siempre disponible):
          // simula las micro-esferas del EPS sin textura descargada.
          `#include <roughnessmap_fragment>\n roughnessFactor *= clamp(0.75 + hash21(gl_FragCoord.xy * 0.4) * 0.5, 0.0, 1.0);`,
        );
    },
    [],
  );

  useFrame((_, delta) => {
    const { progress, scene, local } = scrollState;
    const weight = scenePresence(progress, 2);
    const visibleScale = Math.max(weight, 0.0001);

    if (groupRef.current) {
      const g = groupRef.current;
      g.scale.setScalar(dampScalar(g.scale.x, visibleScale, 5, delta));
    }

    const isActive = scene === 2;
    const coreLocal = isActive ? local : 0;
    const thicknessMm = lerpKeyframes(coreLocal, CORE_THICKNESS_MM);
    const coreHeight = Math.max(0.12, thicknessMm * CORE_WORLD_SCALE * 1.4);

    if (coreRef.current) {
      const c = coreRef.current;
      c.scale.y = dampScalar(c.scale.y, coreHeight, 5, delta);
    }
    if (epsCoreRef.current) {
      epsCoreRef.current.scale.y = dampScalar(epsCoreRef.current.scale.y, coreHeight, 5, delta);
    }
    const halfCore = coreHeight / 2;
    if (topSkinRef.current) {
      topSkinRef.current.position.y = dampScalar(topSkinRef.current.position.y, halfCore + skinThickness / 2, 5, delta);
    }
    if (bottomSkinRef.current) {
      bottomSkinRef.current.position.y = dampScalar(
        bottomSkinRef.current.position.y,
        -(halfCore + skinThickness / 2),
        5,
        delta,
      );
    }

    // Barrido del plano de corte: se abre en el primer 40% de la escena y queda fijo.
    const openT = isActive ? smooth01(local / 0.4) : 0;
    clipPlane.constant = dampScalar(clipPlane.constant, THREE.MathUtils.lerp(1.6, -0.15, openT), 5, delta);

    // Cross-fade PUR ↔ EPS ("scroll-snap interno" del núcleo).
    const purWeight = isActive ? 1 - smooth01((coreLocal - 0.45) / 0.15) : 0.5;
    if (purMatRef.current) purMatRef.current.opacity = dampScalar(purMatRef.current.opacity, purWeight, 6, delta);
    if (epsMatRef.current) epsMatRef.current.opacity = dampScalar(epsMatRef.current.opacity, 1 - purWeight, 6, delta);

    // Piel: alterna blanco prepintado / navy en un ciclo lento y legible.
    const paintT = (Math.sin(coreLocal * Math.PI * 1.4) + 1) / 2;
    colorScratch.current.set('#F5F6F8').lerp(new THREE.Color('#023063'), paintT * 0.5);
    if (topMatRef.current) topMatRef.current.color.copy(colorScratch.current);
    if (bottomMatRef.current) bottomMatRef.current.color.copy(colorScratch.current);
  });

  return (
    <group ref={groupRef} scale={0.0001} position={mountPosition}>
      {/* `side={THREE.DoubleSide}` en las cuatro mallas: la cámara literalmente
          entra dentro de este volumen (`Rig.tsx`, tramo `como-se-arma`) — sin
          esto, las caras internas se recortan (backface culling) y la escena
          se ve negra justo cuando la cámara está atravesando el corte, que es
          exactamente el momento que el brief pide mostrar. */}
      <mesh ref={topSkinRef} geometry={skinGeometry} position={[0, 0.3, 0]}>
        <meshPhysicalMaterial ref={topMatRef} metalness={1} roughness={0.25} clippingPlanes={clipPlanes} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={bottomSkinRef} geometry={skinGeometry} position={[0, -0.3, 0]}>
        <meshPhysicalMaterial ref={bottomMatRef} metalness={1} roughness={0.25} clippingPlanes={clipPlanes} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={coreRef} geometry={coreGeometry}>
        <meshPhysicalMaterial
          ref={purMatRef}
          color="#F2E9DC"
          roughness={0.9}
          metalness={0}
          transparent
          opacity={0.5}
          clippingPlanes={clipPlanes}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={epsCoreRef} geometry={coreGeometry} scale={[1.001, 1, 1.001]}>
        <meshPhysicalMaterial
          ref={epsMatRef}
          color="#EFEFEF"
          roughness={0.55}
          metalness={0}
          transparent
          opacity={0.5}
          clippingPlanes={clipPlanes}
          onBeforeCompile={epsBeforeCompile}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
