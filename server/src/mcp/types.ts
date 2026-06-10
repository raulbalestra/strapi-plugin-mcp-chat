/**
 * Tipos para os módulos de tool do MCP (padrão inspirado no exemplo do Paul
 * Bratslavsky: github.com/PaulBratslavsky/strapi-mcp-demo-and-tool-extension).
 * Cada tool é um módulo com um `register(registerTool, strapi)`.
 */

export type RegisterTool = (toolDef: Record<string, any>) => void;

export type StrapiMcpToolModule = {
  register: (registerTool: RegisterTool, strapi: any) => void;
};
