/**
 * Tipos do MCP do plugin. As tools agora são DEFINIÇÕES puras criadas com
 * `defineTool` (ver ./define.ts) e registradas a partir de um array — alinhado
 * à direção do PR #26603 (`ai.mcp.defineTool`). Re-exportamos os tipos de
 * `./define` aqui por conveniência/compatibilidade.
 */
export type {
  McpToolDef,
  McpResourceDef,
  McpPromptDef,
  McpToolResult,
  McpAuth,
  RegisterTool,
} from './define';
