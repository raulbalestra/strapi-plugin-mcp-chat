/**
 * Cliente MCP minimalista (HTTP streamable). Por padrão fala com o endpoint do
 * @sensinum/strapi-plugin-mcp da própria instância Strapi, mas aceita qualquer
 * URL no construtor — usado também para o Playwright MCP (controle de browser).
 *
 * O endpoint responde em formato SSE (linhas "data: {json}"), então fazemos
 * o parse manual e mantemos o mcp-session-id entre as chamadas.
 */

const MCP_URL =
  process.env.MCP_URL || 'http://localhost:1337/api/mcp/streamable';

const baseHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
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
  /** Nome amigável (aparece nos logs). */
  readonly name: string;

  /**
   * @param url  endpoint MCP streamable. Default: o MCP da própria Strapi.
   * @param name rótulo p/ logs (ex.: 'strapi', 'playwright').
   */
  constructor(url: string = MCP_URL, name = 'strapi') {
    this.url = url;
    this.name = name;
  }

  private headers() {
    const h: Record<string, string> = { ...baseHeaders };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  async init(): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: baseHeaders,
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
    await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }

  private async rpc(method: string, params: any, id: number): Promise<any> {
    const res = await fetch(this.url, {
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
