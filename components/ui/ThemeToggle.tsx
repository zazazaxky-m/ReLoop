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
  const label = mounted
    ? isDark
      ? "Aktifkan mode terang"
      : "Aktifkan mode gelap"
    : "Ubah mode tema";
  const title = mounted ? (isDark ? "Mode terang" : "Mode gelap") : "Tema";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={title}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
