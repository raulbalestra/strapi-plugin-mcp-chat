/**
 * Registra as tools de conteúdo do plugin no MCP server NATIVO da Strapi
 * (>= 5.47.0). Estrutura modular inspirada no padrão do exemplo do Paul
 * Bratslavsky: cada tool é um módulo em ./tools/*, agregado em ./tools/index.ts,
 * e aqui passamos por um loop chamando `tool.register(registerTool, strapi)`.
 *
 * Deve rodar no `register()` do plugin, ANTES de o MCP server iniciar.
 */
import { tools } from './tools';

export const registerMcpTools = (strapi: any) => {
  const mcp = strapi?.ai?.mcp;
  const enabled = typeof mcp?.isEnabled === 'function' ? mcp.isEnabled() : !!mcp?.registerTool;
  if (!mcp || typeof mcp.registerTool !== 'function' || !enabled) {
    strapi.log.warn(
      '[mcp-chat] MCP nativo indisponível/desligado — tools NÃO registradas. ' +
        'Requer Strapi >= 5.47.0 com `mcp: { enabled: true }` em config/server.'
    );
    return;
  }
  const { registerTool } = mcp;
  for (const tool of tools) tool.register(registerTool, strapi);
  strapi.log.info(`[mcp-chat] ${tools.length} tools registradas no MCP nativo (mcp_chat_*).`);
};
