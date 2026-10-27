import type { ReactNode } from "react";

// The kiosk keeps its pre-editorial look; see app/legacy-theme.css.
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <div className="legacy-theme">{children}</div>;
}
