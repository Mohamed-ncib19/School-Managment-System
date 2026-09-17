import { money } from "../money.util";
import { deriveInvoiceStatus } from "../payment-status.util";

const DAY_MS = 24 * 60 * 60 * 1000;

const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const plusDays = (n: number) => new Date(today().getTime() + n * DAY_MS);

describe("deriveInvoiceStatus", () => {
  it("marks a fully collected invoice paid", () => {
    expect(deriveInvoiceStatus(money(3000), money(3000), plusDays(10), 2)).toBe("paid");
  });

  it("keeps a partially collected invoice partially_paid past its due date", () => {
    expect(deriveInvoiceStatus(money(1000), money(3000), plusDays(-5), 2)).toBe("partially_paid");
  });

  it("marks an invoice due tomorrow due_soon inside the window", () => {
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(1), 2)).toBe("due_soon");
  });

  it("marks an invoice due exactly at the window edge due_soon", () => {
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(2), 2)).toBe("due_soon");
  });

  it("marks an invoice due today not_paid (window starts strictly after today)", () => {
    expect(deriveInvoiceStatus(money(0), money(3000), today(), 2)).toBe("not_paid");
  });

  it("marks an invoice past the window not_paid, never overdue", () => {
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(3), 2)).toBe("not_paid");
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(-1), 2)).toBe("not_paid");
  });

  it("honours the configured window length", () => {
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(5), 5)).toBe("due_soon");
    expect(deriveInvoiceStatus(money(0), money(3000), plusDays(6), 5)).toBe("not_paid");
  });

  it("never marks a zero-due invoice paid", () => {
    expect(deriveInvoiceStatus(money(0), money(0), plusDays(10), 2)).toBe("not_paid");
  });
});
