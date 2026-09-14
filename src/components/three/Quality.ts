/**
 * Flag global de "hay margen de rendimiento de sobra" — separado en su
 * propio módulo (en vez de vivir en `Scene.tsx`) para que `IndustrialHall.tsx`
 * y `Polycarbonate.tsx` puedan importarlo sin crear una dependencia circular
 * con el propio `Scene.tsx` que los monta a ambos.
 *
 * Gatea el único material `transmission` real que queda en toda la escena
 * (ver `Scene.tsx` para el porqué): por defecto `true` (se asume gama alta
 * hasta que `PerformanceMonitor` diga lo contrario desde `Scene.tsx`), y en
 * low-power/reduced-motion arranca en `false` directamente.
 */
import { createContext } from 'react';

export const QualityContext = createContext<boolean>(true);
