"use client";

import { useRef } from "react";
import { Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { StudentPayment } from "@/types";

interface PaymentReceiptProps {
  payment: StudentPayment;
  studentName: string;
  groupName: string;
  fieldName: string;
}

export function PaymentReceipt({ payment, studentName, groupName, fieldName }: PaymentReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = receiptRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Payment Receipt - ${studentName}</title>
          <style>
            @page { size: A4; margin: 20mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1a1a1a; }
            .receipt { max-width: 700px; margin: 0 auto; }
            .header { text-align: center; border-bottom: 3px solid #0284c7; padding-bottom: 20px; margin-bottom: 24px; }
            .header h1 { font-size: 28px; color: #0284c7; margin-bottom: 4px; }
            .header p { font-size: 13px; color: #666; }
            .receipt-title { text-align: center; font-size: 18px; font-weight: 700; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 1px; color: #333; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
            .info-item { display: flex; flex-direction: column; }
            .info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 2px; }
            .info-value { font-size: 14px; font-weight: 600; color: #1a1a1a; }
            .divider { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
            .amounts { background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
            .amounts h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 12px; }
            .amount-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
            .amount-row:last-child { border-bottom: none; }
            .amount-label { font-size: 13px; color: #555; }
            .amount-value { font-size: 14px; font-weight: 600; }
            .amount-value.paid { color: #16a34a; }
            .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 2px solid #e5e7eb; }
            .footer p { font-size: 11px; color: #999; }
            .signature-area { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; }
            .signature-box { text-align: center; }
            .signature-line { border-top: 1px solid #999; margin-top: 40px; padding-top: 8px; font-size: 12px; color: #666; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          ${content.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <>
      <button
        type="button"
        onClick={handlePrint}
        className="btn btn-secondary text-xs"
      >
        <Printer size={14} aria-hidden="true" />
      </button>

      <div ref={receiptRef} style={{ display: "none" }}>
        <div className="receipt">
          <div className="header">
            <h1>IQ Academy</h1>
            <p>Payment Receipt</p>
          </div>

          <div className="receipt-title">Quittance de Paiement</div>

          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Student Name</span>
              <span className="info-value">{studentName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Field</span>
              <span className="info-value">{fieldName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Group</span>
              <span className="info-value">{groupName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Payment Period</span>
              <span className="info-value">{payment.period}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Due Date</span>
              <span className="info-value">{formatDate(payment.due_date)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Payment Date</span>
              <span className="info-value">{payment.paid_at ? formatDate(payment.paid_at) : "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Payment Method</span>
              <span className="info-value">{payment.payment_method ?? "Cash"}</span>
            </div>
          </div>

          <div className="amounts">
            <h3>Payment Details</h3>
            <div className="amount-row">
              <span className="amount-label">Amount Due</span>
              <span className="amount-value">{formatCurrency(payment.amount_due)}</span>
            </div>
            <div className="amount-row">
              <span className="amount-label">Amount Paid</span>
              <span className="amount-value paid">{payment.paid_amount ? formatCurrency(payment.paid_amount) : "—"}</span>
            </div>
            {payment.paid_amount && payment.paid_amount < payment.amount_due && (
              <div className="amount-row">
                <span className="amount-label">Remaining Balance</span>
                <span className="amount-value" style={{ color: "#dc2626" }}>
                  {formatCurrency(payment.amount_due - payment.paid_amount)}
                </span>
              </div>
            )}
          </div>

          {payment.notes && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "#888", marginBottom: 4 }}>Notes</p>
              <p style={{ fontSize: 13, color: "#555" }}>{payment.notes}</p>
            </div>
          )}

          <div className="signature-area">
            <div className="signature-box">
              <div className="signature-line">Student Signature</div>
            </div>
            <div className="signature-box">
              <div className="signature-line">Administrator Signature</div>
            </div>
          </div>

          <div className="footer">
            <p>IQ Academy — Receipt generated on {formatDate(new Date())}</p>
          </div>
        </div>
      </div>
    </>
  );
}
