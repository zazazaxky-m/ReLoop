import Link from "next/link";
import { DataTable, StatusBadge, type Column } from "@/components/ui";
import { ArrowUpRight } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";

export interface MachineRow {
  id: string;
  machineCode: string;
  name: string;
  status: string;
  fillLevelPercent: number;
  organizationName?: string | null;
  regionName?: string | null;
  lastHeartbeatAt: Date | string | null;
}

export function MachineListTable({
  machines,
  detailBase,
  showOrg = false,
}: {
  machines: MachineRow[];
  detailBase: string;
  showOrg?: boolean;
}) {
  const columns: Column<MachineRow>[] = [
    {
      key: "machineCode",
      header: "Kode",
      render: (m) => (
        <Link
          href={`${detailBase}/${m.id}`}
          className="font-mono text-sm font-semibold text-brand-700 hover:underline"
        >
          {m.machineCode}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Nama",
      render: (m) => (
        <div>
          <p className="font-medium text-foreground">{m.name}</p>
          {m.regionName ? (
            <p className="text-xs text-muted">{m.regionName}</p>
          ) : null}
        </div>
      ),
    },
    ...(showOrg
      ? [
          {
            key: "org",
            header: "Organisasi",
            render: (m: MachineRow) => m.organizationName ?? "-",
          } as Column<MachineRow>,
        ]
      : []),
    {
      key: "status",
      header: "Status",
      render: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "fill",
      header: "Kapasitas",
      render: (m) => (
        <div className="flex min-w-32 items-center gap-2.5">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className={
                m.fillLevelPercent >= 80
                  ? "h-full bg-amber-500"
                  : "h-full bg-brand-500"
              }
              style={{ width: `${Math.min(m.fillLevelPercent, 100)}%` }}
            />
          </div>
          <span className="w-9 text-right text-xs font-semibold text-muted">
            {m.fillLevelPercent}%
          </span>
        </div>
      ),
    },
    {
      key: "heartbeat",
      header: "Heartbeat",
      render: (m) => (
        <span className="text-sm text-muted">{timeAgo(m.lastHeartbeatAt)}</span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (m) => (
        <Link
          href={`${detailBase}/${m.id}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
        >
          Detail <ArrowUpRight />
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={machines}
      getRowKey={(m) => m.id}
      emptyTitle="Belum ada mesin"
      emptyDescription="Tambahkan mesin pertama untuk organisasi ini."
    />
  );
}
