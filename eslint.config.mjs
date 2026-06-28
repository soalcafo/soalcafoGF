import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // GUARDRAIL (Phase 0): the raw Prisma client must only be touched inside the
      // DB access layer. Everywhere else, code MUST go through forTenant()/asFacility()
      // from "@/lib/db" so the tenant-isolation RLS GUC is always set. This is the
      // load-bearing rule that prevents accidental cross-tenant data access.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db/client",
              message:
                "Do not import the raw Prisma client. Use forTenant()/asFacility() from '@/lib/db' so tenant isolation (RLS GUC) is always applied.",
            },
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "Instantiate PrismaClient only in lib/db/client.ts. Use the scoped helpers from '@/lib/db' elsewhere.",
            },
          ],
        },
      ],
    },
  },
  {
    // The DB layer, Prisma tooling, tests and scripts are allowed to touch the raw client.
    files: ["lib/db/**", "prisma/**", "tests/**", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
