"use client";

import "leaflet/dist/leaflet.css";
import "./map-markers.css";
import { useEffect, useMemo, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { MapMachine, MapCampaign } from "@/lib/map";

const STATUS_CLASS: Record<string, string> = {
  ONLINE: "rl-status--online",
  FULL: "rl-status--full",
  MAINTENANCE: "rl-status--maintenance",
  ERROR: "rl-status--error",
  OFFLINE: "rl-status--offline",
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

// Marker/popup markup uses classes from map-markers.css: inline style=""
// attributes are blocked by the production CSP.
function machinePin(statusClass: string, fill: number): string {
  return `
    <div class="rl-pin ${statusClass}">
      <svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.7 23.3 0 15 0z" fill="currentColor"/>
        <circle cx="15" cy="15" r="9" fill="#ffffff"/>
      </svg>
      <span class="rl-pin__label">${fill}%</span>
    </div>`;
}

function campaignPin(): string {
  return `<div class="rl-campaign-pin">★</div>`;
}

export function MapView({
  machines,
  campaigns = [],
  heightClassName = "h-[460px]",
}: {
  machines: MapMachine[];
  campaigns?: MapCampaign[];
  /** Tailwind height class, e.g. "h-[520px]". */
  heightClassName?: string;
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
        const statusClass = STATUS_CLASS[m.status] ?? STATUS_CLASS.OFFLINE;
        const icon = L.divIcon({
          html: machinePin(statusClass, m.fillLevelPercent),
          className: "",
          iconSize: [30, 38],
          iconAnchor: [15, 38],
        });
        const waste =
          m.supportedWasteTypes && m.supportedWasteTypes.length
            ? `<p>Jenis: ${escapeHtml(m.supportedWasteTypes.join(", "))}</p>`
            : "";
        const popup = `
          <div class="rl-popup">
            <p class="rl-popup__title">${escapeHtml(m.name)}</p>
            <p class="rl-popup__meta">${escapeHtml(m.machineCode)} · ${escapeHtml(m.organizationName)}</p>
            <p class="rl-popup__status">
              <span class="rl-popup__dot ${statusClass}"></span>
              <strong class="${statusClass}">${escapeHtml(STATUS_LABEL[m.status] ?? m.status)}</strong>
            </p>
            <p>Kapasitas tersisa: <strong>${100 - m.fillLevelPercent}%</strong> (terisi ${m.fillLevelPercent}%)</p>
            ${m.capacityKg != null ? `<p class="rl-popup__capacity">Kapasitas: ${m.capacityKg} kg</p>` : ""}
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
          <div class="rl-popup rl-popup--campaign">
            <p class="rl-popup__title">${escapeHtml(c.name)}</p>
            <p class="rl-popup__meta">Program · ${escapeHtml(c.organizationName)}</p>
            ${c.rewardMultiplier ? `<p class="rl-popup__reward">Reward ${c.rewardMultiplier}x</p>` : ""}
          </div>`;
        L.marker([c.latitude, c.longitude], { icon }).bindPopup(popup).addTo(layer);
        points.push([c.latitude, c.longitude]);
      }

      if (points.length > 0) {
        mapRef.current.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
      } else {
        mapRef.current.setView([-2.5489, 118.0149], 5);
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
      className={`relative z-0 isolate w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${heightClassName}`}
    />
  );
}
