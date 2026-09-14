// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages sirve el proyecto en aynitek.github.io/mathen-lp/
  site: 'https://aynitek.github.io',
  base: '/mathen-lp/',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Vite descubre estas dependencias tarde (los plugins de GSAP y el stack 3D se
      // importan desde islas y scripts de sección), y re-optimizaba en caliente:
      // eso devolvía 504 "Outdated Optimize Dep" y dejaba las islas sin hidratar.
      // Declararlas aquí las pre-empaqueta al arrancar.
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'three',
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
        'postprocessing',
        'maath',
        'lenis',
        'gsap',
        'gsap/ScrollTrigger',
        'gsap/SplitText',
        'gsap/Observer',
        'gsap/DrawSVGPlugin',
        'gsap/Flip',
      ],
    },
  },
});
