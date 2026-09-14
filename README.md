# Mathen Perú — Landing page

Sitio de una sola página para **Mathen Perú**, fabricante de calaminas, planchas Aluzinc,
paneles sándwich, placa colaborante, policarbonato y coberturas UPVC.

Desarrollado por **AYNI**.

## Concepto

Recorrido inmersivo por una nave industrial construida con los productos del cliente.
El scroll guía una cámara 3D a través de ocho escenas: exterior → material → sistema →
catálogo → fabricación a medida → equipo → planta → cotización.

## Stack

- **Astro** — estructura y generación estática
- **React** — islas interactivas
- **Three.js / React Three Fiber** — escena 3D, geometría generada por código (sin modelos externos)
- **GSAP + ScrollTrigger** — animación atada al scroll
- **Lenis** — scroll suave
- **Tailwind CSS** — estilos

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:4321
npm run build   # genera dist/
```

## Despliegue

Publicado en GitHub Pages mediante GitHub Actions (`.github/workflows/deploy.yml`).
Cada push a `main` reconstruye y despliega.

El sitio se sirve bajo una subruta, por eso `astro.config.mjs` define `base`. Las rutas de
assets se resuelven con el helper `src/lib/asset.ts`; **no uses rutas absolutas directas**
como `/img/...` o se romperán en producción.

## Pendientes antes de publicar como sitio definitivo

- [ ] Datos de contacto reales de Mathen en `src/data/contacto.json`; poner `datosVerificados: true`
      para que teléfono y correo entren al JSON-LD.
- [ ] **Confirmar el ancho útil de la calamina**: la ficha original dice "1000 cm", que es
      imposible. Publicado como 1000 mm y marcado como pendiente.
- [ ] Fotos de planta y obra en alta resolución.
- [ ] Dominio propio y actualización de `site` / `base`.

## Imágenes

Las fotos de producto son de referencia (Pexels, licencia de uso comercial libre) y están
acreditadas en `public/img/productos/CREDITOS.txt`. Las de la galería son del cliente.
