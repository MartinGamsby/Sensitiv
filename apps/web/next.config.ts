import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo policy: "lint never blocks a build in v1". `pnpm lint` runs ESLint
  // separately with the flat config at the repo root.
  eslint: { ignoreDuringBuilds: true },
  // packages/shared and packages/db ship TypeScript source with no build step.
  transpilePackages: ["@sensitiv/shared", "@sensitiv/db"],
  // Keep the libsql client (native bindings + dynamic requires) out of the
  // webpack server bundle — it is loaded via Node's require at runtime instead.
  serverExternalPackages: [
    "@libsql/client",
    "@libsql/isomorphic-fetch",
    "@libsql/isomorphic-ws",
    "@libsql/hrana-client",
    "libsql",
  ],
  webpack: (config, { isServer }) => {
    // `@sensitiv/db` (transpiled, no build step) uses
    // `new URL("../migrations", import.meta.url)` to locate runtime assets.
    // Stop webpack from trying to resolve those string literals as modules.
    config.module = config.module ?? {};
    config.module.parser = {
      ...config.module.parser,
      javascript: {
        ...(config.module.parser?.javascript ?? {}),
        url: false,
      },
    };

    if (isServer) {
      // The route handlers reach `@libsql/*` through `@sensitiv/db`
      // (transpiled). Force those native/dynamic-require modules to stay
      // external so webpack never tries to parse their package READMEs.
      const externals = [
        "libsql",
        "@libsql/client",
        "@libsql/isomorphic-fetch",
        "@libsql/isomorphic-ws",
        "@libsql/hrana-client",
      ];
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
        ({ request }: { request?: string }, cb: (err?: null, result?: string) => void) =>
          request && externals.some((e) => request === e || request.startsWith(`${e}/`))
            ? cb(null, `commonjs ${request}`)
            : cb(),
      ];
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
