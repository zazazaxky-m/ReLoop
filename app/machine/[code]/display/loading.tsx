export default function MachineDisplayLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300"
      aria-busy="true"
      aria-label="Menyiapkan layar mesin"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-brand-500" />
        <p className="text-sm">Menyiapkan layar mesin…</p>
      </div>
    </div>
  );
}
