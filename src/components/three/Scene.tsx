/**
 * Punto de entrada del 3D — contrato de integración con `index.astro`.
 * Un único `<Canvas>` fijo a pantalla completa, detrás del HTML, montado una
 * sola vez con `client:load`. Todo el estado de scroll se lee por mutación
 * directa de `scrollState` dentro de `useFrame` (nunca `useScrollProgress`,
 * que provocaría un re-render de React por frame).
 *
 * Seguro en SSR: no se toca `window` en el cuerpo del módulo; el Canvas solo
 * se monta tras el primer efecto en cliente (`mounted`), y antes de eso (y
 * si WebGL no está disponible) el componente no renderiza nada — el HTML de
 * las secciones nunca depende del 3D para funcionar.
 *
 * PRESUPUESTO DE RENDIMIENTO (`_brief/05-rediseno.md`, INNEGOCIABLE): el
 * cliente mide el lag en su Mac Retina (DPR 2 = 4× píxeles). Medido: 3
 * materiales con `transmission` fuerzan una pasada de render extra por
 * frame, y a 4× píxeles eso es el cuello de botella real.
 *  - DPR tope 1.5 (no 2), y ADAPTATIVO: `PerformanceMonitor` de drei mide
 *    fps reales y sube/baja el DPR entre 1 y 1.5 — nunca se asume el hardware.
 *  - `QualityContext` es el flag global de "hay margen de sobra": solo
 *    cuando es `true` se permite el único `transmission` real que queda
 *    (el tragaluz de `IndustrialHall.tsx`; los dos de `Polycarbonate.tsx`
 *    se reemplazaron por vidrio falso barato — ver ese archivo). Baja a
 *    `false` en cuanto el monitor detecta una caída sostenida y no se
 *    vuelve a subir sola (evita parpadeo de material a mitad de scroll).
 *  - Los shaders se precompilan al montar (`gl.compileAsync`) para no
 *    pagar el pico de compilación (~199ms medido) en el primer frame real.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor, Preload } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import CanvasErrorBoundary from './CanvasErrorBoundary';
import Lighting from './Lighting';
import Rig from './Rig';
import IndustrialHall from './IndustrialHall';
import SandwichPanel from './SandwichPanel';
import Polycarbonate from './Polycarbonate';
import SteelDeck from './SteelDeck';
import { scrollState, prefersReducedMotion, isLowPower } from '../../lib/scroll';
import { dampScalar, scenePresence } from './useSceneValue';
import { QualityContext } from './Quality';

/** Prueba real de contexto WebGL — no asume nada, solo comprueba. */
function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

/**
 * Atenúa el propio `<canvas>` (opacidad + blur) durante `planta-y-obras`
 * (escena 6 del mapa canónico): el 3D cede protagonismo a la galería HTML.
 * Muta el DOM del canvas directamente, sin estado de React.
 */
function CanvasDimmer(): null {
  const { gl } = useThree();
  useFrame((_, delta) => {
    const dim = scenePresence(scrollState.progress, 6, 0.05);
    const el = gl.domElement;
    const targetOpacity = 1 - dim * 0.75;
    const currentOpacity = Number(el.style.opacity || '1');
    const nextOpacity = dampScalar(currentOpacity, targetOpacity, 5, delta);
    el.style.opacity = nextOpacity.toFixed(3);
    el.style.filter = dim > 0.02 ? `blur(${(dim * 6).toFixed(2)}px)` : 'none';
  });
  return null;
}

/**
 * Precompila todos los programas de shader de la escena una sola vez, justo
 * tras el montaje inicial — elimina el pico de ~199ms de compilación que se
 * medía en el primer frame real (brief v3, diagnóstico del lag). No renderiza
 * nada: solo le pide al `WebGLRenderer` que compile por adelantado.
 */
function ShaderPrecompile(): null {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const maybeAsync = gl as unknown as { compileAsync?: (s: typeof scene, c: typeof camera) => Promise<unknown> };
      if (typeof maybeAsync.compileAsync === 'function') {
        maybeAsync.compileAsync(scene, camera).catch(() => {});
      } else {
        gl.compile(scene, camera);
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Entorno procedural (Lightformers): cero descargas de red, solo geometría
 * emisiva bakeada una vez. Escalado para envolver toda la nave (no un objeto
 * pequeño cerca del origen): un panel cálido cenital (simula el cielo de
 * atardecer del hero/cotiza-ahora), un relleno navy frío del lado opuesto y
 * un acento naranja de marca.
 */
function ProceduralEnvironment(): ReactElement {
  return (
    <Environment resolution={64} frames={1}>
      <Lightformer form="rect" intensity={1.6} color="#EAEDF2" position={[0, 9, 4]} scale={[14, 6, 1]} />
      {/* Franja angosta y brillante: el reflejo especular "definido" que debe
          recorrer las nervaduras del Aluzinc (metal gris frío, no cálido). */}
      <Lightformer form="rect" intensity={2.2} color="#FFFFFF" position={[0, 6, -1]} rotation={[0, 0, 0]} scale={[16, 0.8, 1]} />
      <Lightformer
        form="rect"
        intensity={0.4}
        color="#0E4A93"
        position={[-8, 2, -6]}
        rotation={[0, Math.PI / 3, 0]}
        scale={[6, 6, 1]}
      />
      <Lightformer form="ring" intensity={0.5} color="#F95601" position={[4, 1, 8]} scale={[3, 3, 1]} />
    </Environment>
  );
}

/**
 * Postprocessing sutil (Bloom + Vignette) — solo si el presupuesto lo
 * permite. Medido: ≥55fps a DPR 1.5 con esto activo (ver reporte de
 * verificación). Se retira solo con `QualityContext=false` (caída real
 * detectada por `PerformanceMonitor`) o en low-power/reduced-motion.
 */
function SubtlePost(): ReactElement {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom intensity={0.35} luminanceThreshold={0.72} luminanceSmoothing={0.25} mipmapBlur radius={0.6} />
      <Vignette eskil={false} offset={0.18} darkness={0.55} />
    </EffectComposer>
  );
}

interface SceneContentsProps {
  reduced: boolean;
  lowPower: boolean;
  highQuality: boolean;
  onDpr: (next: number) => void;
  onQuality: (next: boolean) => void;
}

function SceneContents({ reduced, lowPower, highQuality, onDpr, onQuality }: SceneContentsProps): ReactElement {
  return (
    <QualityContext.Provider value={highQuality}>
      {/* Adapta el DPR real (entre 1 y 1.5, tope del presupuesto) a los fps
          medidos en vivo; si cae sostenidamente, también retira el único
          `transmission` restante — no se vuelve a subir solo, para evitar
          que el material "parpadee" a mitad de scroll. */}
      <PerformanceMonitor
        bounds={() => [50, 58]}
        onIncline={() => onDpr(1.5)}
        onDecline={() => {
          onDpr(1);
          onQuality(false);
        }}
      />
      <Lighting />
      <Rig />
      {/* La nave siempre está montada: es la composición fija y bella de
          `prefers-reduced-motion` (ver Rig.tsx: REDUCED_POSE). Los detalles
          que solo tienen sentido como beats de scroll (el corte que la
          cámara atraviesa, el tragaluz de cerca, el entrepiso) sí se retiran
          bajo movimiento reducido — regla dura del brief v2. */}
      {!reduced && <CanvasDimmer />}
      {!lowPower && <ProceduralEnvironment />}
      <IndustrialHall />
      {!reduced && <SandwichPanel />}
      {!reduced && <Polycarbonate />}
      {!reduced && <SteelDeck />}
      {!reduced && !lowPower && highQuality && <SubtlePost />}
      <AdaptiveDpr pixelated={false} />
      <ShaderPrecompile />
      <Preload all />
    </QualityContext.Provider>
  );
}

export default function Scene(): ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [dpr, setDpr] = useState(1.5);
  const [highQuality, setHighQuality] = useState(true);
  const dprRef = useRef(dpr);

  useEffect(() => {
    setMounted(true);
    setWebglOk(isWebglAvailable());
  }, []);

  // Estos dos solo se evalúan de verdad tras el montaje en cliente; en SSR
  // (`mounted === false`) devuelven sus valores por defecto de forma segura.
  const reduced = mounted && prefersReducedMotion();
  const lowPower = mounted && isLowPower();

  // Tope de DPR por perfil de dispositivo (nunca 2 — brief v3): reduced-motion
  // se queda en 1, low-power sube como mucho a 1.25, desktop hasta 1.5 y de
  // ahí lo afina `PerformanceMonitor` en tiempo real.
  const dprCap = reduced ? 1 : lowPower ? 1.25 : 1.5;

  const handleDpr = (next: number) => {
    const clamped = Math.min(dprCap, Math.max(1, next));
    if (Math.abs(clamped - dprRef.current) > 0.01) {
      dprRef.current = clamped;
      setDpr(clamped);
    }
  };

  // En cuanto se sabe que el dispositivo es low-power o el usuario pide
  // movimiento reducido, el único `transmission` que queda se apaga de
  // entrada (no hace falta esperar al monitor de rendimiento).
  useEffect(() => {
    if (lowPower || reduced) setHighQuality(false);
  }, [lowPower, reduced]);

  const canvasDpr = useMemo<[number, number]>(() => [1, Math.min(dpr, dprCap)], [dpr, dprCap]);

  if (!mounted || !webglOk) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      aria-hidden="true"
      data-testid="three-scene-root"
    >
      <CanvasErrorBoundary>
        <Canvas
          dpr={canvasDpr}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            localClippingEnabled: true,
            toneMappingExposure: 1.3,
          }}
          camera={{ position: [7.6, 1.4, 10.2], fov: 36, near: 0.1, far: 60 }}
          tabIndex={-1}
          aria-hidden="true"
        >
          <SceneContents
            reduced={reduced}
            lowPower={lowPower}
            highQuality={highQuality && !lowPower && !reduced}
            onDpr={handleDpr}
            onQuality={setHighQuality}
          />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
