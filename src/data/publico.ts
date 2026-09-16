/**
 * Punto de paso ÚNICO entre los datos de trabajo y lo que se publica.
 *
 * `productos.json` y `contacto.json` llevan anotaciones internas del tipo
 * `[[DATO PENDIENTE: ...]]` para marcar lo que falta confirmar con el cliente. Son notas
 * para nosotros, no texto para el visitante: se estaban imprimiendo tal cual en la página
 * publicada — seis veces, tres de ellas dentro de fichas técnicas de producto, donde
 * cualquier cliente las leía.
 *
 * Los datos de origen NO se tocan: la nota sigue ahí para que se vea qué falta confirmar.
 * Lo que cambia es que al publicar se sustituye por un texto neutro.
 *
 * Toda sección debe importar los datos DESDE AQUÍ, nunca del .json directamente.
 */
import productosCrudo from './productos.json';
import contactoCrudo from './contacto.json';

const MARCA = /\s*\[\[DATO PENDIENTE:[^\]]*\]\]/g;
const SIN_CONFIRMAR = 'Por confirmar';

function limpiarTexto(t: string): string {
  if (!t.includes('[[DATO PENDIENTE')) return t;
  const resto = t.replace(MARCA, '').trim();
  // Si la nota ERA todo el contenido, no queda nada que enseñar: marcador neutro.
  return resto.length > 0 ? resto : SIN_CONFIRMAR;
}

function limpiar<T>(v: T): T {
  if (typeof v === 'string') return limpiarTexto(v) as unknown as T;
  if (Array.isArray(v)) return v.map(limpiar) as unknown as T;
  if (v && typeof v === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, valor] of Object.entries(v as Record<string, unknown>)) salida[k] = limpiar(valor);
    return salida as T;
  }
  return v;
}

export const productos = limpiar(productosCrudo);
export const contacto = limpiar(contactoCrudo);
export default { productos, contacto };
