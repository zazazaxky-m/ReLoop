"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/cn";
import { Sun, Moon } from "@/components/ui/icons";

interface Props {
  className?: string;
}

export function ThemeToggle({ className }: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
      title={isDark ? "Mode terang" : "Mode gelap"}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-soft text-muted shadow-sm transition-colors hover:bg-surface hover:text-brand-700 dark:hover:bg-surface dark:hover:text-brand-400",
        className,
      )}
    >
      {mounted ? (
        isDark ? (
          <Sun className="text-lg" />
        ) : (
          <Moon className="text-lg" />
        )
      ) : (
        <span className="block h-4 w-4" />
      )}
    </button>
  );
}
