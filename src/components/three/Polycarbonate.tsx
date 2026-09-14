/**
 * Tragaluz de policarbonato — el detalle de cerca del hueco que
 * `IndustrialHall` deja en la cubierta (ver `SKYLIGHT_U0/U1` en ese archivo).
 * Cross-fade interno entre dos perfiles: el alveolar (cámaras de aire,
 * `ExtrudeGeometry` con agujeros) y el trapezoidal (mismo perfil TR4) —
 * "ambos disponibles" según el storyboard, alternados por scroll dentro del
 * sub-beat en que el catálogo lo destaca (`catalogo`, cola de 0.42 → 0.62) y
 * protagonista otra vez en `planta-y-obras` (0.84 → 0.93).
 *
 * Vidrio falso barato en los dos (brief v3, presupuesto de rendimiento):
 * nada de `transmission` aquí — el único que queda en toda la escena vive en
 * `IndustrialHall.tsx` (el tragaluz grande, gateado por `QualityContext`).
 * La lectura de "translúcido" sale de opacity + roughness bajo (reflejo
 * especular del envMap procedural, efecto fresnel gratis) + un emissive
 * sutil que simula el tragaluz retroiluminado — visualmente casi idéntico,
 * a una fracción del costo de GPU.
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createAlveolarGeometry, createTrapezoidalGeometry, TR4_PROFILE, HALL_PITCH_ANGLE } from './geometry';
import { scrollState, isLowPower } from '../../lib/scroll';
import { dampScalar, smooth01, scenePresence, subBeatWeight } from './useSceneValue';

// Ubicado sobre el faldón derecho, en el hueco de tragaluz de `IndustrialHall`.
const MOUNT_POSITION: [number, number, number] = [1.0, 2.4, 2.0];

export default function Polycarbonate(): ReactElement {
  const lowPower = isLowPower();
  const groupRef = useRef<THREE.Group>(null);
  const alveolarMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const trapezoidMatRef = useRef<THREE.MeshPhysicalMaterial>(null);

  const alveolarGeometry = useMemo(() => createAlveolarGeometry(lowPower ? 3 : 4, 0.5, 0.22, 1.2), [lowPower]);
  const trapezoidGeometry = useMemo(() => createTrapezoidalGeometry(TR4_PROFILE, 0.35, 0.04), []);

  useFrame((_, delta) => {
    const { progress, scene, local } = scrollState;
    const isActive = scene === 3;
    // Ventana del sub-beat dentro de "catalogo" (ver IndustrialHall.tsx: skylightBeat).
    const catalogoBeat = isActive ? subBeatWeight(local, 0.82, 1.0, 0.08) : 0;
    // Protagonista otra vez en "planta-y-obras" (luz cenital atravesándolo).
    const cenital = scenePresence(progress, 6, 0.06);
    const weight = Math.max(0.18, catalogoBeat, cenital);

    if (groupRef.current) {
      groupRef.current.scale.setScalar(dampScalar(groupRef.current.scale.x, weight, 5, delta));
      groupRef.current.rotation.y = dampScalar(groupRef.current.rotation.y, weight > 0.3 ? Math.PI * 0.08 : 0, 4, delta);
    }

    // Dentro de "catalogo": primera mitad del beat en alveolar, segunda en trapezoidal
    // transmisivo; fuera de "catalogo" (p. ej. la luz cenital de planta-y-obras) se
    // muestran ambos perfiles a la vez, atenuados, como el tragaluz real visto de cerca.
    const beatLocal = isActive ? THREE.MathUtils.clamp((local - 0.82) / 0.18, 0, 1) : 0.5;
    const alveolarWeight = isActive ? 1 - smooth01((beatLocal - 0.4) / 0.15) : 0.7;
    const trapezoidWeight = isActive ? smooth01((beatLocal - 0.45) / 0.15) : 0.5;

    // Backlight sutil: simula la luz cenital atravesando el tragaluz sin
    // pagar `transmission` — un emissive tenue que sube con `cenital`.
    const backlight = 0.15 + cenital * 0.65;

    if (alveolarMatRef.current) {
      const m = alveolarMatRef.current;
      m.opacity = dampScalar(m.opacity, lowPower ? alveolarWeight * 0.55 : alveolarWeight, 5, delta);
      m.emissiveIntensity = dampScalar(m.emissiveIntensity, backlight, 5, delta);
    }
    if (trapezoidMatRef.current) {
      const m = trapezoidMatRef.current;
      m.opacity = dampScalar(m.opacity, lowPower ? trapezoidWeight * 0.55 : trapezoidWeight, 5, delta);
      m.emissiveIntensity = dampScalar(m.emissiveIntensity, backlight, 5, delta);
    }
  });

  return (
    <group ref={groupRef} scale={0.0001} position={MOUNT_POSITION} rotation={[0, 0, -HALL_PITCH_ANGLE]}>
      <mesh geometry={alveolarGeometry} rotation={[0, Math.PI / 2, 0]}>
        {/* Vidrio falso barato (brief v3): sin `transmission` — opacity +
            roughness bajo (fresnel/reflejo del envMap procedural, gratis) +
            emissive sutil que lee como retroiluminado. El único `transmission`
            real de toda la escena vive en `IndustrialHall.tsx`. */}
        <meshPhysicalMaterial
          ref={alveolarMatRef}
          color="#DCEAF5"
          roughness={lowPower ? 0.35 : 0.15}
          metalness={0}
          emissive="#EAF3FF"
          emissiveIntensity={0}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={trapezoidGeometry} position={[0, 0, -0.05]}>
        <meshPhysicalMaterial
          ref={trapezoidMatRef}
          color="#DCEAF5"
          roughness={lowPower ? 0.4 : 0.18}
          metalness={0}
          emissive="#EAF3FF"
          emissiveIntensity={0}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
