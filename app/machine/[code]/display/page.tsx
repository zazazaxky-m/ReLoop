import type { Metadata } from "next";
import { MachineDisplay } from "@/components/machine/MachineDisplay";

export const metadata: Metadata = {
  title: "Layar Mesin",
  robots: { index: false, follow: false },
};

export default async function MachineDisplayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <MachineDisplay code={code} />;
}
