import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "ReLoop — Setor sampah, dapat reward";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Rendered once at build time, so these files only need to exist in the
// build context. next/og cannot read WOFF2, hence the separate WOFF copies.
async function loadAssets() {
  const root = process.cwd();
  const [medium, extraBold, icon] = await Promise.all([
    readFile(join(root, "assets/og-fonts/PlusJakartaSans-Medium.woff")),
    readFile(join(root, "assets/og-fonts/PlusJakartaSans-ExtraBold.woff")),
    readFile(join(root, "app/icon.svg")),
  ]);
  return {
    medium,
    extraBold,
    iconSrc: `data:image/svg+xml;base64,${icon.toString("base64")}`,
  };
}

export default async function OpengraphImage() {
  const { medium, extraBold, iconSrc } = await loadAssets();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#022c22",
          color: "#ffffff",
          fontFamily: "Plus Jakarta Sans",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -140,
            top: -160,
            width: 520,
            height: 520,
            borderRadius: 9999,
            border: "90px solid #bef264",
            display: "flex",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img src={iconSrc} width={54} height={51} alt="" />
          </div>
          ReLoop
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -2,
            }}
          >
            Sampah selesai.
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -2,
              color: "#4ade80",
            }}
          >
            Dampak dimulai.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 32,
              fontWeight: 500,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            Setor sampah di mesin ReLoop, dapat poin, cairkan ke e-wallet.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Plus Jakarta Sans", data: medium, weight: 500, style: "normal" },
        { name: "Plus Jakarta Sans", data: extraBold, weight: 800, style: "normal" },
      ],
    },
  );
}
