import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Permite carregar imagens hospedadas pelo Strapi (uploads).
    // Em produção, ajuste/adicione o host real do seu Strapi.
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "1337",
        pathname: "/uploads/**",
      },
    ],
  },
};

export default nextConfig;
