/**
 * La nave — el edificio que la cámara recorre (`_brief/04-recorrido-espacial.md`).
 * Cien por ciento geometría procedural, cero GLTF: pórticos repetidos por
 * `InstancedMesh`, cubierta a dos aguas con el perfil TR4 extruido a mano
 * (`createRoofSlopeGeometry`, mismo trazo que el isotipo), muros machimbrados
 * (tablones repetidos por instancing) y un hueco de tragaluz en cada faldón.
 *
 * Todo es estático salvo:
 *  - el estiramiento paramétrico de `a-tu-medida` (largo/ancho en vivo + cota naranja),
 *  - el barrido de "la nave se ensambla pieza por pieza" de `catalogo` (emissive
 *    por parte estructural: cubierta → muro → piso → tragaluz),
 *  - el brillo cenital de los tragaluces en `planta-y-obras`.
 * Todo lo demás se calcula una sola vez al montar (`useMemo`), nunca por frame.
 */
import { useContext, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  HALL_LAYOUT,
  HALL_PITCH_ANGLE,
  HALL_ROOF_PROFILE,
  createRoofSlopeGeometry,
} from './geometry';
import { scrollState, prefersReducedMotion, isLowPower } from '../../lib/scroll';
import { dampScalar, scenePresence, subBeatWeight } from './useSceneValue';
import { QualityContext } from './Quality';

const { width, length, eaveHeight, ridgeHeight, gateWidth } = HALL_LAYOUT;
const halfWidth = width / 2;
const halfLength = length / 2;
const midHeight = (eaveHeight + ridgeHeight) / 2;
const slopeLen = Math.hypot(halfWidth, ridgeHeight - eaveHeight);

// Hueco de tragaluz a lo largo de la pendiente (0=alero, 1=cumbrera).
const SKYLIGHT_U0 = 0.54;
const SKYLIGHT_U1 = 0.7;

export default function IndustrialHall(): ReactElement {
  const reduced = prefersReducedMotion();
  const lowPower = isLowPower();
  // Único material `transmission` real que queda en toda la escena (brief
  // v3): solo se activa con margen de rendimiento de sobra (`QualityContext`,
  // gateado en vivo por `PerformanceMonitor` en `Scene.tsx`). Sin margen, cae
  // al mismo vidrio barato (opacity + roughness, sin refracción) que ya se
  // usaba para low-power.
  const highQuality = useContext(QualityContext);
  const cheapSkylight = lowPower || !highQuality;

  const groupRef = useRef<THREE.Group>(null);
  const roofMatRefs = useRef<THREE.MeshStandardMaterial[]>([]);
  const wallMatRefs = useRef<THREE.MeshStandardMaterial[]>([]);
  const floorMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const skylightMatRefs = useRef<THREE.MeshPhysicalMaterial[]>([]);
  const shaftMatRefs = useRef<THREE.MeshBasicMaterial[]>([]);
  const dimZGeomRef = useRef<THREE.BufferGeometry>(null);
  const dimXGeomRef = useRef<THREE.BufferGeometry>(null);
  const dimMatRef = useRef<THREE.LineBasicMaterial>(null);
  const dimMatXRef = useRef<THREE.LineBasicMaterial>(null);

  const frameCount = lowPower ? HALL_LAYOUT.frameCountLow : HALL_LAYOUT.frameCountHigh;
  const roofSegLength = lowPower ? 48 : 128;
  const wallBoardWidth = 1.0;
  const wallBoardCount = Math.round(length / wallBoardWidth);
  const gateBoardCount = Math.max(1, Math.round(width / wallBoardWidth));

  const dummy = useMemo(() => new THREE.Object3D(), []);

  const frameZs = useMemo(() => {
    const zs: number[] = [];
    const start = -((frameCount - 1) / 2) * HALL_LAYOUT.frameSpacing;
    for (let i = 0; i < frameCount; i++) zs.push(start + i * HALL_LAYOUT.frameSpacing);
    return zs;
  }, [frameCount]);

  const columnGeometry = useMemo(() => new THREE.BoxGeometry(0.1, eaveHeight, 0.14), []);
  const rafterGeometry = useMemo(() => new THREE.BoxGeometry(slopeLen, 0.12, 0.14), []);

  const columnsRef = useRef<THREE.InstancedMesh>(null);
  const raftersRef = useRef<THREE.InstancedMesh>(null);

  // Geometría de las dos aguas — franja de alero a cumbrera con el hueco del
  // tragaluz separando panel inferior y panel superior.
  const roofPanels = useMemo(() => {
    const sides: Array<{ from: THREE.Vector2; to: THREE.Vector2; sign: number }> = [
      { from: new THREE.Vector2(halfWidth, eaveHeight), to: new THREE.Vector2(0, ridgeHeight), sign: 1 },
      { from: new THREE.Vector2(-halfWidth, eaveHeight), to: new THREE.Vector2(0, ridgeHeight), sign: -1 },
    ];
    return sides.map(({ from, to, sign }) => ({
      sign,
      lower: createRoofSlopeGeometry({
        profile: HALL_ROOF_PROFILE,
        from,
        to,
        length,
        uStart: 0,
        uEnd: SKYLIGHT_U0,
        segmentsAlongLength: roofSegLength,
        segmentsAlongSlope: 3,
      }),
      upper: createRoofSlopeGeometry({
        profile: HALL_ROOF_PROFILE,
        from,
        to,
        length,
        uStart: SKYLIGHT_U1,
        uEnd: 1,
        segmentsAlongLength: roofSegLength,
        segmentsAlongSlope: 3,
      }),
      skylight: createRoofSlopeGeometry({
        profile: { ...HALL_ROOF_PROFILE, height: 0.01 },
        from,
        to,
        length,
        uStart: SKYLIGHT_U0,
        uEnd: SKYLIGHT_U1,
        segmentsAlongLength: Math.round(roofSegLength / 3),
        segmentsAlongSlope: 2,
      }),
    }));
  }, [roofSegLength]);

  // Machimbrado: el tablón debe quedar CASI a ras (tapando el muro) con un
  // reborde delgado que sobresale apenas (relieve sutil) — no al revés.
  // Antes los argumentos de `BoxGeometry` estaban invertidos: el "ancho" (0.92,
  // grande) se usaba como el saliente perpendicular al muro y el "espesor"
  // (0.1, chico) como el paso entre tablones, dando un peine de costillas muy
  // separadas en vez de un muro tapado. Se corrige: saliente chico (relieve),
  // ancho de tablón real (con una pequeña ranura de sombra entre tablones).
  const boardReveal = 0.045;
  const wallBoardGeometry = useMemo(
    () => new THREE.BoxGeometry(boardReveal, eaveHeight, wallBoardWidth * 0.92),
    [],
  );
  const gateBoardGeometry = useMemo(
    () => new THREE.BoxGeometry(boardReveal, eaveHeight, wallBoardWidth * 0.92),
    [],
  );
  const floorGeometry = useMemo(() => new THREE.PlaneGeometry(width, length), []);

  const sideWallsRef = useRef<THREE.InstancedMesh>(null);
  const gateWallRef = useRef<THREE.InstancedMesh>(null);

  // Aplica las matrices de instancia una sola vez que los meshes existen
  // (pórticos, muros): geometría estática, no depende de scroll.
  const applyInstances = () => {
    if (columnsRef.current) {
      let i = 0;
      for (const z of frameZs) {
        for (const sx of [-1, 1]) {
          dummy.position.set(sx * halfWidth, eaveHeight / 2, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          columnsRef.current.setMatrixAt(i++, dummy.matrix);
        }
      }
      columnsRef.current.instanceMatrix.needsUpdate = true;
    }
    if (raftersRef.current) {
      let i = 0;
      for (const z of frameZs) {
        // Correa derecha: alero (halfWidth,eave) → cumbrera (0,ridge).
        dummy.position.set(halfWidth / 2, midHeight, z);
        dummy.rotation.set(0, 0, Math.PI - HALL_PITCH_ANGLE);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        raftersRef.current.setMatrixAt(i++, dummy.matrix);
        // Correa izquierda: alero (-halfWidth,eave) → cumbrera (0,ridge).
        dummy.position.set(-halfWidth / 2, midHeight, z);
        dummy.rotation.set(0, 0, HALL_PITCH_ANGLE);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        raftersRef.current.setMatrixAt(i++, dummy.matrix);
      }
      raftersRef.current.instanceMatrix.needsUpdate = true;
    }
    if (sideWallsRef.current) {
      let i = 0;
      for (const sx of [-1, 1]) {
        for (let b = 0; b < wallBoardCount; b++) {
          const z = -halfLength + (b + 0.5) * wallBoardWidth;
          dummy.position.set(sx * halfWidth, eaveHeight / 2, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          sideWallsRef.current.setMatrixAt(i++, dummy.matrix);
        }
      }
      sideWallsRef.current.instanceMatrix.needsUpdate = true;
    }
    if (gateWallRef.current) {
      let i = 0;
      const halfGate = gateWidth / 2;
      for (let b = 0; b < gateBoardCount; b++) {
        const x = -halfWidth + (b + 0.5) * wallBoardWidth;
        if (Math.abs(x) < halfGate) continue; // hueco del portón
        dummy.position.set(x, eaveHeight / 2, halfLength);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        gateWallRef.current.setMatrixAt(i++, dummy.matrix);
      }
      // Instancias sobrantes (las del hueco) se colapsan a escala 0 para no dejar basura visible.
      for (; i < gateBoardCount; i++) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        gateWallRef.current.setMatrixAt(i, dummy.matrix);
      }
      gateWallRef.current.instanceMatrix.needsUpdate = true;
    }
  };

  // Las instancias son estáticas: se calculan una vez tras el montaje (los
  // `InstancedMesh` ya existen para entonces) y solo se recalculan si
  // `frameCount`/`wallBoardCount` cambian, es decir, al variar
  // `isLowPower()`, que ya está fijo por sesión.
  useEffect(applyInstances, [frameZs, wallBoardCount, gateBoardCount]);

  useFrame((_, delta) => {
    if (reduced) return;
    const { progress, scene, local } = scrollState;

    // --- a-tu-medida (escena 4): la nave se estira en largo/ancho con cotas naranjas. ---
    const custom = scene === 4;
    const stretchZ = custom ? 1 + local * 0.55 : 1;
    const stretchX = custom ? 1 + local * 0.18 : 1;
    if (groupRef.current) {
      groupRef.current.scale.z = dampScalar(groupRef.current.scale.z, stretchZ, 5, delta);
      groupRef.current.scale.x = dampScalar(groupRef.current.scale.x, stretchX, 5, delta);
    }
    const dimWeight = scenePresence(progress, 4);
    if (dimMatRef.current) {
      dimMatRef.current.opacity = dampScalar(dimMatRef.current.opacity, dimWeight * 0.9, 6, delta);
    }
    if (dimMatXRef.current) {
      dimMatXRef.current.opacity = dampScalar(dimMatXRef.current.opacity, dimWeight * 0.9, 6, delta);
    }
    if (dimZGeomRef.current) {
      const attr = dimZGeomRef.current.getAttribute('position') as THREE.BufferAttribute;
      const z = halfLength * stretchZ + 0.6;
      attr.setXYZ(0, halfWidth * stretchX + 0.6, 0.05, -z);
      attr.setXYZ(1, halfWidth * stretchX + 0.6, 0.05, z);
      attr.needsUpdate = true;
    }
    if (dimXGeomRef.current) {
      const attr = dimXGeomRef.current.getAttribute('position') as THREE.BufferAttribute;
      const x = halfWidth * stretchX;
      const z = halfLength * stretchZ + 0.9;
      attr.setXYZ(0, -x, 0.05, z);
      attr.setXYZ(1, x, 0.05, z);
      attr.needsUpdate = true;
    }

    // --- catalogo (escena 3): la nave se ensambla — cada parte se ilumina en su lugar real. ---
    const roofBeat = subBeatWeight(local, 0.0, 0.22, 0.06);
    const wallBeat = subBeatWeight(local, 0.28, 0.5, 0.06);
    const floorBeat = subBeatWeight(local, 0.56, 0.78, 0.06);
    const skylightBeat = subBeatWeight(local, 0.82, 1.0, 0.08);
    const isCatalogo = scene === 3;

    for (const mat of roofMatRefs.current) {
      if (!mat) continue;
      const glow = isCatalogo ? roofBeat : 0;
      mat.emissiveIntensity = dampScalar(mat.emissiveIntensity, glow * 0.8, 5, delta);
    }
    for (const mat of wallMatRefs.current) {
      if (!mat) continue;
      const glow = isCatalogo ? wallBeat : 0;
      mat.emissiveIntensity = dampScalar(mat.emissiveIntensity, glow * 0.7, 5, delta);
    }
    if (floorMatRef.current) {
      const glow = isCatalogo ? floorBeat : 0;
      floorMatRef.current.emissiveIntensity = dampScalar(floorMatRef.current.emissiveIntensity, glow * 0.6, 5, delta);
    }

    // --- Tragaluces: presencia base + protagonismo en catalogo (skylightBeat) y planta-y-obras (luz cenital). ---
    const cenital = scenePresence(progress, 6, 0.06);
    const skylightWeight = Math.max(0.35, isCatalogo ? skylightBeat : 0, cenital);
    for (const mat of skylightMatRefs.current) {
      if (!mat) continue;
      mat.opacity = dampScalar(mat.opacity, skylightWeight, 5, delta);
      mat.emissiveIntensity = dampScalar(mat.emissiveIntensity, cenital * 1.4, 5, delta);
    }
    if (!lowPower) {
      for (const mat of shaftMatRefs.current) {
        if (!mat) continue;
        mat.opacity = dampScalar(mat.opacity, cenital * 0.22, 4, delta);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Pórticos: columnas + correas repetidas por InstancedMesh. */}
      <instancedMesh ref={columnsRef} args={[columnGeometry, undefined, frameCount * 2]}>
        <meshStandardMaterial color="#0E4A93" metalness={0.85} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={raftersRef} args={[rafterGeometry, undefined, frameCount * 2]}>
        <meshStandardMaterial color="#0E4A93" metalness={0.85} roughness={0.4} />
      </instancedMesh>

      {/* Cubierta a dos aguas: perfil TR4 extruido a mano, con hueco de tragaluz. */}
      {roofPanels.map((panel, i) => (
        <group key={i}>
          <mesh geometry={panel.lower}>
            <meshStandardMaterial
              ref={(m) => {
                if (m) roofMatRefs.current[i * 2] = m;
              }}
              color="#BCC3CC"
              metalness={1}
              roughness={0.26}
              emissive="#F95601"
              emissiveIntensity={0}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={panel.upper}>
            <meshStandardMaterial
              ref={(m) => {
                if (m) roofMatRefs.current[i * 2 + 1] = m;
              }}
              color="#BCC3CC"
              metalness={1}
              roughness={0.26}
              emissive="#F95601"
              emissiveIntensity={0}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={panel.skylight}>
            <meshPhysicalMaterial
              ref={(m) => {
                if (m) skylightMatRefs.current[i] = m;
              }}
              color="#DCEAF5"
              roughness={cheapSkylight ? 0.4 : 0.12}
              metalness={0}
              transmission={cheapSkylight ? 0 : 0.75}
              thickness={0.3}
              ior={1.585}
              emissive="#F5F6F8"
              emissiveIntensity={0}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
          {!lowPower && (
            <mesh
              position={[panel.sign * halfWidth * 0.32, midHeight * 0.55, 0]}
              rotation={[0, 0, panel.sign * HALL_PITCH_ANGLE]}
            >
              <planeGeometry args={[0.55, midHeight * 0.9]} />
              <meshBasicMaterial
                ref={(m) => {
                  if (m) shaftMatRefs.current[i] = m;
                }}
                color="#F5F6F8"
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* Muros machimbrados: tablones repetidos por instancing en ambos lados. */}
      <instancedMesh ref={sideWallsRef} args={[wallBoardGeometry, undefined, wallBoardCount * 2]}>
        <meshStandardMaterial
          ref={(m) => {
            if (m) wallMatRefs.current[0] = m;
          }}
          color="#AEB5BF"
          metalness={0.7}
          roughness={0.4}
          emissive="#F95601"
          emissiveIntensity={0}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      {/* Muro frontal (portón): mismo tablón, con un hueco central para entrar/salir. */}
      <instancedMesh ref={gateWallRef} args={[gateBoardGeometry, undefined, gateBoardCount]}>
        <meshStandardMaterial
          ref={(m) => {
            if (m) wallMatRefs.current[1] = m;
          }}
          color="#AEB5BF"
          metalness={0.7}
          roughness={0.4}
          emissive="#F95601"
          emissiveIntensity={0}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {/* Losa de piso (nivel de calle). El entrepiso con placa colaborante lo aporta `SteelDeck`. */}
      <mesh geometry={floorGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <meshStandardMaterial
          ref={floorMatRef}
          color="#8A8F98"
          roughness={0.9}
          metalness={0}
          emissive="#F95601"
          emissiveIntensity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Cotas naranjas de "a-tu-medida" — mismo lenguaje visual que el resto del sitio. */}
      {!reduced && (
        <>
          <line>
            <bufferGeometry ref={dimZGeomRef}>
              <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
            </bufferGeometry>
            <lineBasicMaterial ref={dimMatRef} color="#F95601" transparent opacity={0} />
          </line>
          <line>
            <bufferGeometry ref={dimXGeomRef}>
              <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
            </bufferGeometry>
            <lineBasicMaterial ref={dimMatXRef} color="#F95601" transparent opacity={0} />
          </line>
        </>
      )}
    </group>
  );
}
