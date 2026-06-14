import { registerMcpTools } from './mcp';

/**
 * register() do plugin: estende o MCP nativo da Strapi registrando as tools
 * de conteúdo. Precisa rodar antes de o MCP server iniciar (ordem de boot:
 * register → bootstrap → MCP start).
 */
export default ({ strapi }: { strapi: any }) => {
  // Blindado: a API do MCP nativo ainda evolui entre versões da Strapi. Uma
  // mudança de assinatura aqui NÃO pode derrubar o boot do plugin (a provisão de
  // frontend não depende do MCP). Se falhar, só avisamos.
  try {
    registerMcpTools(strapi);
  } catch (e: any) {
    strapi.log.warn(`[mcp-chat] registro do MCP falhou (seguindo sem ele): ${e?.message ?? e}`);
  }
};
