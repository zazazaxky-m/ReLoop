import type {
  RemoteCommandStatus,
  RemoteCommandType,
} from "@prisma/client";

export const REMOTE_COMMAND_EXPIRY_SECONDS = 60;

export const DANGEROUS_REMOTE_COMMANDS = new Set<RemoteCommandType>([
  "STOP_ALL",
  "OPEN_GATE",
  "RESET_ALERT",
  "ENTER_MAINTENANCE",
  "RESUME_OPERATION",
]);

export const remoteCommandLabels: Record<RemoteCommandType, string> = {
  REFRESH_STATE: "Perbarui status",
  CAPTURE_SNAPSHOT: "Ambil snapshot kamera",
  SYNC_NOW: "Sinkronkan sekarang",
  STOP_ALL: "Stop semua aktuator",
  OPEN_GATE: "Buka input gate",
  CLOSE_GATE: "Tutup input gate",
  RESET_ALERT: "Reset alert",
  ENTER_MAINTENANCE: "Masuk maintenance",
  RESUME_OPERATION: "Lanjutkan operasi",
};

export type RemoteCommandView = {
  id: string;
  command: RemoteCommandType;
  status: RemoteCommandStatus;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  expiresAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};
