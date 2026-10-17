/**
 * User-facing wording for account erasure (Indonesian). Pure module: safe to
 * import from client components, API routes and lib/erasure-jobs.ts.
 *
 * Rule: say exactly what is erased, what is kept and why. Never claim that
 * every piece of data is gone: financial records stay (pseudonymous), see
 * docs/privacy-erasure.md for the retention matrix.
 */

export type ErasureStatus =
  | "PENDING"
  | "VERIFIED"
  | "PROCESSING"
  | "PENDING_RECONCILIATION"
  | "RETRYABLE_FAILED"
  | "COMPLETED"
  | "REJECTED";

/** Open balances and activities that hold an erasure (numbers only, no personal data). */
export interface ErasureObligations {
  /** Spendable balance in rupiah. */
  available: number;
  /** Part of `available` an open reconciliation case holds; only the ReLoop team can settle it. */
  heldForReview: number;
  /** Earnings still under review, in rupiah. */
  pending: number;
  /** Balance held by payout requests in progress, in rupiah. */
  reserved: number;
  /** Payout requests not yet SUCCESS/FAILED/REVERSED. */
  openRedemptions: number;
  /** Deposit sessions still running, or with items awaiting review. */
  openSessions: number;
  /** Trips (PLANNED/ACTIVE) whose return reward would go to this account. */
  openTrips: number;
}

export const ERASED_DATA: readonly string[] = [
  "Nama, email, dan nomor telepon di profil (diganti dengan \"Pengguna dihapus\" dan alamat pengganti yang tidak dapat dihubungi).",
  "Kata sandi, kunci MFA (termasuk yang belum selesai diaktifkan), token reset kata sandi, dan token notifikasi perangkat; semua sesi login dicabut.",
  "Nomor dan nama pemilik akun pencairan (akun pencairan dinonaktifkan).",
  "Nomor dan nama tujuan pada riwayat pencairan, catatan operator pada pencairan Anda, serta berkas bukti transfer.",
  "Notifikasi dalam aplikasi, serta alamat IP, perangkat, dan alasan yang tercatat pada persetujuan dan permintaan penghapusan Anda.",
];

export const RETAINED_DATA: readonly string[] = [
  "Riwayat setoran, ledger reward, serta nominal, status, dan waktu pencairan, terhubung ke ID akun yang tidak lagi memuat nama, email, atau telepon Anda — untuk pembukuan, rekonsiliasi keuangan, dan pencegahan penipuan.",
  "Sidik jari (hash) nomor referensi transfer, bukan nomornya — agar transfer tetap dapat dicocokkan dengan mutasi bank.",
  "Catatan audit tanpa email, nama, telepon, atau nomor rekening Anda — untuk keamanan dan akuntabilitas tindakan operator.",
  "Data trip dan foto keamanan mesin RVM yang terekam saat sesi setoran — untuk operasional mitra dan investigasi keamanan.",
  "Lama penyimpanan data di atas mengikuti kebijakan retensi yang disetujui ReLoop.",
];

export function formatRupiah(amount: number): string {
  return `Rp${Math.abs(amount).toLocaleString("id-ID")}`;
}

/** What the owner must settle before the erasure can continue. */
export function resolutionSteps(o: ErasureObligations): string[] {
  const steps: string[] = [];
  const withdrawable = o.available - o.heldForReview;
  if (withdrawable > 0) {
    steps.push(
      `Cairkan saldo tersedia ${formatRupiah(withdrawable)} melalui menu Dompet. Jika saldo di bawah minimum pencairan, hubungi privacy@reloop.id agar tim kami membantu menyelesaikannya.`,
    );
  }
  if (o.heldForReview > 0) {
    steps.push(
      `Saldo ${formatRupiah(o.heldForReview)} sedang ditahan untuk pemeriksaan; tim kami akan menyelesaikannya lebih dulu.`,
    );
  }
  if (o.openRedemptions > 0) {
    steps.push(`Tunggu ${o.openRedemptions} pengajuan pencairan yang sedang berjalan selesai diproses.`);
  } else if (o.reserved > 0) {
    steps.push(`Saldo ${formatRupiah(o.reserved)} masih tertahan untuk pencairan; tim kami akan menyelesaikannya.`);
  }
  if (o.pending > 0) {
    steps.push(`Tunggu saldo ${formatRupiah(o.pending)} yang masih ditinjau selesai divalidasi, lalu cairkan bila sudah tersedia.`);
  } else if (o.pending < 0) {
    steps.push("Tunggu penyesuaian saldo yang masih ditinjau selesai.");
  }
  if (o.openSessions > 0) {
    steps.push(`Selesaikan atau tunggu ${o.openSessions} sesi setoran yang masih berjalan atau ditinjau.`);
  }
  if (o.openTrips > 0) {
    steps.push(`Hubungi pengelola trip untuk menyelesaikan atau membatalkan ${o.openTrips} trip yang masih aktif atas nama Anda.`);
  }
  if (steps.length > 0) {
    steps.push("Setelah semuanya selesai, penghapusan dilanjutkan otomatis. Saldo Anda tidak dihanguskan.");
  }
  return steps;
}

export interface ErasureDescription {
  /** Every required step finished. */
  completed: boolean;
  /** The profile was already anonymized and the account deactivated. */
  accountErased: boolean;
  message: string;
  resolutionSteps: string[];
  erased: readonly string[];
  retained: readonly string[];
}

function messageFor(status: ErasureStatus, accountErased: boolean): string {
  switch (status) {
    case "PENDING":
      return "Permintaan diterima tetapi belum dikonfirmasi oleh pemilik akun. Belum ada data yang dihapus.";
    case "PENDING_RECONCILIATION":
      return "Penghapusan ditunda karena masih ada saldo atau transaksi yang belum selesai. Belum ada data yang dihapus dan akun Anda tetap aktif agar Anda dapat menyelesaikannya.";
    case "RETRYABLE_FAILED":
      return accountErased
        ? "Profil Anda sudah dianonimkan dan akun dinonaktifkan, tetapi pembersihan berkas bukti transfer gagal dan akan dicoba ulang otomatis. Penghapusan belum selesai."
        : "Penghapusan belum selesai karena ada langkah yang gagal; sistem akan mencobanya ulang otomatis. Belum ada data yang dihapus.";
    case "COMPLETED":
      return "Penghapusan akun selesai: data pribadi yang tercantum telah dihapus dan akun dinonaktifkan. Catatan transaksi tertentu tetap disimpan tanpa identitas Anda, sesuai daftar data yang dipertahankan.";
    case "REJECTED":
      return "Permintaan ini tidak diproses. Hubungi privacy@reloop.id bila Anda masih ingin menghapus akun.";
    case "VERIFIED":
    case "PROCESSING":
    default:
      return accountErased
        ? "Profil Anda sudah dianonimkan dan akun dinonaktifkan. Pembersihan berkas masih berjalan; penghapusan belum selesai."
        : "Permintaan penghapusan sedang diproses. Penghapusan belum selesai.";
  }
}

export function describeErasure(input: {
  status: ErasureStatus;
  accountErased: boolean;
  obligations: ErasureObligations | null;
}): ErasureDescription {
  return {
    completed: input.status === "COMPLETED",
    accountErased: input.accountErased,
    message: messageFor(input.status, input.accountErased),
    resolutionSteps:
      input.status === "PENDING_RECONCILIATION" && input.obligations ? resolutionSteps(input.obligations) : [],
    erased: ERASED_DATA,
    retained: RETAINED_DATA,
  };
}

/** Answer of the public form, identical whether or not the email has an account. */
export const PUBLIC_REQUEST_MESSAGE =
  "Permintaan penghapusan diterima. Jika email tersebut terdaftar, kami mengirim tautan konfirmasi ke alamat itu. Tidak ada data yang dihapus sebelum pemilik akun mengonfirmasi melalui tautan tersebut.";
