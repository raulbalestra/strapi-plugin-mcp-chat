import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

/**
 * Rota de entrada do Preview / Draft Mode.
 *
 * O admin do Strapi gera URLs no formato:
 *   /api/preview?secret=<PREVIEW_SECRET>&status=draft&path=/produtos/<slug>
 *
 * Aqui validamos o segredo, ativamos o Draft Mode e redirecionamos para
 * o `path` solicitado. Com o Draft Mode ligado, os server components passam
 * a buscar conteúdo em rascunho (status=draft).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const path = searchParams.get("path") || "/";

  // Valida o segredo contra a env server-only.
  if (!secret || secret !== process.env.PREVIEW_SECRET) {
    return new Response("Segredo de preview inválido", { status: 401 });
  }

  // Ativa o Draft Mode (cookie definido pelo Next).
  (await draftMode()).enable();

  // Garante que só redirecionamos para caminhos internos.
  const safePath = path.startsWith("/") ? path : `/${path}`;
  redirect(safePath);
}
