import type { Viewport } from "next";
import type { ReactNode } from "react";

// The old browser chrome green; the root layout's other viewport fields still apply.
export const viewport: Viewport = { themeColor: "#16a34a" };

// The kiosk keeps its pre-editorial look; see app/legacy-theme.css.
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <div className="legacy-theme">{children}</div>;
}
