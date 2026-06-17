import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold text-foreground">Selamat datang</h1>
        <p className="text-sm text-muted">Masuk ke akun ReLoop Anda</p>
      </div>
      <AuthForm mode="login" />
    </div>
  );
}
