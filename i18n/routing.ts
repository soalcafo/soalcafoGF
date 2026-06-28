import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["pt-PT", "en"],
  defaultLocale: "pt-PT",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
