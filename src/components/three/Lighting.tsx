/**
 * Set de luces del recorrido completo. Nunca se desmonta: solo se atenúan
 * intensidades y se reposicionan por mutación de refs en `useFrame`, leyendo
 * `scrollState` directamente (nunca `useScrollProgress`, ver contrato en
 * `Scene.tsx`).
 *
 * Sin sombras (`castShadow`) en ningún punto: el presupuesto de rendimiento
 * del brief prioriza 60fps sobre sombras dinámicas: el volumen se lee por
 * material + rim light, no por shadow mapping.
 */
import { useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { scrollState, prefersReducedMotion, isLowPower } from '../../lib/scroll';
import { dampScalar, scenePresence, subBeatWeight } from './useSceneValue';

// Tono cálido de "atardecer" para las escenas exteriores (hero/cotiza-ahora,
// donde la nave se ve de afuera); el resto del recorrido usa luz blanca neutra.
const COOL_KEY_COLOR = new THREE.Color('#FFFFFF');
const WARM_KEY_COLOR = new THREE.Color('#FFC98F');

export default function Lighting(): ReactElement {
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const rimLight = useRef<THREE.DirectionalLight>(null);
  const hemiLight = useRef<THREE.HemisphereLight>(null);
  const ambientLight = useRef<THREE.AmbientLight>(null);
  const cutawaySpot = useRef<THREE.SpotLight>(null);
  const polycarbBack = useRef<THREE.DirectionalLight>(null);
  const polycarbFront = useRef<THREE.PointLight>(null);

  const reduced = prefersReducedMotion();
  const lowPower = isLowPower();

  useFrame((_, delta) => {
    if (reduced) {
      // Composición fija "interior de la nave" (misma pose que REDUCED_POSE
      // de `Rig.tsx`): se congela un set de luz que lee bien la estructura
      // de techo y el tragaluz, y no se vuelve a leer `scrollState`.
      keyLight.current?.position.set(2.5, 4.5, -3.5);
      if (keyLight.current) {
        keyLight.current.intensity = 1.8;
        keyLight.current.color.copy(COOL_KEY_COLOR);
      }
      if (rimLight.current) rimLight.current.intensity = 0.5;
      if (hemiLight.current) hemiLight.current.intensity = 0.6;
      if (ambientLight.current) ambientLight.current.intensity = 0.34;
      if (cutawaySpot.current) cutawaySpot.current.intensity = 0;
      if (polycarbBack.current) polycarbBack.current.intensity = 1.3;
      if (polycarbFront.current) polycarbFront.current.intensity = 0.35;
      return;
    }

    const { progress, scene, local } = scrollState;

    // --- Key light: barrido en arco durante "la-materia" (escena 1) para que
    // el especular recorra las crestas del TR4. Fuera de esa escena, reposa
    // en su posición base. Tono cálido en las escenas exteriores (hero/cierre).
    if (keyLight.current) {
      const sweeping = scene === 1;
      const angle = sweeping ? local * Math.PI * 2 : 0;
      const targetX = sweeping ? Math.cos(angle) * 3 : 4;
      const targetZ = sweeping ? Math.sin(angle) * 3 : 3;
      keyLight.current.position.x = dampScalar(keyLight.current.position.x, targetX, 6, delta);
      keyLight.current.position.y = dampScalar(keyLight.current.position.y, 5, 6, delta);
      keyLight.current.position.z = dampScalar(keyLight.current.position.z, targetZ, 6, delta);
      keyLight.current.intensity = dampScalar(keyLight.current.intensity, 2.8, 5, delta);

      const sunset = Math.max(scenePresence(progress, 0), scenePresence(progress, 7));
      keyLight.current.color.copy(COOL_KEY_COLOR).lerp(WARM_KEY_COLOR, sunset);
    }

    // --- Rim light naranja: acento de marca constante, se retira en "planta-y-obras".
    if (rimLight.current) {
      const dim = scenePresence(progress, 6); // planta-y-obras: el canvas se atenúa
      rimLight.current.intensity = dampScalar(rimLight.current.intensity, 0.6 * (1 - dim), 5, delta);
    }

    // --- Hemisferio + ambiental: sube hacia el final de "catalogo" y en
    // "nosotros" para aplanar la luz (el 3D deja de ser protagonista).
    const flattenWeight = Math.max(subBeatWeight(local, 0.8, 1, 0.15) * (scene === 3 ? 1 : 0), scenePresence(progress, 5));
    if (hemiLight.current) {
      hemiLight.current.intensity = dampScalar(hemiLight.current.intensity, 0.55 + flattenWeight * 0.5, 4, delta);
    }
    if (ambientLight.current) {
      ambientLight.current.intensity = dampScalar(ambientLight.current.intensity, 0.32 + flattenWeight * 0.6, 4, delta);
    }

    // --- Spot naranja rasante: dramatiza el plano de corte en "como-se-arma".
    if (cutawaySpot.current) {
      const w = scenePresence(progress, 2);
      cutawaySpot.current.intensity = dampScalar(cutawaySpot.current.intensity, lowPower ? w * 3 : w * 5, 5, delta);
    }

    // --- Luz del tragaluz: retroiluminación en la cola de "catalogo" (cuando
    // el policarbonato se destaca en su lugar real, ver IndustrialHall.tsx:
    // skylightBeat) y protagonista fuerte en "planta-y-obras" (luz cenital
    // real entrando por los tragaluces).
    const catalogoBeat = scene === 3 ? subBeatWeight(local, 0.82, 1.0, 0.08) : 0;
    const cenital = scenePresence(progress, 6, 0.06);
    const polyWeight = Math.max(catalogoBeat, cenital);
    if (polycarbBack.current) {
      polycarbBack.current.intensity = dampScalar(polycarbBack.current.intensity, catalogoBeat * 3 + cenital * (lowPower ? 2 : 4), 5, delta);
    }
    if (polycarbFront.current) {
      polycarbFront.current.intensity = dampScalar(polycarbFront.current.intensity, polyWeight * 0.8, 5, delta);
    }
  });

  return (
    <>
      <directionalLight ref={keyLight} position={[4, 5, 3]} intensity={2.2} color="#FFFFFF" />
      <directionalLight ref={rimLight} position={[-3, 1, -2]} intensity={0.6} color="#F95601" />
      <hemisphereLight ref={hemiLight} args={['#0E4A93', '#06070A', 0.55]} />
      <ambientLight ref={ambientLight} intensity={0.32} />
      <spotLight
        ref={cutawaySpot}
        position={[-0.8, 3.4, 1.6]}
        angle={0.5}
        penumbra={0.6}
        intensity={0}
        color="#F95601"
        distance={8}
      />
      <directionalLight ref={polycarbBack} position={[1.0, 4.2, 1.2]} intensity={0} color="#FFFFFF" />
      <pointLight ref={polycarbFront} position={[1.0, 2.0, 3.0]} intensity={0} color="#F95601" />
    </>
  );
}
