"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { MachineForm } from "./MachineForm";

interface Option {
  id: string;
  name: string;
}

export function MachineManager({
  wasteTypes,
  organizations,
  regions,
}: {
  wasteTypes: Option[];
  organizations?: Option[];
  regions?: Option[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Button
        variant={open ? "outline" : "primary"}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Tutup form" : <><Plus /> Tambah Mesin</>}
      </Button>
      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Tambah Mesin Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <MachineForm
              mode="create"
              wasteTypes={wasteTypes}
              organizations={organizations}
              regions={regions}
              onSuccess={() => setOpen(false)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
