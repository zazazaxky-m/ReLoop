import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Daftar" };

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold text-foreground">Buat akun baru</h1>
        <p className="text-sm text-muted">
          Daftar sebagai pengguna untuk mulai setor sampah
        </p>
      </div>
      <AuthForm mode="register" />
    </div>
  );
}
