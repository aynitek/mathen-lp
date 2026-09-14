/**
 * Red de seguridad: si WebGL falla al inicializar (contexto no disponible,
 * shader que no compila en un driver raro, etc.) el canvas decorativo no
 * debe tumbar la página. Se traga el error, lo loguea y no renderiza nada
 * — el HTML de las secciones sigue funcionando sin el fondo 3D.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn('[three] Fondo 3D deshabilitado tras un error de render:', error);
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
