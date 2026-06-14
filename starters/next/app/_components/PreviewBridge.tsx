"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Ponte de preview entre o frontend e o admin do Strapi.
 *
 * Só atua quando a página está sendo exibida dentro de um iframe
 * (window.parent !== window), como acontece no painel de Preview do Strapi.
 *
 * Responsabilidades:
 *  (a) avisar a janela pai da URL atual via postMessage, no mount e a cada
 *      navegação, para manter o admin sincronizado;
 *  (b) preservar a posição de scroll por pathname usando sessionStorage,
 *      evitando que recarregamentos do preview "pulem" para o topo.
 */
export default function PreviewBridge() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Não está dentro de um iframe -> não faz nada.
    const inIframe = window.parent !== window;
    if (!inIframe) return;

    // (a) Notifica o admin sobre a localização atual.
    window.parent.postMessage(
      { type: "preview:location", url: location.href },
      "*",
    );

    // (b) Restaura o scroll salvo para este pathname.
    const storageKey = `preview:scroll:${pathname}`;
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const y = Number(saved);
      if (!Number.isNaN(y)) {
        // requestAnimationFrame garante que o layout já foi pintado.
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    }

    // Salva o scroll continuamente para o pathname atual.
    const onScroll = () => {
      sessionStorage.setItem(storageKey, String(window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
    // Reexecuta a cada mudança de rota (pathname/searchParams).
  }, [pathname, searchParams]);

  return null;
}
