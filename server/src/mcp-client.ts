/**
 * Cliente MCP minimalista (HTTP streamable). Por padrão fala com o MCP server
 * NATIVO da Strapi (endpoint /mcp, requer admin token), mas aceita qualquer URL
 * e token no construtor — usado também para o Playwright MCP (controle de browser).
 *
 * O endpoint responde em formato SSE (linhas "data: {json}"), então fazemos
 * o parse manual e mantemos o mcp-session-id entre as chamadas.
 */

const MCP_URL = process.env.MCP_URL || 'http://localhost:1337/mcp';

const baseHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

/** fetch com timeout (AbortController) — nenhum endpoint MCP pode pendurar uma
 *  request do Strapi indefinidamente. */
const fetchT = async (url: string, opts: any, timeoutMs = 8000): Promise<Response> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

const parseSse = (text: string): any => {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  const last = dataLines[dataLines.length - 1];
  return last ? JSON.parse(last) : null;
};

export class McpClient {
  private sessionId?: string;
  private url: string;
  private token?: string;
  /** Nome amigável (aparece nos logs). */
  readonly name: string;

  /**
   * @param url   endpoint MCP streamable. Default: o /mcp nativo da Strapi.
   * @param name  rótulo p/ logs (ex.: 'strapi', 'playwright').
   * @param token Bearer token (admin token, exigido pelo /mcp nativo).
   */
  constructor(url: string = MCP_URL, name = 'strapi', token?: string) {
    this.url = url;
    this.name = name;
    this.token = token;
  }

  private headers() {
    const h: Record<string, string> = { ...baseHeaders };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  async init(): Promise<void> {
    const res = await fetchT(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-chat-plugin', version: '0.1.0' },
        },
      }),
    });
    this.sessionId = res.headers.get('mcp-session-id') || undefined;
    await res.text();
    // Notifica que o handshake terminou (sem corpo de resposta relevante).
    await fetchT(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }

  private async rpc(method: string, params: any, id: number): Promise<any> {
    const res = await fetchT(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const json = parseSse(await res.text());
    if (json?.error) throw new Error(json.error.message || 'Erro MCP');
    return json?.result;
  }

  async listTools(): Promise<any[]> {
    const result = await this.rpc('tools/list', {}, 2);
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    return this.rpc('tools/call', { name, arguments: args || {} }, 3);
  }
}
