/**
 * Registra as tools de conteúdo do plugin no MCP server NATIVO da Strapi
 * (>= 5.47.0). Cada tool é uma DEFINIÇÃO pura (`defineTool`, em ./tools/*),
 * agregada em ./tools/index.ts; aqui só percorremos o array chamando
 * `mcp.registerTool(def)` (padrão "define + register-from-array").
 *
 * Alinhado à direção do PR #26603 (`ai.mcp.defineTool`): quando o helper
 * estável sair, troca-se o import de `./define` por `import { ai } from
 * "@strapi/strapi"` — as definições não mudam. Ver server/src/mcp/define.ts.
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
  for (const tool of tools) mcp.registerTool(tool);
  strapi.log.info(`[mcp-chat] ${tools.length} tools registradas no MCP nativo (mcp_chat_*).`);
};
