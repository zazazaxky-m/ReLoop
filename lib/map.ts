export interface MapMachine {
  id: string;
  name: string;
  machineCode: string;
  status: string;
  fillLevelPercent: number;
  capacityKg: number | null;
  organizationName: string;
  latitude: number;
  longitude: number;
  supportedWasteTypes?: string[];
}

export interface MapCampaign {
  id: string;
  name: string;
  organizationName: string;
  latitude: number;
  longitude: number;
  rewardMultiplier: number | null;
}

/** Centroid of machine coordinates; null when none have coords. */
export function machineCentroid(
  machines: { latitude: number | null; longitude: number | null }[],
): { latitude: number; longitude: number } | null {
  const pts = machines.filter(
    (m): m is { latitude: number; longitude: number } =>
      m.latitude != null && m.longitude != null,
  );
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + p.latitude, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.longitude, 0) / pts.length;
  return { latitude: lat, longitude: lng };
}
