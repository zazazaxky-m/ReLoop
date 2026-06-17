import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm",
  secondary: "bg-mint text-brand-700 hover:bg-brand-100",
  outline:
    "border border-border bg-surface text-foreground hover:bg-brand-50 hover:border-brand-300",
  ghost: "text-foreground hover:bg-brand-50",
  danger: "bg-status-error text-white hover:opacity-90 shadow-sm",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(
    "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
