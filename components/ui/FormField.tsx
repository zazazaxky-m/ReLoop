import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";
import { ChevronDown } from "./icons";

const controlBase =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:cursor-not-allowed disabled:opacity-60";

const selectBase =
  "peer w-full appearance-none rounded-xl border border-border bg-surface text-foreground shadow-sm outline-none transition-[background-color,border-color,box-shadow] hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-muted disabled:opacity-70";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  compact?: boolean;
};

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlBase, "min-h-[90px] resize-y", className)}
      {...props}
    />
  );
}

export function Select({ className, children, compact, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          selectBase,
          compact
            ? "min-h-10 px-3 py-2 pr-10 text-sm font-medium leading-5"
            : "min-h-11 px-3.5 py-2.5 pr-11 text-sm leading-5",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted transition-colors peer-focus:text-brand-600 peer-disabled:text-muted-soft">
        <ChevronDown className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </span>
    </div>
  );
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  error?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-status-error"> *</span> : null}
        </Label>
      ) : null}
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
    </div>
  );
}
