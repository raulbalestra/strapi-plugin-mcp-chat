import { createRoot } from 'react-dom/client';
import { PLUGIN_ID } from './pluginId';
import { AdminOverlays } from './components/AdminOverlays';

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
    const ID = 'mcp-chat-fab-root';
    if (document.getElementById(ID)) return;
    const el = document.createElement('div');
    el.id = ID;
    document.body.appendChild(el);
    createRoot(el).render(<AdminOverlays />);
  },
};
