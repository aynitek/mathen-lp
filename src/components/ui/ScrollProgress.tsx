/**
 * Indicador de progreso de scroll — línea de cota, no barra genérica.
 * Isla React (client:idle). Consume el store único de scroll.ts, nunca crea su propio
 * ScrollTrigger de progreso global.
 */
import { useScrollProgress } from '../../lib/scroll';

export default function ScrollProgress() {
  const { progress } = useScrollProgress();
  const pct = Math.round(progress * 100);

  return (
    <div
      className="fixed left-6 top-1/2 -translate-y-1/2 z-40 h-40 w-px bg-white/10 hidden md:block"
      role="progressbar"
      aria-label="Progreso de scroll de la página"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className="w-px bg-orange origin-top"
        style={{ transform: `scaleY(${progress})`, height: '100%', transition: 'transform 100ms linear' }}
      />
      <span
        className="absolute left-3 text-caption text-paper-faint tabular-nums whitespace-nowrap"
        style={{ top: `calc(${progress * 100}% - 0.5em)` }}
      >
        {pct}%
      </span>
    </div>
  );
}
