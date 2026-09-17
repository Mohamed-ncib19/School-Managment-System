import { normName, validateImportedRows } from "../imports.service";
import type { ParsedRow } from "../import.types";

const baseRow = (overrides: Partial<ParsedRow> = {}): ParsedRow => ({
  rowNumber: 2,
  level: "Level 1",
  field: "Languages",
  professor: "Ahmed Bensalem",
  professorPhone: "0555123456",
  group: "Group A",
  firstName: "Yasmine",
  lastName: "Haddad",
  phone: "0661234567",
  parentPhone: null,
  email: null,
  enrollmentDate: new Date("2025-09-01T00:00:00Z"),
  monthlyFee: 3000,
  status: "active",
  ...overrides,
});

describe("normName", () => {
  it("folds case and surrounding whitespace (Math == math)", () => {
    expect(normName("  MATH ")).toBe(normName("math"));
  });

  it("folds French diacritics", () => {
    expect(normName("Mélanie")).toBe("melanie");
    expect(normName("HADDAD")).toBe("haddad");
  });

  it("collapses inner whitespace", () => {
    expect(normName("Group  A")).toBe("group a");
  });
});

describe("validateImportedRows", () => {
  it("accepts a clean row unchanged", () => {
    const { problems, clean } = validateImportedRows([baseRow()]);
    expect(problems).toEqual([]);
    expect(clean).toHaveLength(1);
  });

  it("accepts JSON-round-tripped rows (ISO date strings, numeric strings)", () => {
    const json = JSON.parse(
      JSON.stringify([baseRow()]),
    ) as ParsedRow[];
    const { problems, clean } = validateImportedRows(json);
    expect(problems).toEqual([]);
    expect(clean[0].enrollmentDate).toBeInstanceOf(Date);
    expect(clean[0].monthlyFee).toBe(3000);
  });

  it("rejects rows with missing required values", () => {
    const { problems, clean } = validateImportedRows([
      baseRow({ firstName: "   " }),
    ]);
    expect(clean).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/firstName/);
  });

  it("rejects non-numeric fees instead of coercing to 0", () => {
    const { problems, clean } = validateImportedRows([
      baseRow({ monthlyFee: Number("abc") }),
    ]);
    expect(clean).toHaveLength(0);
    expect(problems[0].message).toMatch(/monthlyFee/);
  });

  it("rejects unparseable enrollment dates", () => {
    const { problems, clean } = validateImportedRows([
      baseRow({ enrollmentDate: "not a date" as unknown as Date }),
    ]);
    expect(clean).toHaveLength(0);
    expect(problems[0].message).toMatch(/enrollmentDate/);
  });

  it("rejects unknown statuses", () => {
    const { problems, clean } = validateImportedRows([
      baseRow({ status: "archived" as never }),
    ]);
    expect(clean).toHaveLength(0);
    expect(problems[0].message).toMatch(/status/);
  });

  it("keeps validating the remaining rows after a bad one", () => {
    const { problems, clean } = validateImportedRows([
      baseRow({ lastName: "" }),
      baseRow({ firstName: "Karim" }),
    ]);
    expect(clean).toHaveLength(1);
    expect(problems).toHaveLength(1);
  });
});
