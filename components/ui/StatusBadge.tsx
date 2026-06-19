import type { ComponentType, SVGProps } from "react";
import { Badge, type Tone, toneClasses } from "./Badge";
import { cn } from "@/lib/cn";
import {
  AlertTriangle,
  Box,
  CheckCircle,
  Clock,
  Dot,
  Info,
  MapPin,
  Power,
  Signal,
  Truck,
  User,
  Wrench,
  XCircle,
  Bolt,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface StatusMeta {
  label: string;
  tone: Tone;
  Icon: IconType;
}

// Single source of truth for status presentation across machines, sessions,
// deposits, ledger, redemption, pickup, partnership, and campaigns.
// Every badge has a TEXT label + ICON, never color alone (accessibility).
const REGISTRY: Record<string, StatusMeta> = {
  // Machine
  ONLINE: { label: "Online", tone: "success", Icon: Signal },
  OFFLINE: { label: "Offline", tone: "neutral", Icon: Power },
  FULL: { label: "Penuh", tone: "warning", Icon: Box },
  MAINTENANCE: { label: "Maintenance", tone: "info", Icon: Wrench },
  ERROR: { label: "Error", tone: "danger", Icon: AlertTriangle },

  // Deposit session
  RESERVED: { label: "Direservasi", tone: "info", Icon: Clock },
  ACTIVE: { label: "Aktif", tone: "brand", Icon: Bolt },
  PROCESSING_ITEM: { label: "Memproses", tone: "info", Icon: Clock },
  COMPLETED: { label: "Selesai", tone: "success", Icon: CheckCircle },
  REVIEW: { label: "Ditinjau", tone: "warning", Icon: AlertTriangle },
  CANCELLED: { label: "Dibatalkan", tone: "neutral", Icon: XCircle },
  EXPIRED: { label: "Kedaluwarsa", tone: "neutral", Icon: Clock },

  // Deposit item
  PENDING: { label: "Pending", tone: "warning", Icon: Clock },
  ACCEPTED: { label: "Diterima", tone: "success", Icon: CheckCircle },
  REJECTED: { label: "Ditolak", tone: "danger", Icon: XCircle },

  // Ledger
  AVAILABLE: { label: "Tersedia", tone: "success", Icon: CheckCircle },
  REDEEMED: { label: "Dicairkan", tone: "info", Icon: Info },
  REVERSED: { label: "Dikoreksi", tone: "neutral", Icon: Dot },

  // Redemption
  REQUESTED: { label: "Diminta", tone: "info", Icon: Clock },
  APPROVED: { label: "Disetujui", tone: "info", Icon: CheckCircle },
  PROCESSING: { label: "Diproses", tone: "info", Icon: Clock },
  SUCCESS: { label: "Sukses", tone: "success", Icon: CheckCircle },
  FAILED: { label: "Gagal", tone: "danger", Icon: XCircle },

  // Pickup
  ASSIGNED: { label: "Ditugaskan", tone: "info", Icon: User },
  ON_THE_WAY: { label: "Dalam Perjalanan", tone: "brand", Icon: Truck },
  ARRIVED: { label: "Tiba", tone: "brand", Icon: MapPin },
  COLLECTED: { label: "Diambil", tone: "success", Icon: CheckCircle },

  // Partnership
  INVITED: { label: "Diundang", tone: "info", Icon: Info },
  PENDING_SUPERADMIN_APPROVAL: {
    label: "Menunggu Approval",
    tone: "warning",
    Icon: Clock,
  },
  SUSPENDED: { label: "Ditangguhkan", tone: "warning", Icon: AlertTriangle },
  REMOVED: { label: "Dihapus", tone: "neutral", Icon: XCircle },

  // Campaign
  DRAFT: { label: "Draft", tone: "neutral", Icon: Dot },
  PAUSED: { label: "Dijeda", tone: "warning", Icon: Clock },
  ENDED: { label: "Berakhir", tone: "neutral", Icon: Dot },

  // Generic operational labels
  PAID: { label: "Dibayar", tone: "success", Icon: CheckCircle },
  PICKUP_REQUESTED: { label: "Pickup Diminta", tone: "info", Icon: Truck },
  PENDING_REWARD: { label: "Reward Pending", tone: "warning", Icon: Clock },
};

function humanize(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  if (!status) return <Badge tone="neutral">-</Badge>;
  const meta = REGISTRY[status];
  if (!meta) {
    return (
      <Badge tone="neutral" className={className}>
        <Dot className="text-[0.9em]" />
        {humanize(status)}
      </Badge>
    );
  }
  const { label, tone, Icon } = meta;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      <Icon className="text-[0.95em]" />
      {label}
    </span>
  );
}
