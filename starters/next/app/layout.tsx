import type { Metadata } from "next";
import { Suspense } from "react";
import PreviewBridge from "@/app/_components/PreviewBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loja Exemplo",
  description: "Starter Next.js para o plugin strapi-mcp-chat",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {/* PreviewBridge usa useSearchParams, por isso fica dentro de Suspense. */}
        <Suspense fallback={null}>
          <PreviewBridge />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
