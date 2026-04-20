// next-intl navigation utilities — use these instead of next/navigation
// so that locale switching and routing works correctly with localePrefix: "as-needed"
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, useRouter, usePathname, getPathname } =
  createNavigation(routing);
