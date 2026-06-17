import Link from "next/link";
import { DataTable, StatusBadge, type Column } from "@/components/ui";
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
      header: "Fill",
      align: "right",
      render: (m) => `${m.fillLevelPercent}%`,
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
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          Detail
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
