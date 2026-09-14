/**
 * Formulario de cotización (sección `cotiza-ahora`). Isla React.
 * Copy exacto de `_brief/01-contenido-y-estructura.md` sección E: labels, placeholders,
 * textos de error y mensaje de éxito. Sin backend: al validar en cliente, muestra el estado
 * de éxito y abre WhatsApp (o el cliente de correo) con el mensaje/asunto prellenado.
 */
import { useState } from 'react';
import productosData from '../../data/productos.json';
import contacto from '../../data/contacto.json';
import { buildWhatsAppLink, buildContextMessage } from './whatsapp';

interface Producto {
  nombre: string;
}

const productos = productosData as Producto[];

const OPCION_ASESORIA = 'No estoy seguro / quiero asesoría';

interface FormState {
  nombre: string;
  empresa: string;
  whatsapp: string;
  correo: string;
  lineaProducto: string;
  medidaCantidad: string;
  distritoCiudad: string;
}

const initialState: FormState = {
  nombre: '',
  empresa: '',
  whatsapp: '',
  correo: '',
  lineaProducto: '',
  medidaCantidad: '',
  distritoCiudad: '',
};

type Errors = Partial<Record<keyof FormState, string>>;

// Texto de error de envío reservado para cuando exista backend real:
// 'No pudimos enviar tu solicitud. Intenta de nuevo o escríbenos directo por WhatsApp.'

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (!form.nombre.trim()) {
    errors.nombre = 'Ingresa tu nombre para poder contactarte.';
  }
  const soloDigitos = form.whatsapp.replace(/\D/g, '');
  if (!soloDigitos || soloDigitos.length !== 9) {
    errors.whatsapp = 'Ingresa un WhatsApp válido (9 dígitos).';
  }
  if (!form.lineaProducto) {
    errors.lineaProducto = 'Selecciona la línea de producto que te interesa.';
  }
  if (!form.medidaCantidad.trim()) {
    errors.medidaCantidad = 'Cuéntanos brevemente qué necesitas (medida, cantidad o proyecto).';
  }
  return errors;
}

// Sin backend, el formulario NO recibe nada: solo abre el canal con el mensaje prellenado.
// El texto debe decir exactamente eso — prometer un acuse de recibo o un plazo de respuesta
// sería un compromiso de servicio que el sitio no puede cumplir.
const MENSAJE_EXITO: Record<'whatsapp' | 'correo', string> = {
  whatsapp:
    'Listo. Abrimos WhatsApp con tu solicitud ya redactada — solo envíala para que llegue a nuestro equipo.',
  correo:
    'Listo. Abrimos tu correo con la solicitud ya redactada — solo envíala para que llegue a nuestro equipo.',
};

const inputClass =
  'w-full rounded-xl bg-ink-800 border text-paper text-body px-4 py-3.5 placeholder:text-paper-faint ' +
  'focus:outline-none focus:ring-2 transition-colors duration-150';

function fieldBorder(hasError: boolean) {
  return hasError
    ? 'border-error focus:border-error focus:ring-error/30'
    : 'border-ink-600 focus:border-orange focus:ring-orange/30';
}

export default function QuoteForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Errors>({});
  const [success, setSuccess] = useState<'whatsapp' | 'correo' | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.SyntheticEvent, canal: 'whatsapp' | 'correo') {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Sin esto, un usuario de lector de pantalla no se entera de que el envío falló.
      const ORDEN: Array<keyof Errors> = ['nombre', 'whatsapp', 'lineaProducto', 'medidaCantidad'];
      const ID: Record<string, string> = {
        nombre: 'qf-nombre',
        whatsapp: 'qf-whatsapp',
        lineaProducto: 'qf-linea',
        medidaCantidad: 'qf-medida',
      };
      const primero = ORDEN.find((k) => nextErrors[k]);
      if (primero) document.getElementById(ID[primero])?.focus();
      return;
    }

    // TODO backend: aquí iría el POST real a la API de cotizaciones
    // (guardar lead en CRM/base de datos, notificar a ventas, etc.).
    // Por ahora, sin backend: se abre el canal elegido con el mensaje prellenado.

    const lineaProducto = form.lineaProducto === OPCION_ASESORIA ? OPCION_ASESORIA : form.lineaProducto;

    if (canal === 'whatsapp') {
      const mensaje = buildContextMessage({
        lineaProducto,
        medida: form.medidaCantidad,
        distritoCiudad: form.distritoCiudad,
      });
      window.open(buildWhatsAppLink(contacto.whatsapp, mensaje), '_blank', 'noopener,noreferrer');
    } else {
      const asunto = encodeURIComponent(`Cotización — ${lineaProducto}`);
      const cuerpo = encodeURIComponent(
        [
          `Nombre: ${form.nombre}`,
          form.empresa && `Empresa u obra: ${form.empresa}`,
          `WhatsApp: ${form.whatsapp}`,
          `Línea de producto: ${lineaProducto}`,
          `Medida y cantidad: ${form.medidaCantidad}`,
          form.distritoCiudad && `Distrito o ciudad: ${form.distritoCiudad}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      window.location.href = `mailto:${contacto.correo}?subject=${asunto}&body=${cuerpo}`;
    }

    setSuccess(canal);
  }

  if (success) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-success/40 bg-ink-800/80 backdrop-blur-sm p-6 text-body text-paper"
      >
        <p className="label-tec text-success mb-2">Solicitud lista para enviar</p>
        <p>{MENSAJE_EXITO[success]}</p>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => handleSubmit(e, 'whatsapp')}
      className="flex flex-col gap-5 rounded-2xl border border-white/8 bg-ink-800/80 backdrop-blur-sm p-6 sm:p-8"
    >
      <div>
        <label htmlFor="qf-nombre" className="label-tec text-paper-dim block mb-2">
          Nombre completo
        </label>
        <input
          id="qf-nombre"
          name="nombre"
          type="text"
          placeholder="Ej. Juan Pérez"
          value={form.nombre}
          onChange={(e) => update('nombre', e.target.value)}
          aria-invalid={Boolean(errors.nombre)}
          aria-describedby={errors.nombre ? 'qf-nombre-error' : undefined}
          className={`${inputClass} ${fieldBorder(Boolean(errors.nombre))}`}
        />
        {errors.nombre && (
          <p id="qf-nombre-error" role="alert" className="mt-1.5 text-caption text-error">
            {errors.nombre}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="qf-empresa" className="label-tec text-paper-dim block mb-2">
          Empresa u obra (opcional)
        </label>
        <input
          id="qf-empresa"
          name="empresa"
          type="text"
          placeholder="Ej. Constructora / obra en construcción"
          value={form.empresa}
          onChange={(e) => update('empresa', e.target.value)}
          className={`${inputClass} ${fieldBorder(false)}`}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="qf-whatsapp" className="label-tec text-paper-dim block mb-2">
            Tu WhatsApp
          </label>
          <input
            id="qf-whatsapp"
            name="whatsapp"
            type="tel"
            inputMode="numeric"
            placeholder="Ej. 987 654 321"
            value={form.whatsapp}
            onChange={(e) => update('whatsapp', e.target.value)}
            aria-invalid={Boolean(errors.whatsapp)}
            aria-describedby={errors.whatsapp ? 'qf-whatsapp-error' : undefined}
            className={`${inputClass} ${fieldBorder(Boolean(errors.whatsapp))}`}
          />
          {errors.whatsapp && (
            <p id="qf-whatsapp-error" role="alert" className="mt-1.5 text-caption text-error">
              {errors.whatsapp}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="qf-correo" className="label-tec text-paper-dim block mb-2">
            Correo (opcional)
          </label>
          <input
            id="qf-correo"
            name="correo"
            type="email"
            placeholder="tucorreo@ejemplo.com"
            value={form.correo}
            onChange={(e) => update('correo', e.target.value)}
            className={`${inputClass} ${fieldBorder(false)}`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="qf-linea" className="label-tec text-paper-dim block mb-2">
          ¿Qué producto necesitas?
        </label>
        <select
          id="qf-linea"
          name="lineaProducto"
          value={form.lineaProducto}
          onChange={(e) => update('lineaProducto', e.target.value)}
          aria-invalid={Boolean(errors.lineaProducto)}
          aria-describedby={errors.lineaProducto ? 'qf-linea-error' : undefined}
          className={`${inputClass} ${fieldBorder(Boolean(errors.lineaProducto))} appearance-none`}
        >
          <option value="" disabled>
            Selecciona una línea
          </option>
          {productos.map((p) => (
            <option key={p.nombre} value={p.nombre}>
              {p.nombre}
            </option>
          ))}
          <option value={OPCION_ASESORIA}>{OPCION_ASESORIA}</option>
        </select>
        {errors.lineaProducto && (
          <p id="qf-linea-error" role="alert" className="mt-1.5 text-caption text-error">
            {errors.lineaProducto}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="qf-medida" className="label-tec text-paper-dim block mb-2">
          Medida y cantidad aproximada
        </label>
        <textarea
          id="qf-medida"
          name="medidaCantidad"
          rows={3}
          placeholder="Ej. 20 planchas TR4 de 3 metros"
          value={form.medidaCantidad}
          onChange={(e) => update('medidaCantidad', e.target.value)}
          aria-invalid={Boolean(errors.medidaCantidad)}
          aria-describedby={errors.medidaCantidad ? 'qf-medida-error' : undefined}
          className={`${inputClass} ${fieldBorder(Boolean(errors.medidaCantidad))} resize-none`}
        />
        {errors.medidaCantidad && (
          <p id="qf-medida-error" role="alert" className="mt-1.5 text-caption text-error">
            {errors.medidaCantidad}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="qf-distrito" className="label-tec text-paper-dim block mb-2">
          Distrito o ciudad de la obra (opcional)
        </label>
        <input
          id="qf-distrito"
          name="distritoCiudad"
          type="text"
          placeholder="Ej. Los Olivos, Lima"
          value={form.distritoCiudad}
          onChange={(e) => update('distritoCiudad', e.target.value)}
          className={`${inputClass} ${fieldBorder(false)}`}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mt-2">
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-orange text-ink-950
                     font-display font-semibold text-body px-7 py-3.5 hover:bg-orange-dim active:scale-95
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper
                     transition-all duration-150 shadow-[0_8px_24px_rgba(249,86,1,0.35)]"
        >
          Enviar y cotizar por WhatsApp
        </button>
        <button
          type="button"
          onClick={(e) => handleSubmit(e, 'correo')}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 text-paper
                     font-display font-medium text-body px-7 py-3.5 hover:border-orange hover:text-orange
                     focus-visible:outline-2 focus-visible:outline-orange transition-all duration-150"
        >
          Prefiero que me escriban por correo
        </button>
      </div>
    </form>
  );
}
