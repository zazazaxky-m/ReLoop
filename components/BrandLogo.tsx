/* eslint-disable @next/next/no-img-element -- Static SVGs gain nothing from
   next/image, and its inline `style="color:transparent"` is blocked by our CSP. */
import { cn } from "@/lib/cn";

type BrandLogoProps = {
  variant?: "wordmark" | "mark";
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  alt?: string;
};

export function BrandLogo({
  variant = "wordmark",
  width,
  height,
  className,
  priority = false,
  alt = "ReLoop",
}: BrandLogoProps) {
  const shared = {
    alt,
    width,
    height,
    decoding: "async" as const,
    loading: priority ? ("eager" as const) : ("lazy" as const),
    fetchPriority: priority ? ("high" as const) : undefined,
  };

  if (variant === "mark") {
    return <img src="/reloop-logo.svg" className={className} {...shared} />;
  }

  // The wordmark's dark-green "Re" disappears on dark surfaces, so swap in a
  // light-lettered copy with the class-based dark variant.
  return (
    <>
      <img
        src="/reloop-logo-name.svg"
        className={cn(className, "dark:hidden")}
        {...shared}
      />
      <img
        src="/reloop-logo-name-dark.svg"
        className={cn(className, "hidden dark:inline")}
        {...shared}
      />
    </>
  );
}
