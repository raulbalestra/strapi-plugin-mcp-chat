/**
 * Identity functions para DEFINIR capacidades MCP (tools/resources/prompts) com
 * inferência de tipos, desacopladas do registro — espelhando a direção do PR
 * #26603 do Strapi (`ai.mcp.defineTool` / `defineResource` / `definePrompt` +
 * o namespace `import { ai } from "@strapi/strapi"`).
 *
 * Hoje o MCP nativo (Strapi >= 5.47) expõe `strapi.ai.mcp.registerTool`. Estes
 * wrappers locais dão a inferência dos `args` do handler a partir do schema de
 * input AGORA (acaba com o `any`), e mantêm cada tool como uma DEFINIÇÃO pura,
 * registrada a partir de um array (sem side-effects na definição). Quando o
 * `ai.mcp.defineTool` estável sair, migrar é trocar o import destes helpers por
 * `import { ai } from "@strapi/strapi"` — as definições não mudam.
 *
 * Nota (decisão consciente): NÃO dependemos do build experimental do PR (a API
 * ainda está em debate — namespace global vs DI, `@strapi/ai` como pacote
 * próprio, etc.). Ficamos prontos-pra-migrar em vez de acoplados ao instável.
 */
import type { z } from '@strapi/utils';

/** Resultado padrão de um handler de tool MCP. */
export type McpToolResult = {
  content: Array<{ type: string; text?: string; [k: string]: any }>;
  structuredContent?: any;
};

/** Autorização declarativa (mesma forma aceita pelo MCP nativo). */
export type McpAuth = { policies?: Array<{ action: string; [k: string]: any }> };

/** Definição de uma tool MCP, com `args` do handler inferidos do input schema. */
export type McpToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  title?: string;
  description?: string;
  resolveInputSchema: () => S;
  resolveOutputSchema?: () => z.ZodTypeAny;
  auth?: McpAuth;
  createHandler: (
    strapi: any
  ) => (ctx: { args: z.infer<S> }) => Promise<McpToolResult> | McpToolResult;
};

/**
 * Identity function: devolve a definição inalterada, mas infere o genérico `S`
 * do `resolveInputSchema`, tipando `ctx.args` no handler (sem `any`).
 */
export const defineTool = <S extends z.ZodTypeAny>(def: McpToolDef<S>): McpToolDef<S> => def;

// ── Resources / Prompts (alinhamento completo com o PR; ainda não usados) ──────
export type McpResourceDef = {
  name: string;
  uri: string;
  title?: string;
  description?: string;
  mimeType?: string;
  devModeOnly?: boolean;
  auth?: McpAuth;
  createHandler: (strapi: any) => (ctx: any) => Promise<any> | any;
};
export const defineResource = (def: McpResourceDef): McpResourceDef => def;

export type McpPromptDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  title?: string;
  description?: string;
  resolveArgsSchema?: () => S;
  devModeOnly?: boolean;
  createHandler: (strapi: any) => (ctx: { args: z.infer<S> }) => Promise<any> | any;
};
export const definePrompt = <S extends z.ZodTypeAny>(def: McpPromptDef<S>): McpPromptDef<S> => def;

/** Assinatura do `registerTool` do MCP nativo (aceita uma McpToolDef). */
export type RegisterTool = (def: McpToolDef<any>) => void;
