/**
 * Resuelve rutas de assets respetando el `base` de Astro.
 * En GitHub Pages el sitio no vive en la raíz del dominio sino en /mathen-lp/,
 * así que una ruta absoluta como "/img/logo.png" daría 404. Este helper antepone
 * `import.meta.env.BASE_URL` para que funcione igual en local y en Pages.
 */
export const asset = (ruta: string): string =>
  `${import.meta.env.BASE_URL}${ruta.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');
