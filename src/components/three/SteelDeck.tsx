/**
 * Placa colaborante (steel deck) — el entrepiso de `IndustrialHall`. Ya no es
 * una pieza de catálogo flotante: es la losa de entrepiso real de la nave,
 * siempre presente desde que `catalogo` empieza a ensamblar el edificio
 * (mapa canónico, arranque de 0.42) en adelante — con un realce adicional
 * durante su propio sub-beat de ensamblaje. Un `InstancedMesh` repite el
 * perfil trapezoidal profundo (38/60/75mm reales, ver `STEEL_DECK_PROFILE`)
 * a lo largo del eje X; un plano semi-transparente encima representa el
 * concreto vaciado.
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createTrapezoidalGeometry, STEEL_DECK_PROFILE } from './geometry';
import { scrollState, isLowPower } from '../../lib/scroll';
import { dampScalar, smooth01, subBeatWeight } from './useSceneValue';

const INSTANCE_COUNT_HIGH = 6;
const INSTANCE_COUNT_LOW = 3;
// Entrepiso a media altura, dentro de la nave (ver Rig.tsx / HALL_LAYOUT).
const MOUNT_POSITION: [number, number, number] = [0, 0.95, -2.0];

export default function SteelDeck(): ReactElement {
  const lowPower = isLowPower();
  const count = lowPower ? INSTANCE_COUNT_LOW : INSTANCE_COUNT_HIGH;

  const groupRef = useRef<THREE.Group>(null);
  const instancedRef = useRef<THREE.InstancedMesh>(null);
  const concreteRef = useRef<THREE.Mesh>(null);
  const concreteMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const geometry = useMemo(() => createTrapezoidalGeometry(STEEL_DECK_PROFILE, 0.5, 0.035), []);
  const pitch = STEEL_DECK_PROFILE.pitch * STEEL_DECK_PROFILE.repeats;

  useFrame((_, delta) => {
    const { progress, scene, local } = scrollState;
    const isActive = scene === 3;
    // Sub-beat "steel deck" dentro de "catalogo" (ver IndustrialHall.tsx: floorBeat) —
    // realce puntual mientras el catálogo lo destaca en su lugar estructural.
    const assemblyBeat = isActive ? subBeatWeight(local, 0.56, 0.78, 0.06) : 0;
    // Presencia: aparece cuando la nave se ensambla (arranque de "catalogo") y se
    // queda montado — es la losa de entrepiso real, no una pieza de catálogo temporal.
    const appear = smooth01((progress - 0.42) / 0.05);
    const scaleTarget = Math.max(appear, assemblyBeat);

    if (groupRef.current) {
      groupRef.current.scale.setScalar(dampScalar(groupRef.current.scale.x, Math.max(scaleTarget, 0.0001), 5, delta));
    }
    if (concreteMatRef.current) {
      concreteMatRef.current.opacity = dampScalar(concreteMatRef.current.opacity, appear * 0.5 + assemblyBeat * 0.3, 5, delta);
    }

    if (instancedRef.current) {
      const spread = THREE.MathUtils.lerp(0, 1, scaleTarget);
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * pitch;
        dummy.position.set(offset * spread, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        instancedRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} scale={0.0001} position={MOUNT_POSITION}>
      <instancedMesh ref={instancedRef} args={[geometry, undefined, count]}>
        <meshStandardMaterial color="#B9C0CA" metalness={1} roughness={0.35} side={THREE.DoubleSide} />
      </instancedMesh>
      <mesh ref={concreteRef} position={[0, STEEL_DECK_PROFILE.height + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[pitch * count, 1.0]} />
        <meshStandardMaterial
          ref={concreteMatRef}
          color="#8A8F98"
          roughness={0.95}
          metalness={0}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
