import fs from "node:fs";

const t = fs.readFileSync("coverage-full-out.txt", "utf8");
const rows = [];
for (const l of t.split(/\r?\n/)) {
  if (!l.includes("|") || l.includes("---") || l.includes("% Stmts") || l.includes("All files")) continue;
  const p = l.split("|").map((s) => s.trim());
  if (p.length < 5 || !Number.isFinite(+p[1])) continue;
  const br = +p[2];
  if (br < 100) rows.push({ file: p[0], br, unc: p[5] || "" });
}
rows.sort((a, b) => a.br - b.br);
console.log("gaps", rows.length);
for (const r of rows) {
  console.log(String(r.br).padStart(6), r.file.padEnd(40), r.unc.slice(0, 90));
}
