import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing.ts";

// Locale-aware wrappers around next/navigation. `Link`, `useRouter().push(...)`
// etc. keep the active locale prefix without the caller spelling it out.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
