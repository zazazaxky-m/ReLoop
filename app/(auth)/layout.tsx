import Link from "next/link";
import { Recycle } from "@/components/ui/icons";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 via-mint-soft to-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-xl text-white">
            <Recycle />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold text-foreground">ReLoop</p>
            <p className="text-xs font-medium text-muted">
              Smart Waste Bank Pangandaran
            </p>
          </div>
        </Link>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
