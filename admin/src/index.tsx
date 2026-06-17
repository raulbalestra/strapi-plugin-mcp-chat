import { createRoot } from 'react-dom/client';
import { PLUGIN_ID } from './pluginId';
import { AdminOverlays } from './components/AdminOverlays';
import { ErrorBoundary } from './components/ErrorBoundary';

// Flag de módulo: trava extra contra duplo-mount (além do guard por id no DOM).
let mounted = false;

/** Limpa estilos inline que o PreviewPanel possa ter deixado no #strapi caso uma
 *  sessão anterior tenha sido encerrada de forma abrupta — garante que o admin
 *  nunca apareça encolhido/quebrado ao carregar. */
const resetStrapiRootStyles = () => {
  try {
    const root = document.getElementById('strapi') as HTMLElement | null;
    if (!root) return;
    for (const p of ['width', 'maxWidth', 'transform', 'overflow'] as const) {
      root.style[p] = '';
    }
  } catch {
    /* noop */
  }
};

const PluginIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1Z"
      fill="currentColor"
    />
  </svg>
);

export default {
  register(app: any) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: 'MCP Chat' },
      Component: async () => {
        const { App } = await import('./pages/App');
        return App;
      },
    });

    app.registerPlugin({
      id: PLUGIN_ID,
      name: PLUGIN_ID,
    });
  },

  bootstrap() {
    // Chat flutuante GLOBAL (presente em todas as telas do admin).
    //
    // Nota de conformidade: as injection zones documentadas do Strapi 5 são
    // específicas do Content Manager (ex.: editView/right-links) — não há uma
    // zona oficial para um overlay global em todo o admin. Portanto montamos um
    // React root próprio, de forma isolada e idempotente (guardado por id, sem
    // tocar na árvore do admin). É o único desvio das APIs documentadas e está
    // contido a este único ponto. `register()` acima usa só APIs oficiais
    // (addMenuLink + registerPlugin).
    // Guarda de ambiente: só roda no browser (nunca em SSR/headless sem DOM).
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const ID = 'mcp-chat-fab-root';
    if (mounted || document.getElementById(ID)) return;
    mounted = true;
    try {
      resetStrapiRootStyles();
      const el = document.createElement('div');
      el.id = ID;
      document.body.appendChild(el);
      // ErrorBoundary garante que um erro de render do overlay nunca derrube o admin.
      createRoot(el).render(
        <ErrorBoundary>
          <AdminOverlays />
        </ErrorBoundary>
      );
    } catch (e) {
      // Em último caso, falhar em montar o overlay não pode quebrar o admin.
      // eslint-disable-next-line no-console
      console.error('[mcp-chat] falha ao montar overlays (admin segue normal):', e);
    }
  },
};
