import type { ReactNode } from "react";

// The machine display keeps its pre-editorial look; see app/legacy-theme.css.
export default function MachineDisplayLayout({ children }: { children: ReactNode }) {
  return <div className="legacy-theme">{children}</div>;
}
