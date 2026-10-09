import { ImageResponse } from "next/og";

export const alt = "MINDTRAP · EXPERIMENT 001: THE INEVITABLE";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// English-only on purpose: the default OG font has no Hebrew glyphs. Never reveals the prediction.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(ellipse at top, #16303a 0%, #0B101B 60%)",
          color: "#F4F7FB",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, letterSpacing: 8, color: "#AAB6C8" }}>
          <span>MINDTRAP</span>
          <span style={{ color: "#A3F2E1" }}>CLASSIFIED</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span style={{ fontSize: 30, letterSpacing: 10, color: "#AAB6C8" }}>EXPERIMENT 001</span>
          <span style={{ fontSize: 96, fontWeight: 700, letterSpacing: 4 }}>THE INEVITABLE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span
            style={{
              border: "3px solid #A3F2E1",
              color: "#A3F2E1",
              padding: "10px 22px",
              borderRadius: 8,
              fontSize: 26,
              letterSpacing: 6,
            }}
          >
            PREDICTION SEALED
          </span>
          <span style={{ fontSize: 26, color: "#AAB6C8" }}>4 decisions · 1 prediction</span>
        </div>
      </div>
    ),
    size,
  );
}
