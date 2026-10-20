"use client";
/* The photographed cutout and fixed SVG masks are deliberately separate layers. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from "react";
import { useMotionEnvironment } from "./useMotionEnvironment";
import {
  FLOW_LENGTH,
  FLOW_PERIOD,
  FLOW_PULSE,
  RIBBON_TAIL,
  ribbonFrame,
} from "./ribbon-geometry.js";

const SHAPE = ribbonFrame();

export function BottleCoil({ motion }: { motion: boolean }) {
  const root = useRef<HTMLDivElement>(null),
    id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [visible, setVisible] = useState(true);
  const suspended = useMotionEnvironment();
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(entry.isIntersecting && entry.intersectionRatio > 0.1),
      { threshold: 0.1 },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const running = motion && visible && !suspended;
  const flow = (mask: string) => (
    <path
      className="coil-flow"
      d={SHAPE.flow}
      pathLength={FLOW_LENGTH}
      strokeDasharray={`${FLOW_PULSE} ${FLOW_PERIOD - FLOW_PULSE}`}
      mask={`url(#${mask})`}
    />
  );
  return (
    <div className="bottle-coil" ref={root} data-running={running}>
      <svg
        className="coil-layer coil-rear"
        viewBox="0 0 1122 800"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`${id}-paint`}>
            <rect x="0" y="0" width="1122" height="250" />
          </clipPath>
          <mask
            id={`${id}-rear`}
            maskUnits="userSpaceOnUse"
            x="-40"
            y="0"
            width="1200"
            height="850"
            className="coil-mask"
          >
            <path d={SHAPE.rear} fill="white" />
            <path d={RIBBON_TAIL} fill="none" stroke="white" strokeWidth="21" />
            <image
              className="coil-paint-wisp"
              href="/landing/ribbon-v3.webp"
              x="0"
              y="26"
              width="1122"
              height="800"
              clipPath={`url(#${id}-paint)`}
            />
          </mask>
        </defs>
        <image
          className="coil-paint-wisp"
          href="/landing/ribbon-v3.webp"
          x="0"
          y="26"
          width="1122"
          height="800"
          clipPath={`url(#${id}-paint)`}
        />
        <path className="coil-tail" d={RIBBON_TAIL} />
        <path d={SHAPE.rear} fill="#c7ed29" />
        {flow(`${id}-rear`)}
      </svg>
      <img className="hero-bottle" src="/landing/bottle-v2.webp" alt="" />
      <svg
        className="coil-layer coil-front"
        viewBox="0 0 1122 800"
        aria-hidden="true"
      >
        <defs>
          <mask
            id={`${id}-front`}
            maskUnits="userSpaceOnUse"
            x="-40"
            y="0"
            width="1200"
            height="850"
            className="coil-mask"
          >
            <path d={SHAPE.front} fill="white" />
          </mask>
        </defs>
        <path d={SHAPE.front} fill="#d6fa32" />
        {flow(`${id}-front`)}
      </svg>
    </div>
  );
}
