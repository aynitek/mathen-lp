/**
 * Bucle horizontal infinito, implementado a mano (D4 de la especificación del catálogo).
 * GSAP no trae `horizontalLoop` como plugin: es una helper function de GreenSock, no
 * un plugin registrable. Aquí se reimplementa el mismo principio con `gsap.utils.wrap`
 * sobre `x` de cada tarjeta, de modo que el salto del último al primer elemento sea
 * matemáticamente invisible (cada tarjeta se reposiciona dentro de una banda de ancho
 * `N * anchoTarjeta`; en todo momento hay tarjetas de sobra fuera del viewport a ambos
 * lados, así que el "wrap" ocurre siempre fuera de la vista).
 *
 * Transform-only: solo se toca `x`/`y`/`scale`/`rotate`/`opacity` vía `gsap.set`/`gsap.to`
 * (traducido a `transform`/`opacity` por GSAP). Prohibido `scrollLeft`/`left`.
 *
 * Avance automático: un `gsap.ticker` que decrementa un offset compartido mientras
 * `playing === true`. Flechas: `step(dir)` anima ese offset en un salto de un ancho
 * de tarjeta con easing, pausando el autoplay durante el salto y devolviéndolo a su
 * estado previo al terminar (si estaba activo).
 *
 * D-B (v5): si el subconjunto de tarjetas visibles (tras filtrar por categoría) es de
 * 3 o menos, no hay bucle — `measure()` cambia a un modo estático que centra la fila
 * dentro del track y el ticker deja de mover nada (`isStatic()`).
 *
 * D-C/D-D (v5): `setDealProgress(p)` reparte las tarjetas desde detrás de la
 * "principal" — la de MENOR `x` en vivo, nunca el índice 0 por supuesto (D-D) — hacia
 * su posición de reposo, con stagger. p=0 → todas apiladas detrás de la principal;
 * p=1 → fila formada (posiciones de reposo normales del bucle). Solo transform/opacity.
 *
 * F1 (v6 — "efecto Flash", causa raíz diagnosticada por el Tech Lead): antes, el
 * reparto (`setDealProgress`) y el bucle (`apply`/`tick`/`step`) escribían `x` (y
 * también y/scale/rotate/opacity) sobre el MISMO nodo (`slides[i]`). Cuando el scrub
 * del reparto todavía tenía inercia (`scrub: 0.7`) y el autoplay ya había arrancado,
 * ambos ganaban la escritura en frames alternos: doble contorno / texto duplicado.
 * Corrección estructural obligatoria: cada tarjeta pasa a tener dos nodos anidados —
 *   - `slides[i]` (`[data-carousel-slide]`): la RANURA EXTERIOR. Solo el bucle la
 *     mueve (`apply()`/`tick()`/`step()`), y solo en `x`.
 *   - `inners[i]` (`[data-carousel-slide-inner]`, hijo directo dentro de la ranura):
 *     el ENVOLTORIO INTERIOR. Solo el reparto (`setDealProgress`) lo mueve —
 *     desfase/escala/rotación/opacidad, expresados como offset RELATIVO a la
 *     posición de reposo de la ranura (0 = coincide exactamente con la ranura).
 * Ningún frame puede escribir la misma propiedad del mismo nodo desde las dos fuentes:
 * es estructuralmente imposible que se pisen, coincidan o no en el tiempo.
 *
 * F2a (v6 — simetría del STAGGER en el reparto): el stagger indexaba linealmente
 * (`k` creciente en una sola dirección circular), así que la vecina inmediata por
 * la IZQUIERDA de la principal (la que envuelve por el colchón del wrap) heredaba
 * el `k` más alto de todo el mazo — arrancaba tardísimo y tenía que recorrer la
 * misma distancia que su espejo de la derecha en una ventana de progreso mucho más
 * corta. Ver `setDealProgress`: el stagger usa distancia CIRCULAR a la principal
 * (`Math.min(k, n-k)`), así que la vecina inmediata izquierda y la derecha
 * comparten literalmente el mismo `depth`/misma ventana. Esto arregló la simetría
 * DEL REPARTO (mazo → fila), pero el Tech Lead verificó con el bucle YA CORRIENDO
 * (captura del cliente, no el reparto) que el defecto seguía: `setDealProgress`
 * solo la invoca el scrub de entrada/salida — durante el AUTOPLAY continuo nadie
 * vuelve a tocarla, así que el borde seguía cortando en seco contra el
 * `overflow:hidden` del viewport, sin ningún gesto.
 *
 * F2b (v6 — absorción durante el BUCLE continuo, el defecto real que faltaba):
 * el cliente aclaró dos veces que no es un fade — es movimiento, "como si
 * retrocediera el tiempo" del reparto. `applyEdgeAbsorption()` reutiliza
 * literalmente la misma curva de pose (offset/y/rotate/scale/opacity de
 * `setDealProgress`, misma `dealEase`), pero el progreso local ya no depende del
 * scroll ni de la distancia circular al índice principal (eso causaba un salto
 * discontinuo justo en el instante en que `getMainIndex()` cambia de tarjeta al
 * cruzar el borde) — depende de la PROXIMIDAD continua de cada ranura a su propio
 * borde (`edgeLocalP`, una función pura de `restX`, sin memoria ni dependencia de
 * qué tarjeta es "la principal" en ese instante). Así la tarjeta que sale por la
 * izquierda se retrae un `cardWidth` hacia su vecina de la derecha (se "mete
 * detrás", baja de zIndex, encoge, gira) TODAVÍA DENTRO del área visible —termina
 * absorbida (`localP=0`) justo cuando su borde izquierdo toca `x=0`, antes de que
 * el recorte por `overflow:hidden` la alcance—, y la que entra por la derecha hace
 * el gesto espejo (retraída `-cardWidth`, emergiendo a medida que `localP→1`). Se
 * llama solo desde `tick()` (bucle) y `step()` (flechas) — nunca coincide en el
 * tiempo con `setDealProgress` (el scrub del reparto solo corre con `playing===
 * false`, ver `wantsToPlay`/`cancelSettle` en Catalogo.astro), así que sigue sin
 * haber dos escritores compitiendo por el mismo transform (F1 intacto).
 */
import gsap from 'gsap';

export interface CarouselLoopHandle {
  play(): void;
  pause(): void;
  /** Avanza (1) o retrocede (-1) exactamente un ancho de tarjeta. */
  step(dir: 1 | -1, animate?: boolean): void;
  /** Recalcula anchos (llamar tras resize u orientationchange). */
  remeasure(): void;
  isPlaying(): boolean;
  /** true si el subconjunto actual (≤3 tarjetas) se muestra como fila estática sin bucle. */
  isStatic(): boolean;
  /**
   * Índice (dentro del array `slides` recibido) de la tarjeta con MENOR `x` en vivo
   * en este momento. D-D: nunca se asume 0, se mide la posición real de cada tarjeta.
   */
  getMainIndex(): number;
  /**
   * D-C: 0 = todas apiladas detrás de la principal (mismo lugar, con desfase/escala/
   * rotación); 1 = fila completamente repartida (posiciones de reposo). Solo
   * transform/opacity. Marca `inert` en las tarjetas aún no repartidas.
   */
  setDealProgress(p: number): void;
  destroy(): void;
}

export function createCarouselLoop(
  track: HTMLElement,
  slides: HTMLElement[],
  opts: { speed?: number; reduced?: boolean } = {},
): CarouselLoopHandle {
  const speed = opts.speed ?? 55; // px/s
  const reduced = !!opts.reduced;

  // F1: envoltorio interior de cada ranura — único nodo que el reparto puede tocar.
  // Fallback a la propia ranura si el marcado no lo trae (no debería pasar, pero
  // así ninguna llamada revienta si falta el wrapper).
  const inners = slides.map(
    (el) => el.querySelector<HTMLElement>('[data-carousel-slide-inner]') ?? el,
  );

  const state = { offset: 0 };
  let playing = false;
  let cardWidth = 0;
  let totalWidth = 0;
  let wrapFn = gsap.utils.wrap(0, 1);
  let stepTween: gsap.core.Tween | null = null;
  let staticMode = false;
  let staticStartX = 0;
  // F2b: ancho visible real del viewport (recortado por `overflow:hidden`), para
  // saber a qué distancia de CADA borde está una ranura. Ver `edgeLocalP`.
  let viewWidth = 0;
  // Compartida por `setDealProgress` (reparto) y `applyEdgeAbsorption` (bucle):
  // misma curva, un solo lugar donde se define.
  const dealEase = gsap.parseEase('power2.out');

  /**
   * F6 (2026-09-14 — "mini retroceso" al guardar/repartir, medido por el Tech
   * Lead con `salto2.mjs` con rueda real; el cliente lo describió después con
   * precisión: "cuando la carta está viniendo... me voy, como que se pone en
   * línea para ser guardada... lo hace de forma abrupta"). Dos causas
   * distintas, verificadas por separado con logs frame a frame (nunca
   * asumidas) y las dos corregidas aquí:
   *
   * F6-1: `setDealProgress`, al llegar a `localP=1` (revelado), forzaba SIEMPRE
   * un "puesto canónico" fijo (x=0/y=0/escala 1/opacidad 1), sin importar si
   * esa tarjeta estaba a medio absorber en el borde cuando el autoplay se
   * detuvo — el instante en que `pause()` engancha el reparto/guardado
   * reencuadraba de golpe cualquier tarjeta que no estuviera EXACTAMENTE en
   * reposo. Corrección: `pause()` toma un snapshot de la pose EN VIVO de cada
   * envoltorio interior (el último frame que escribió `applyEdgeAbsorption`,
   * misma `restX` — el offset del bucle no cambia mientras está en pausa) y
   * `setDealProgress` interpola SIEMPRE hacia/desde ESE snapshot (`dealFrom`)
   * en `localP=1`, nunca hacia un neutral fijo — así no hay reencuadre al
   * enganchar, sin importar cuántas veces se invierta la dirección dentro de
   * la misma sesión (una sola función continua de `localP`, reversible).
   *
   * F6-2 (la causa dominante de los saltos de 168-462px medidos): incluso con
   * el snapshot de arriba, el stagger (ver `start` en `setDealProgress`)
   * seguía saltando. La banda de wrap (`wrapFn`, en `measure()`) solo reserva
   * UN ancho de tarjeta de colchón por detrás de la principal — el resto del
   * mazo queda en cola hacia adelante, así que dos tarjetas con la MISMA
   * distancia circular (`dist`, F2a) pueden estar a distancias REALES muy
   * distintas de la principal (p.ej., con 7 tarjetas, `dist=2` agrupa una a
   * 752px y otra a 1880px). Ambas comparten la misma ventana de progreso
   * (`start`→1) para "volver" hacia la principal. Con el presupuesto de
   * stagger original (0.72) esa ventana se volvía angosta para las más
   * profundas — recorrer mucha distancia en poco progreso — y con scroll
   * lento eso se reparte en cientos de frames (invisible), pero con rueda
   * real rápida `scrub: 0.7` puede recorrer buena parte de esa ventana en un
   * puñado de frames: la fórmula sigue siendo matemáticamente continua
   * (verificado con logs frame a frame — nunca hay un valor que no siga la
   * curva), pero el desplazamiento POR FRAME se vuelve tan grande que se
   * percibe como un salto ("de forma abrupta", como lo describió el
   * cliente). Corrección: presupuesto de stagger reducido a 0.15 (ver
   * `start` más abajo) — cada tarjeta conserva la mayor parte del rango de
   * progreso para recorrer su distancia real, así que la velocidad por
   * frame queda acotada sin importar la velocidad del scroll. Medido con
   * `salto2.mjs` (rueda real, subiendo y bajando): 0 discontinuidades.
   */
  interface DealPose {
    x: number;
    y: number;
    rotate: number;
    scale: number;
    opacity: number;
  }
  let dealFrom: DealPose[] = [];
  const neutralPose: DealPose = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 };

  /**
   * F9 (2026-09-14 — "se sobrepone y desaparece", reportado por el cliente con
   * capturas consecutivas al 39%/38% de scroll subiendo: una tarjeta se dibuja
   * encima de la que está más a la izquierda y, en el frame siguiente, ya no
   * está). Causa raíz: había TRES sitios escribiendo `zIndex` y DOS de ellos lo
   * interpolaban (`gsap.utils.interpolate` + `Math.round`) — en `setDealProgress`
   * (línea ~493, interpolando entre el z canónico y el snapshot de la tarjeta
   * anterior) y en `applyEdgeAbsorption` (línea ~349, interpolando 1→n según
   * `localP`, IGNORANDO por completo la distancia real a la principal, así que
   * durante casi todo el bucle en reposo TODAS las tarjetas con `localP=1`
   * — incluida la principal — empataban en `zIndex=n`). `z-index` es un entero
   * discreto: interpolarlo entre dos enteros produce, a mitad de camino, un
   * valor redondeado que no corresponde al orden real ni al final ni al inicial
   * — la tarjeta cruza por encima de su vecina en el frame donde el redondeo
   * cae de un lado, y al frame siguiente el redondeo cae del otro y se reordena
   * de golpe: exactamente la "aparece encima / luego desaparece" del cliente.
   *
   * Corrección: el z-index deja de interpolarse en cualquier parte. Pasa a ser
   * una función DETERMINISTA de la distancia circular de cada ranura a la
   * principal (`circularDistance` + `zIndexFor`, únicas dos funciones que lo
   * deciden), llamada igual desde el reparto (`setDealProgress`), la absorción
   * de borde (`applyEdgeAbsorption`) y — nueva, antes no existía ninguna — el
   * bucle en reposo entre transiciones (misma llamada dentro de
   * `applyEdgeAbsorption`, que corre en cada `tick()`). La principal
   * (`dist=0`) recibe siempre `n`, estrictamente mayor que cualquier otra
   * (`n - dist`, `dist >= 1`): ninguna tarjeta puede cubrirla nunca, en ningún
   * frame. El resto decae con la distancia real (vecina inmediata justo detrás,
   * luego la siguiente), así que el orden entre tarjetas del MISMO lado nunca
   * empata ni se redondea — solo puede empatar con su espejo del lado opuesto
   * (misma distancia circular, pero nunca se solapan en pantalla porque están
   * en costados opuestos de la principal). El único momento en que el orden
   * cambia de verdad es cuando `getMainIndex()` cambia de tarjeta — eso solo
   * ocurre cuando la tarjeta que deja de ser principal ya cruzó `x<-0.5`
   * (colchón del wrap, recortada por `overflow:hidden`), nunca a la vista.
   *
   * F10 (2026-09-14 — "se sobrepone / desaparece" TODAVÍA presente con la fila en
   * reposo, medido por el Tech Lead con `zver.mjs`: la ranura de MENOR x renderizada
   * (72px) tenía z=6 mientras su vecina a la derecha (445px) tenía z=7 — la cubría).
   * F9 (arriba) arregló la interpolación, pero el criterio en sí seguía sin servir:
   * `zIndexFor(circularDistance(i, mainIdx, n), n)` ordenaba por distancia de ÍNDICE
   * a `getMainIndex()`. El cliente fue explícito: la que "absorbe a las otras" —la
   * que debe tener SIEMPRE el z-index máximo— es la de más a la izquierda del ÁREA,
   * medida por posición horizontal real, no por un ancla de índice.
   *
   * Corrección: el z-index pasa a ser el RANGO de cada ranura al ordenar TODAS por
   * su `restX` (la posición de reposo de la RANURA exterior — la misma que ya usa
   * `getMainIndex()`, así que la de menor `restX` visible siempre gana el rango 0 →
   * z máximo, sin depender de que la exclusión del colchón de wrap acierte con el
   * índice "correcto"). La de menor x recibe siempre `n`, la siguiente `n-1`, y así
   * sucesivamente — función de RANGOS sobre enteros, nunca interpolada, un solo
   * sitio (`applyZByRenderedX`), llamado desde `setDealProgress` y
   * `applyEdgeAbsorption` (los únicos dos que escriben z-index; nunca coinciden en
   * el tiempo, ver F1/F2b arriba).
   *
   * Deliberadamente NO se usa la x del ENVOLTORIO interior (la que sí incluye el
   * offset de la retracción de borde / el desfase del reparto): esa x es la que se
   * ve en pantalla, pero mientras una ranura se está absorbiendo se retrae HACIA
   * ADENTRO (hacia su vecina), cruzando temporalmente la x de esa vecina aunque
   * ninguna de las dos cambió de "quién es más a la izquierda" en términos de la
   * ranura de fondo — clasificar por esa x hace que el rango oscile entre ambas
   * varias veces por segundo (medido con `zorden.mjs`: 12 intercambios entre
   * tarjetas "visibles"). `restX` en cambio solo cambia de orden relativo entre dos
   * ranuras en el instante del wrap (`wrapFn`), que ocurre con la ranura saliente ya
   * a `x < -cardWidth`, bien fuera de cualquier zona visible — exactamente el único
   * momento en que el requisito 4 permite un cambio de orden.
   */
  function applyZByRenderedX(entries: { slideIdx: number; renderedX: number }[]) {
    const n = entries.length;
    const sorted = [...entries].sort((a, b) => a.renderedX - b.renderedX);
    sorted.forEach((entry, rank) => {
      gsap.set(slides[entry.slideIdx], { zIndex: n - rank });
    });
  }

  /** Único punto de escritura de la pose del envoltorio interior desde `setDealProgress`. */
  function setDealPose(
    slideIdx: number,
    vals: { x: number; y: number; rotate: number; scale: number; opacity: number },
  ) {
    gsap.set(inners[slideIdx], vals);
  }

  /**
   * El paso entre tarjetas (ancho + separación) vive en la variable CSS
   * `--slide-step` del track (ver Catalogo.astro): una sola fuente de verdad
   * compartida con el CSS que fija el ancho real de `.carousel-slide`, en vez
   * de medir `getBoundingClientRect` (los slides pasan a `position:absolute`
   * para el bucle, así que su posición en el DOM ya no sirve como medida).
   */
  function measure() {
    if (slides.length === 0) return;
    const raw = getComputedStyle(track).getPropertyValue('--slide-step').trim();
    const parsed = parseFloat(raw);
    cardWidth = Number.isFinite(parsed) && parsed > 0 ? parsed : slides[0].offsetWidth || 1;
    totalWidth = cardWidth * slides.length;
    // Banda de envoltura: un ancho de tarjeta de margen a cada lado del ciclo total.
    wrapFn = gsap.utils.wrap(-cardWidth, totalWidth - cardWidth);
    // F2b: ancho real recortado por el viewport (`.carousel-viewport`, padre
    // directo de `track` — ver Catalogo.astro). Con fallback a `totalWidth` para
    // que `edgeLocalP` nunca divida por algo absurdo antes de la primera medida.
    viewWidth = track.clientWidth || totalWidth;

    // D-B: 3 tarjetas o menos → fila estática centrada, sin bucle.
    staticMode = slides.length <= 3;
    if (staticMode) {
      playing = false;
      const gap = cardWidth - (slides[0].getBoundingClientRect().width || cardWidth);
      const cardVisualWidth = slides[0].getBoundingClientRect().width || cardWidth - Math.max(gap, 0);
      const contentWidth = slides.length * cardWidth - (cardWidth - cardVisualWidth || 0);
      const trackWidth = track.clientWidth || totalWidth;
      staticStartX = Math.max(0, (trackWidth - contentWidth) / 2);
    }
    apply();
  }

  /** Posición de reposo (bucle normal) de la tarjeta de índice lógico `i`. */
  function restXFor(i: number): number {
    if (staticMode) return staticStartX + i * cardWidth;
    return wrapFn(i * cardWidth + state.offset);
  }

  // F1: el bucle SOLO escribe `x` de la ranura exterior. Nunca toca y/scale/rotate/
  // opacity (eso es terreno exclusivo del envoltorio interior, ver setDealProgress).
  function apply() {
    slides.forEach((el, i) => {
      gsap.set(el, { x: restXFor(i) });
    });
  }

  /**
   * F2b: 1 = la ranura está cómodamente dentro del área visible (sin absorción);
   * 0 = su borde ya cruzó por completo el límite del viewport (absorción completa).
   * Función PURA de `restX` — sin estado, sin depender de qué tarjeta es "la
   * principal" en este instante — por eso no hay salto discontinuo al cruzar.
   *
   * F5 (2026-09-14 — regresión "la fila no se forma", diagnosticada por el Tech
   * Lead con `abs2.mjs`: la MISMA tarjeta medía escala/opacidad constantes, nunca
   * 1/1, en las 40 muestras): la versión anterior medía `distFromLeft`/
   * `distFromRight` (positivos = margen hacia ADENTRO desde cada borde) y
   * normalizaba esa distancia contra un `cardWidth` ENTERO — exigía que una
   * ranura estuviera a un `cardWidth` completo de cualquier borde para
   * considerarse "segura" (localP=1). Con solo ~3 tarjetas visibles en un
   * viewport de 1152px y un paso de 376px (`cardWidth` ≈ viewWidth/3), esa zona
   * "segura" combinada medía apenas ~12px de ancho: en la práctica NINGUNA
   * tarjeta llegaba nunca a localP=1 — el bucle escribía la pose de mazo
   * (`depth` fijo) sobre casi todas las tarjetas casi todo el tiempo, de ahí
   * la fila sin formar, los textos superpuestos y la escala/opacidad
   * constantes que reportó el Tech Lead.
   *
   * Corrección: `nearest` (distancia al borde más próximo) ahora puede ser
   * NEGATIVA — significa que la ranura ya empezó a solaparse con ese borde
   * (recortada por `overflow:hidden` en `.carousel-viewport`). Mientras
   * `nearest >= 0` (la ranura cabe entera dentro del viewport, sin tocar
   * ningún borde) → `localP = 1` SIEMPRE, sin excepción: es la fila en
   * reposo que exige el invariante, para cualquier tarjeta que no esté
   * tocando un borde, sin depender de cuántas tarjetas entren a la vez.
   * Solo cuando `nearest < 0` (la ranura ya está parcialmente recortada)
   * arranca la absorción/emergencia, progresiva sobre el siguiente
   * `cardWidth` de recorrido — todavía dentro del área visible (el recorte
   * de `overflow:hidden` recién empieza a comerse esa porción, pero el
   * gesto llega a `localP=0` bastante antes de que la ranura quede
   * totalmente fuera, así nunca se ve un corte duro).
   */
  function edgeLocalP(restX: number): number {
    if (cardWidth <= 0) return 1;
    const distFromLeft = restX;
    const distFromRight = viewWidth - cardWidth - restX;
    const nearest = Math.min(distFromLeft, distFromRight);
    if (nearest >= 0) return 1;
    return gsap.utils.clamp(0, 1, 1 + nearest / cardWidth);
  }

  /**
   * F2b: la absorción/emergencia del bucle continuo, reutilizando la MISMA pose
   * (offset relativo + y/rotate/scale/opacity) que `setDealProgress`, con
   * `edgeLocalP` en vez del progreso de scroll. `depth` fijo (no hace falta
   * distancia circular: como máximo una ranura por borde está a medio absorber
   * a la vez, dado el espaciado `cardWidth`).
   * Dirección del retroceso: la ranura que sale por la izquierda se desplaza
   * +cardWidth (se mete detrás de su vecina de la derecha, hacia el interior);
   * la que entra por la derecha, -cardWidth (misma magnitud, signo espejo — de
   * ahí que la simetría sea automática y no dos fórmulas a sincronizar a mano).
   * Solo se llama desde `tick()` (autoplay) y `step()` (flechas): ninguno de los
   * dos corre nunca al mismo tiempo que el scrub del reparto (ver comentario F2b
   * arriba), así que nunca compite con `setDealProgress` por el mismo transform.
   */
  function applyEdgeAbsorption() {
    if (staticMode || reduced) return;
    const depth = 3;
    const stackY = depth * 5;
    const stackRotate = depth * 1.6;
    const stackScale = 1 - depth * 0.025;
    const stackOpacity = Math.max(0.5, 1 - depth * 0.09);
    // F10: ya no hace falta `getMainIndex()` aquí — el z-index se decide por rango
    // de x renderizada real (ver `applyZByRenderedX`), recolectada abajo.
    const zEntries: { slideIdx: number; renderedX: number }[] = [];

    slides.forEach((outerEl, i) => {
      const innerEl = inners[i];
      const restX = restXFor(i);
      const distFromLeft = restX;
      const distFromRight = viewWidth - cardWidth - restX;
      const localP = dealEase(edgeLocalP(restX));
      const dirSign = distFromLeft <= distFromRight ? 1 : -1;
      // F7 (2026-09-14 — invariante roto ~1 de cada 4 corridas de `inv.mjs`,
      // preexistente, verificado que no lo tocó ninguno de los cambios de F6/
      // F6-2 arriba): con una ranura MÁS de un `cardWidth` fuera del viewport
      // (p.ej. la siguiente en la cola tras la que ya está saliendo),
      // `edgeLocalP` se queda clamped en 0 (correcto, sigue "totalmente
      // absorbida") pero el retroceso usaba una magnitud FIJA de `cardWidth` —
      // no crecía con el exceso real. Como `restX` sigue avanzando con el
      // bucle mientras el retroceso se queda fijo, la posición RENDERIZADA
      // (`restX + offsetX`) volvía a entrar al viewport arrastrando la pose de
      // "totalmente absorbida" (escala 0.93/opacidad 0.76) — una tarjeta
      // "fantasma" momentáneamente dentro del área. (Primer intento fallido:
      // dejar que el retroceso creciera SIN límite para anclar la posición
      // renderizada justo en el borde — eso apilaba a TODAS las ranuras
      // profundas exactamente en el mismo punto del borde, un defecto peor,
      // detectado con `inv_debug.mjs` viendo 3 tarjetas en el mismo x.)
      // Corrección real: el retroceso es una función "tienda de campaña" del
      // exceso — sube de 0 a `cardWidth` mientras `excess` va de 0 a
      // `cardWidth` (idéntico al comportamiento ya aprobado, sin cambios ahí),
      // y luego se LIBERA de vuelta a 0 durante el siguiente `cardWidth` de
      // exceso (`excess` de `cardWidth` a `2*cardWidth`): para entonces la
      // ranura ya está en o más allá del borde en su posición NATURAL (sin
      // retroceso), así que vuelve a quedar fuera de vista sin rebotar ni
      // apilarse con la siguiente de la cola.
      const excess = Math.max(0, -Math.min(distFromLeft, distFromRight));
      const retractAmount = Math.max(0, Math.min(cardWidth, 2 * cardWidth - excess));
      const offsetX = dirSign * retractAmount;
      const finalOffsetX = gsap.utils.interpolate(offsetX, 0, localP);

      gsap.set(innerEl, {
        x: finalOffsetX,
        y: gsap.utils.interpolate(stackY, 0, localP),
        rotate: gsap.utils.interpolate(stackRotate, 0, localP),
        scale: gsap.utils.interpolate(stackScale, 1, localP),
        opacity: gsap.utils.interpolate(stackOpacity, 1, localP),
      });
      // F10: se recolecta `restX` (la posición de reposo de la RANURA, no la del
      // envoltorio ya retraído) — el z-index se asigna después, por rango, para
      // las `n` ranuras a la vez (ver `applyZByRenderedX`).
      zEntries.push({ slideIdx: i, renderedX: restX });

      // Accesibilidad: misma convención que `setDealProgress` — mayormente
      // absorbida (localP bajo) no debe ser alcanzable por tabulación.
      if (localP > 0.5) outerEl.removeAttribute('inert');
      else outerEl.setAttribute('inert', '');
    });

    applyZByRenderedX(zEntries);
  }

  function tick(_time: number, deltaMs: number) {
    if (!playing || reduced || staticMode) return;
    state.offset -= speed * (deltaMs / 1000);
    apply();
    applyEdgeAbsorption();
  }

  gsap.ticker.add(tick);
  measure();

  function getMainIndex(): number {
    if (slides.length === 0) return 0;
    // Defecto (2026-09-13): `wrapFn` reserva un colchón de un `cardWidth` ANTES del
    // origen (rango [-cardWidth, totalWidth-cardWidth)) para que el bucle infinito
    // nunca se quede sin tarjeta al salir por la izquierda. Ese colchón hace que, en
    // reposo (offset=0), la ÚLTIMA tarjeta caiga justo en el borde superior del rango
    // y el wrap la envuelva a `x = -cardWidth` — una x MENOR que la de la tarjeta 0
    // (x=0), aunque esa última tarjeta es en realidad la reserva fuera de encuadre,
    // no la ranura frontal. Si se toma el mínimo global sin filtrar, D-D queda mal
    // aplicado: el mazo se apila detrás de una tarjeta que vive fuera del track.
    // Por eso se ignoran las x negativas (reserva del wrap) al buscar la "principal";
    // solo cuentan las ranuras dentro o en el borde del área visible (x >= 0).
    let bestI = 0;
    let bestX = Infinity;
    let fallbackI = 0;
    let fallbackX = Infinity;
    slides.forEach((el, i) => {
      const x = Number(gsap.getProperty(el, 'x')) || 0;
      if (x < fallbackX) {
        fallbackX = x;
        fallbackI = i;
      }
      if (x >= -0.5 && x < bestX) {
        bestX = x;
        bestI = i;
      }
    });
    // Si por algún estado transitorio ninguna tarjeta cae en la banda visible (no
    // debería ocurrir en la práctica), se cae de vuelta al mínimo global.
    return bestX === Infinity ? fallbackI : bestI;
  }

  function setDealProgress(p: number) {
    const n = slides.length;
    if (n === 0) return;
    const progress = gsap.utils.clamp(0, 1, p);
    const mainIdx = getMainIndex();
    const mainRestX = restXFor(mainIdx);
    // F2a (v6 — "se absorbe muy rápido" del lado izquierdo): antes el stagger
    // numeraba las tarjetas linealmente `k = (mainIdx+k) % n`, así que la tarjeta
    // que envuelve justo DETRÁS de la principal (la que, en reposo, queda pegada a
    // su izquierda, en la reserva del wrap) recibía el `k` más alto de todo el
    // mazo — arrancaba tardísimo en el stagger y tenía que recorrer la MISMA
    // distancia que su espejo de la derecha (k=1) en una ventana de progreso
    // mucho más corta: se veía "absorbida"/desaparecer de golpe, dejando el hueco
    // que reportó el cliente. La corrección NO es un mecanismo nuevo (nada de
    // máscaras ni de una animación de "absorción" aparte): es reconocer que el
    // reparto y el guardado son LA MISMA curva leída hacia adelante o hacia atrás,
    // y que esa curva debe ser simétrica respecto a la posición circular, no al
    // índice lineal. `maxDist` es la distancia circular máxima posible en el mazo.
    const maxDist = Math.max(1, Math.floor(n / 2));
    // F10: el z-index ya no se deriva de `dist`/`k` — se recolecta la x renderizada
    // real de cada ranura y se asigna por rango al final (ver `applyZByRenderedX`).
    const zEntries: { slideIdx: number; renderedX: number }[] = [];

    for (let k = 0; k < n; k++) {
      const slideIdx = (mainIdx + k) % n;
      const outerEl = slides[slideIdx];
      // Posición de reposo de ESTA ranura (la escribe el bucle en `outerEl.x`,
      // nunca aquí). El envoltorio interior solo necesita saber cuánto debe
      // OFFSETEARSE respecto a esa ranura — nunca la x absoluta del bucle.
      const restX = restXFor(slideIdx);

      if (k === 0) {
        // La principal no se mueve: ya está "en su misma posición" (D-C). El
        // envoltorio interior queda en offset 0 (coincide con la ranura).
        setDealPose(slideIdx, { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
        zEntries.push({ slideIdx, renderedX: restX });
        outerEl.removeAttribute('inert');
        continue;
      }

      // F2a: distancia CIRCULAR a la principal (por cualquiera de los dos lados
      // del mazo), no el índice lineal `k`. La vecina inmediata por la derecha
      // (k=1) y la vecina inmediata por la izquierda (k=n-1, la del wrap) caen
      // ambas en distancia 1 → mismo `depth`, misma ventana `start`: literalmente
      // la misma fórmula, imposible que se desincronicen entre sí.
      const dist = Math.min(k, n - k);

      // Stagger: la tarjeta a distancia `dist` empieza a repartirse cuando el
      // progreso global supera `start`, y termina en p=1. Las más profundas del
      // mazo arrancan más tarde (y por eso mismo, al revertir, "se guardan" antes).
      // F6-2: presupuesto reducido a 0.15 (antes 0.72) — con solo un colchón de
      // wrap de un `cardWidth`, una tarjeta de `dist` alto puede tener que
      // recorrer varios anchos de tarjeta reales; un presupuesto grande le deja
      // una ventana angosta para eso y con rueda real rápida el desplazamiento
      // por frame se vuelve un salto perceptible aunque la fórmula sea continua
      // (ver comentario junto a `dealFrom`). Con 0.15 cada tarjeta conserva ≥85%
      // del rango de progreso para su propio recorrido.
      const start = ((dist - 1) / maxDist) * 0.15;
      const localRaw = gsap.utils.clamp(0, 1, (progress - start) / (1 - start));
      const localP = dealEase(localRaw);

      // Pose apilada: desfase/escala/rotación que insinúan el mazo detrás de la
      // principal, con profundidad acotada para que el mazo no se disperse demasiado.
      // `stackXAbs` es la x ABSOLUTA de la pose apilada (igual que en v5); como el
      // envoltorio interior no vive en coordenadas absolutas, se expresa como el
      // offset relativo a la ranura de esta misma tarjeta (`restX`), que llega a
      // exactamente 0 cuando el reparto termina (localP=1).
      const depth = Math.min(dist, 5);
      // F2a: el "asomo" de profundidad (`depth*6`) se orienta hacia el lado en el
      // que esta tarjeta vive de verdad (a la derecha o a la izquierda de la
      // principal), no siempre hacia +x. Sin esto, la vecina que envuelve por la
      // izquierda quedaba con una magnitud de offset ligeramente distinta a su
      // espejo de la derecha (mismo `depth`, pero la pose apilada caía del lado
      // equivocado de su propio reposo) — la simetría debe ser exacta, no aproximada.
      const dirSign = restX >= mainRestX ? 1 : -1;
      const stackXAbs = mainRestX + dirSign * depth * 6;
      const canonicalOffsetX = stackXAbs - restX;
      const canonicalY = depth * 5;
      const canonicalRotate = depth * 1.6;
      const canonicalScale = 1 - depth * 0.025;
      const canonicalOpacity = Math.max(0.5, 1 - depth * 0.09);

      // F6: el extremo "revelado" (`localP=1`) de la interpolación ya no es un
      // neutral fijo — es el snapshot en vivo tomado por `pause()`. El extremo
      // "apilado" (`localP=0`) sigue siendo el puesto canónico de siempre (el
      // look de mazo aprobado no cambia). Ver comentario junto a `dealFrom`.
      const from = dealFrom[slideIdx] ?? neutralPose;

      const finalOffsetX = gsap.utils.interpolate(canonicalOffsetX, from.x, localP);
      setDealPose(slideIdx, {
        x: finalOffsetX,
        y: gsap.utils.interpolate(canonicalY, from.y, localP),
        rotate: gsap.utils.interpolate(canonicalRotate, from.rotate, localP),
        scale: gsap.utils.interpolate(canonicalScale, from.scale, localP),
        opacity: gsap.utils.interpolate(canonicalOpacity, from.opacity, localP),
      });
      // F10: el z-index no se interpola nunca — se recolecta `restX` (la posición
      // de reposo de la RANURA, no la del envoltorio ya desplazado por el reparto)
      // y se asigna por rango al terminar el bucle, junto a la de la principal y
      // todas las demás. Ver comentario junto a `applyZByRenderedX` sobre por qué
      // NO se usa la x ya offseteada del envoltorio.
      zEntries.push({ slideIdx, renderedX: restX });

      // Accesibilidad: una tarjeta que todavía está mayormente escondida en el
      // mazo no debe ser alcanzable por tabulación.
      if (localP > 0.5) outerEl.removeAttribute('inert');
      else outerEl.setAttribute('inert', '');
    }

    applyZByRenderedX(zEntries);
  }

  return {
    play() {
      if (reduced || staticMode) return;
      playing = true;
    },
    pause() {
      // F6: capturar la pose EN VIVO justo en la transición reproduciendo→
      // pausado (nunca en llamadas redundantes con `playing` ya en false) —
      // es el último frame que escribió `applyEdgeAbsorption`, la fuente de
      // verdad desde la que `setDealProgress` interpola a partir de ahora.
      if (playing) {
        // F9: ya no se captura `zIndex` aquí — el z-index nunca se interpola,
        // así que no necesita snapshot (a diferencia de x/y/rotate/scale/
        // opacity, que sí siguen interpolando desde esta pose en vivo).
        dealFrom = slides.map((_outerEl, i) => ({
          x: Number(gsap.getProperty(inners[i], 'x')) || 0,
          y: Number(gsap.getProperty(inners[i], 'y')) || 0,
          rotate: Number(gsap.getProperty(inners[i], 'rotate')) || 0,
          scale: Number(gsap.getProperty(inners[i], 'scale')) || 1,
          opacity: (() => {
            const v = Number(gsap.getProperty(inners[i], 'opacity'));
            return Number.isFinite(v) ? v : 1;
          })(),
        }));
      }
      playing = false;
    },
    step(dir, animate = true) {
      if (staticMode) return;
      const wasPlaying = playing;
      playing = false;
      stepTween?.kill();
      const proxy = { o: state.offset };
      const target = state.offset - dir * cardWidth;
      if (!animate || reduced) {
        state.offset = target;
        apply();
        applyEdgeAbsorption();
        if (wasPlaying) playing = true;
        return;
      }
      stepTween = gsap.to(proxy, {
        o: target,
        duration: 0.5,
        ease: 'power2.inOut',
        onUpdate: () => {
          state.offset = proxy.o;
          apply();
          applyEdgeAbsorption();
        },
        onComplete: () => {
          if (wasPlaying) playing = true;
        },
      });
    },
    remeasure: measure,
    isPlaying: () => playing,
    isStatic: () => staticMode,
    getMainIndex,
    setDealProgress,
    destroy() {
      gsap.ticker.remove(tick);
      stepTween?.kill();
    },
  };
}
