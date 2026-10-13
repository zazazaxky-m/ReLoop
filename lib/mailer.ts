import { auditTransportSink, captureTransport } from "./test-transport";

export interface SendEmailResult {
  sent: boolean;
  provider: "resend" | "log" | "none" | "test-capture";
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

function buildPasswordResetContent(resetUrl: string) {
  const text = [
    "Anda menerima email ini karena ada permintaan reset kata sandi untuk akun ReLoop Anda.",
    "",
    `Buka tautan berikut untuk membuat kata sandi baru (berlaku singkat):`,
    resetUrl,
    "",
    "Jika Anda tidak meminta reset, abaikan email ini.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="id">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <p>Anda menerima email ini karena ada permintaan reset kata sandi untuk akun ReLoop Anda.</p>
  <p><a href="${resetUrl}">Reset kata sandi</a></p>
  <p style="color:#64748b;font-size:14px">Jika Anda tidak meminta reset, abaikan email ini.</p>
</body>
</html>`;

  return { text, html };
}

interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Indonesian noun phrase used in logs and errors, e.g. "reset". */
  label: string;
}

/** Resend when configured; the audit test sink under AUDIT_TEST_RUN; never logs links or addresses. */
async function deliverEmail(email: OutgoingEmail): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.EMAIL_FROM?.trim() ?? "ReLoop <noreply@reloop.local>";
  const { to, subject, text, html, label } = email;

  const sink = auditTransportSink();
  if (sink) {
    captureTransport(sink, { kind: "mail", to, subject, text, html });
    return { sent: true, provider: "test-capture" };
  }

  if (apiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Gagal mengirim email ${label} (${res.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    return { sent: true, provider: "resend" };
  }

  if (process.env.NODE_ENV !== "production") {
    // Never log the link: it carries a live single-use token.
    console.info(
      `[mailer] RESEND_API_KEY is not configured; ${label} email was not sent (link withheld from logs)`,
    );
    return { sent: false, provider: "log" };
  }

  console.warn(
    `[mailer] RESEND_API_KEY is not configured; ${label} email was not sent`,
  );
  return { sent: false, provider: "none" };
}

/** Sends transactional email via Resend when configured; logs a redacted notice in dev otherwise. */
export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<SendEmailResult> {
  const { text, html } = buildPasswordResetContent(input.resetUrl);
  return deliverEmail({ to: input.to, subject: "Reset kata sandi ReLoop", text, html, label: "reset" });
}

export interface AccountDeletionEmailInput {
  to: string;
  confirmUrl: string;
}

function buildAccountDeletionContent(confirmUrl: string) {
  const text = [
    "Kami menerima permintaan untuk menghapus akun ReLoop yang terdaftar dengan alamat email ini.",
    "",
    "Tidak ada data yang dihapus sebelum Anda mengonfirmasi. Buka tautan berikut untuk meninjau dan mengonfirmasi (berlaku 24 jam, sekali pakai):",
    confirmUrl,
    "",
    "Jika masih ada saldo atau pencairan yang belum selesai, penghapusan ditunda sampai semuanya selesai dan akun tetap dapat Anda gunakan.",
    "Jika Anda tidak meminta penghapusan, abaikan email ini; akun Anda tidak berubah.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="id">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <p>Kami menerima permintaan untuk menghapus akun ReLoop yang terdaftar dengan alamat email ini.</p>
  <p>Tidak ada data yang dihapus sebelum Anda mengonfirmasi. Tautan berlaku 24 jam dan hanya dapat dipakai sekali.</p>
  <p><a href="${confirmUrl}">Tinjau dan konfirmasi penghapusan akun</a></p>
  <p style="color:#64748b;font-size:14px">Jika masih ada saldo atau pencairan yang belum selesai, penghapusan ditunda sampai semuanya selesai dan akun tetap dapat Anda gunakan.</p>
  <p style="color:#64748b;font-size:14px">Jika Anda tidak meminta penghapusan, abaikan email ini; akun Anda tidak berubah.</p>
</body>
</html>`;

  return { text, html };
}

/** One-time confirmation link for a public account-deletion request (lib/erasure-jobs.ts). */
export async function sendAccountDeletionVerificationEmail(
  input: AccountDeletionEmailInput,
): Promise<SendEmailResult> {
  const { text, html } = buildAccountDeletionContent(input.confirmUrl);
  return deliverEmail({
    to: input.to,
    subject: "Konfirmasi penghapusan akun ReLoop",
    text,
    html,
    label: "konfirmasi penghapusan akun",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface TravelAgentInviteEmailInput {
  to: string;
  /** Link with the single-use token in its fragment (lib/email-tokens.ts). */
  acceptUrl: string;
  agentName: string;
  organizationName: string;
}

function buildTravelAgentInviteContent(input: TravelAgentInviteEmailInput) {
  const text = [
    `${input.organizationName} mengundang alamat email ini untuk mengelola travel agent "${input.agentName}" di ReLoop.`,
    "",
    "Masuk atau daftar di ReLoop memakai alamat email ini, lalu buka tautan berikut untuk menerima undangan (berlaku 24 jam, sekali pakai):",
    input.acceptUrl,
    "",
    "Undangan hanya dapat diterima oleh akun yang memakai alamat email ini.",
    "Jika Anda tidak mengenal undangan ini, abaikan email ini.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="id">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <p>${escapeHtml(input.organizationName)} mengundang alamat email ini untuk mengelola travel agent &quot;${escapeHtml(input.agentName)}&quot; di ReLoop.</p>
  <p>Masuk atau daftar di ReLoop memakai alamat email ini, lalu buka tautan berikut. Tautan berlaku 24 jam dan hanya dapat dipakai sekali.</p>
  <p><a href="${escapeHtml(input.acceptUrl)}">Terima undangan travel agent</a></p>
  <p style="color:#64748b;font-size:14px">Undangan hanya dapat diterima oleh akun yang memakai alamat email ini. Jika Anda tidak mengenal undangan ini, abaikan email ini.</p>
</body>
</html>`;

  return { text, html };
}

/** Invitation for a travel agent (A03); delivered only through lib/email-outbox.ts. */
export async function sendTravelAgentInviteEmail(
  input: TravelAgentInviteEmailInput,
): Promise<SendEmailResult> {
  const { text, html } = buildTravelAgentInviteContent(input);
  return deliverEmail({
    to: input.to,
    subject: "Undangan travel agent ReLoop",
    text,
    html,
    label: "undangan travel agent",
  });
}

export interface EmailVerificationEmailInput {
  to: string;
  /** Link with the single-use token in its fragment (lib/email-tokens.ts). */
  verifyUrl: string;
}

function buildEmailVerificationContent(verifyUrl: string) {
  const text = [
    "Konfirmasi bahwa alamat email ini milik akun ReLoop Anda.",
    "",
    "Masuk ke ReLoop, lalu buka tautan berikut (berlaku 24 jam, sekali pakai):",
    verifyUrl,
    "",
    "Jika Anda tidak membuat atau mengubah akun ReLoop, abaikan email ini.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="id">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <p>Konfirmasi bahwa alamat email ini milik akun ReLoop Anda.</p>
  <p>Masuk ke ReLoop, lalu buka tautan berikut. Tautan berlaku 24 jam dan hanya dapat dipakai sekali.</p>
  <p><a href="${escapeHtml(verifyUrl)}">Verifikasi email</a></p>
  <p style="color:#64748b;font-size:14px">Jika Anda tidak membuat atau mengubah akun ReLoop, abaikan email ini.</p>
</body>
</html>`;

  return { text, html };
}

/** Account email verification (A03); delivered only through lib/email-outbox.ts. */
export async function sendEmailVerificationEmail(
  input: EmailVerificationEmailInput,
): Promise<SendEmailResult> {
  const { text, html } = buildEmailVerificationContent(input.verifyUrl);
  return deliverEmail({
    to: input.to,
    subject: "Verifikasi email ReLoop",
    text,
    html,
    label: "verifikasi email",
  });
}
