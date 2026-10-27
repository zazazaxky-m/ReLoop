import type { ReactNode } from "react";

// Print pages keep their pre-editorial look; see app/legacy-theme.css.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="legacy-theme">{children}</div>;
}
