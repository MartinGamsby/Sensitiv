import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

export default createMiddleware(routing);

export const config = {
  // Run on everything EXCEPT `/api`, Next internals, and files with an
  // extension. Excluding `/api` is mandatory — otherwise every API call is
  // rewritten to `/en/api/...` and 404s.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
