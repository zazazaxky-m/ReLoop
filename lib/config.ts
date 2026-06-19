import { prisma } from "./prisma";

export const CONFIG_KEYS = {
  MIN_REDEMPTION: "min_redemption",
  DEFAULT_QR_ROTATION_SECONDS: "default_qr_rotation_seconds",
  POINTS_TO_RUPIAH: "points_to_rupiah",
  LANDING_HERO_SLIDES: "landing_hero_slides",
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.MIN_REDEMPTION]: "10000",
  [CONFIG_KEYS.DEFAULT_QR_ROTATION_SECONDS]: "30",
  [CONFIG_KEYS.POINTS_TO_RUPIAH]: "1",
};

export async function getConfig(key: string): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value ?? CONFIG_DEFAULTS[key] ?? "";
}

export async function getConfigInt(key: string): Promise<number> {
  const value = await getConfig(key);
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function setConfig(key: string, value: string) {
  return prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getMinRedemption(): Promise<number> {
  return getConfigInt(CONFIG_KEYS.MIN_REDEMPTION);
}

/** Returns all known config keys merged with stored overrides. */
export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await prisma.systemConfig.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...CONFIG_DEFAULTS, ...stored };
}
