"use client";

// Last resort: catches errors thrown by the root layout itself, where app/error.tsx
// cannot render because its layout is the thing that failed. It must ship its own
// <html>/<body> and cannot rely on the app's stylesheet.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf9f7",
          color: "#1a1a1a",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "38ch", textAlign: "center" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 500, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#5a5a5a", marginTop: "8px" }}>
            The application failed to start rendering.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "11px", fontFamily: "ui-monospace, monospace", color: "#8a8a8a" }}>
              ref {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              padding: "8px 16px",
              borderRadius: "999px",
              border: "none",
              background: "#1a1a1a",
              color: "#faf9f7",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
