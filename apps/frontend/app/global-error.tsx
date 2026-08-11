"use client";

import { useEffect } from "react";

/**
 * Last-resort error screen: rendered when even the root layout fails, so it
 * must carry its own <html>/<body> and inline styles — global.css is not
 * guaranteed to be present here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root error:", error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#f5f5f7", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 380, textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                margin: "0 auto 24px",
                borderRadius: "50%",
                background: "#e8e8ed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              <span role="img" aria-label="erreur">⚠️</span>
            </div>
            <h1 style={{ fontSize: 20, color: "#1d1d1f", margin: 0 }}>
              Le serveur ne répond pas
            </h1>
            <p style={{ fontSize: 14, color: "#6e6e73", lineHeight: 1.6, margin: "8px 0 28px" }}>
              Le service est momentanément indisponible. Veuillez réessayer
              dans quelques instants.
            </p>
            <button
              onClick={reset}
              style={{
                background: "#0071e3",
                color: "#fff",
                border: "none",
                borderRadius: 980,
                padding: "12px 28px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
