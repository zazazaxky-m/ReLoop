export interface SendEmailResult {
  sent: boolean;
  provider: "resend" | "log" | "none";
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

/** Sends transactional email via Resend when configured; logs in dev otherwise. */
export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.EMAIL_FROM?.trim() ?? "ReLoop <noreply@reloop.local>";
  const { text, html } = buildPasswordResetContent(input.resetUrl);

  if (apiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: "Reset kata sandi ReLoop",
        text,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Gagal mengirim email reset (${res.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    return { sent: true, provider: "resend" };
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[mailer] Password reset for ${input.to}: ${input.resetUrl}`,
    );
    return { sent: false, provider: "log" };
  }

  console.warn(
    "[mailer] RESEND_API_KEY is not configured; password reset email was not sent",
  );
  return { sent: false, provider: "none" };
}
