import { registerMcpTools } from './mcp';

/**
 * register() do plugin: estende o MCP nativo da Strapi registrando as tools
 * de conteúdo. Precisa rodar antes de o MCP server iniciar (ordem de boot:
 * register → bootstrap → MCP start).
 */
export default ({ strapi }: { strapi: any }) => {
  registerMcpTools(strapi);
};
