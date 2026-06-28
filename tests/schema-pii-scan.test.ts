import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guard: every free-text (String) field on the PII-concentration table (Worker)
// must be CONSCIOUSLY classified as "pii" or "non-pii". Adding a new String field
// to Worker without classifying it here fails CI — a reminder to update the GDPR
// export/anonymization inventory accordingly.
const WORKER_FIELD_CLASSIFICATION: Record<string, "pii" | "non-pii"> = {
  id: "non-pii",
  tenantId: "non-pii",
  employeeNo: "pii",
  firstName: "pii",
  lastName: "pii",
  email: "pii",
  department: "non-pii",
  jobTitle: "non-pii",
  status: "non-pii",
};

const schema = readFileSync(
  fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

function workerStringFields(): string[] {
  const block = schema.match(/model Worker \{([\s\S]*?)\n\}/);
  if (!block) throw new Error("Worker model not found in schema.prisma");
  const fields: string[] = [];
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(\w+)\s+String\b/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

describe("PII classification scan (Worker)", () => {
  it("classifies every String field on Worker", () => {
    const fields = workerStringFields();
    expect(fields.length).toBeGreaterThan(0);
    const unclassified = fields.filter((f) => !(f in WORKER_FIELD_CLASSIFICATION));
    expect(
      unclassified,
      `Unclassified Worker String field(s): ${unclassified.join(", ")}. ` +
        `Add them to WORKER_FIELD_CLASSIFICATION and the GDPR export/anonymization inventory.`,
    ).toEqual([]);
  });
});
