/**
 * Envoltorio que retrasa el montaje de la escena 3D hasta que el titular del hero ha
 * terminado de entrar.
 *
 * ── POR QUÉ ──────────────────────────────────────────────────────────────────
 * Arrancar WebGL es caro: compilar los shaders y pintar el primer fotograma ocupa el hilo
 * principal de una sentada. GSAP anima desde el hilo principal, así que mientras ese
 * bloqueo dura, la animación del titular se queda CONGELADA a mitad de recorrido.
 *
 * Medido con `client:load`: la entrada del titular, que dura 0.42s, tardaba 5.7s en
 * completarse, con un parón de 4.9s en medio. Es el "se traba al entrar o refrescar" que
 * reportó el cliente. (La cifra absoluta es de un navegador sin GPU, que exagera el coste
 * de WebGL; en una máquina normal el bloqueo es mucho menor, pero cae en el mismo sitio y
 * se ve igual de mal porque la animación dura menos de medio segundo.)
 *
 * `client:idle` NO lo arregla: se probó y el navegador se declara ocioso enseguida — la
 * escena seguía montándose a los 415ms y el parón seguía ahí. Hay que ordenar el arranque
 * de forma explícita, no pedirlo como sugerencia.
 *
 * El hero avisa con `hero:entrada-lista` cuando sus líneas están completas. El tope de
 * seguridad garantiza que la escena se monta igual si ese aviso no llegara nunca (un error
 * de JS en el hero, movimiento reducido, un marcado distinto): el fondo 3D nunca depende de
 * que otra cosa funcione.
 */
import { useEffect, useState, type ReactElement } from 'react';
import Scene from './Scene';

const TOPE_MS = 2500;

export default function SceneDiferida(): ReactElement | null {
  const [montar, setMontar] = useState(false);

  useEffect(() => {
    let hecho = false;
    const arrancar = () => {
      if (hecho) return;
      hecho = true;
      setMontar(true);
    };
    window.addEventListener('hero:entrada-lista', arrancar, { once: true });
    const tope = window.setTimeout(arrancar, TOPE_MS);
    return () => {
      window.removeEventListener('hero:entrada-lista', arrancar);
      window.clearTimeout(tope);
    };
  }, []);

  return montar ? <Scene /> : null;
}
