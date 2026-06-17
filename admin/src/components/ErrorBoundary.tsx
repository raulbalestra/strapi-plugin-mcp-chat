/**
 * Error boundary que ISOLA as sobreposições do plugin (chat + preview) do resto
 * do admin do Strapi. Se algo dentro renderizar com erro, capturamos aqui e
 * renderizamos `null` — o overlay some, mas o admin do Strapi continua intacto.
 * Sem isto, um erro de render num root React próprio poderia quebrar a página.
 */
import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Apenas loga; nunca propaga para o admin.
    // eslint-disable-next-line no-console
    console.error('[mcp-chat] overlay desativado após erro de render:', error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
