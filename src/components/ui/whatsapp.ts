/**
 * Helpers para armar enlaces wa.me con el mensaje prellenado.
 * Plantillas literales de `_brief/01-contenido-y-estructura.md`, sección E.
 * Sin backend: el envío real ocurre abriendo WhatsApp con el texto ya escrito.
 */

export const WHATSAPP_GENERIC_MESSAGE =
  'Hola Mathen Perú, quiero cotizar un producto de su catálogo. ¿Me ayudan con disponibilidad y medida?';

export interface CotizacionContexto {
  lineaProducto?: string;
  medida?: string;
  cantidad?: string;
  distritoCiudad?: string;
}

/** Arma el mensaje con contexto de producto; las líneas vacías se omiten. */
export function buildContextMessage(ctx: CotizacionContexto): string {
  const lineas: string[] = [];
  if (ctx.lineaProducto) {
    lineas.push(`Hola Mathen Perú, quiero cotizar ${ctx.lineaProducto}.`);
  } else {
    lineas.push('Hola Mathen Perú, quiero cotizar un producto de su catálogo.');
  }
  if (ctx.medida) lineas.push(`Medida aproximada: ${ctx.medida}.`);
  if (ctx.cantidad) lineas.push(`Cantidad: ${ctx.cantidad}.`);
  if (ctx.distritoCiudad) lineas.push(`Mi proyecto es en ${ctx.distritoCiudad}.`);
  return lineas.join('\n');
}

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
