"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { MapMachine, MapCampaign } from "@/lib/map";

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "#16a34a",
  FULL: "#d97706",
  MAINTENANCE: "#2563eb",
  ERROR: "#dc2626",
  OFFLINE: "#64748b",
};

const STATUS_LABEL: Record<string, string> = {
  ONLINE: "Online",
  FULL: "Penuh",
  MAINTENANCE: "Maintenance",
  ERROR: "Error",
  OFFLINE: "Offline",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function machinePin(color: string, fill: number): string {
  return `
    <div style="position:relative;width:30px;height:38px;transform:translate(-50%,-100%)">
      <svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>
        <circle cx="15" cy="15" r="9" fill="#ffffff"/>
      </svg>
      <span style="position:absolute;top:7px;left:0;width:30px;text-align:center;font-size:9px;font-weight:700;color:${color}">${fill}%</span>
    </div>`;
}

function campaignPin(): string {
  return `
    <div style="width:26px;height:26px;transform:translate(-50%,-50%);border-radius:9999px;background:#0d9488;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px">★</div>`;
}

export function MapView({
  machines,
  campaigns = [],
  height = 460,
}: {
  machines: MapMachine[];
  campaigns?: MapCampaign[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  const dataKey = useMemo(
    () =>
      JSON.stringify({
        m: machines.map((m) => [m.id, m.status, m.fillLevelPercent, m.latitude, m.longitude]),
        c: campaigns.map((c) => [c.id, c.latitude, c.longitude]),
      }),
    [machines, campaigns],
  );

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          scrollWheelZoom: false,
          attributionControl: true,
        });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const layer = layerRef.current!;
      layer.clearLayers();

      const points: [number, number][] = [];

      for (const m of machines) {
        const color = STATUS_COLOR[m.status] ?? STATUS_COLOR.OFFLINE;
        const icon = L.divIcon({
          html: machinePin(color, m.fillLevelPercent),
          className: "",
          iconSize: [30, 38],
          iconAnchor: [15, 38],
        });
        const waste =
          m.supportedWasteTypes && m.supportedWasteTypes.length
            ? `<p style="margin:4px 0 0;color:#475569">Jenis: ${escapeHtml(m.supportedWasteTypes.join(", "))}</p>`
            : "";
        const popup = `
          <div style="min-width:180px;font-family:system-ui">
            <p style="margin:0;font-weight:700;color:#0f172a">${escapeHtml(m.name)}</p>
            <p style="margin:2px 0 6px;color:#64748b;font-size:12px">${escapeHtml(m.machineCode)} · ${escapeHtml(m.organizationName)}</p>
            <p style="margin:0;display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:9px;height:9px;border-radius:9999px;background:${color}"></span>
              <strong style="color:${color}">${STATUS_LABEL[m.status] ?? m.status}</strong>
            </p>
            <p style="margin:4px 0 0;color:#475569">Sisa storage: <strong>${100 - m.fillLevelPercent}%</strong> (terisi ${m.fillLevelPercent}%)</p>
            ${m.capacityKg != null ? `<p style="margin:2px 0 0;color:#475569">Kapasitas: ${m.capacityKg} kg</p>` : ""}
            ${waste}
          </div>`;
        L.marker([m.latitude, m.longitude], { icon }).bindPopup(popup).addTo(layer);
        points.push([m.latitude, m.longitude]);
      }

      for (const c of campaigns) {
        const icon = L.divIcon({
          html: campaignPin(),
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const popup = `
          <div style="min-width:160px;font-family:system-ui">
            <p style="margin:0;font-weight:700;color:#0f172a">${escapeHtml(c.name)}</p>
            <p style="margin:2px 0 4px;color:#64748b;font-size:12px">Campaign · ${escapeHtml(c.organizationName)}</p>
            ${c.rewardMultiplier ? `<p style="margin:0;color:#0d9488;font-weight:600">Reward ${c.rewardMultiplier}x</p>` : ""}
          </div>`;
        L.marker([c.latitude, c.longitude], { icon }).bindPopup(popup).addTo(layer);
        points.push([c.latitude, c.longitude]);
      }

      if (points.length > 0) {
        mapRef.current.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
      } else {
        // Default to Pangandaran.
        mapRef.current.setView([-7.6886, 108.6531], 13);
      }
    }

    setup();
    return () => {
      cancelled = true;
    };
  }, [dataKey, machines, campaigns]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
    />
  );
}
