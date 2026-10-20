// A projected helix around the photographed bottle. Coordinates use the
// approved1122×800 hero plate, including the65px header offset.
export const RIBBON_SEGMENTS = 180;
export const FLOW_LENGTH = 1000;
export const FLOW_PERIOD = 500;
export const FLOW_PULSE = 90;
export const FLOW_SECONDS = 4;
export const RIBBON_TAIL =
  "M-12 734C118 790 307 812 421 663C446 637 476 618 500 610";
const PI = Math.PI;
const START = -2 * PI;
const END = 0.45 * PI;

function pointAt(t) {
  const turn = START + (END - START) * t;
  let y, radius;
  if (turn < -PI) {
    const u = (turn + 2 * PI) / PI;
    y = 285 + 215 * u;
    radius = 110 + 115 * u;
  } else if (turn <= 0) {
    const u = (turn + PI) / PI;
    y = 500 + 70 * u;
    radius = 225 - 85 * u;
  } else {
    const u = turn / PI;
    y = 570 + 10 * u;
    radius = 140 + 15 * u;
  }
  const angle = turn;
  const depth = -Math.sin(angle);
  const cross = Math.cos(angle);
  const rearBlend = Math.min(1, Math.max(0, -depth / 0.5));
  const bend =
    -40 * depth + 46 * depth * rearBlend * rearBlend * (3 - 2 * rearBlend);
  return {
    x: 830 - 0.6 * (y - 260) + radius * cross + bend,
    y: y + 40 * cross + 40 * depth,
    depth,
    halfWidth:
      (9 + Math.max(0, depth) * 2) * Math.min(1, t / 0.045, (1 - t) / 0.065),
  };
}

const xy = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
function outline(points) {
  if (points.length < 2) return "";
  const edge = (p, sign) => ({
    x: p.x + sign * p.nx * p.halfWidth,
    y: p.y + sign * p.ny * p.halfWidth,
  });
  return `M${points.map((p) => xy(edge(p, 1))).join("L")}L${points
    .slice().reverse()
    .map((p) => xy(edge(p, -1)))
    .join("L")}Z`;
}

export function ribbonFrame() {
  const points = Array.from({ length: RIBBON_SEGMENTS + 1 }, (_, i) =>
    pointAt(i / RIBBON_SEGMENTS),
  );
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)],
      next = points[Math.min(RIBBON_SEGMENTS, i + 1)];
    const dx = next.x - prev.x,
      dy = next.y - prev.y,
      length = Math.hypot(dx, dy) || 1;
    p.nx = -dy / length;
    p.ny = dx / length;
  });
  const runs = { front: [], rear: [] };
  let run = [points[0]],
    side = points[0].depth >= 0 ? "front" : "rear";
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      last = points[i - 1],
      nextSide = p.depth >= 0 ? "front" : "rear";
    if (nextSide !== side) {
      const mix = last.depth / (last.depth - p.depth);
      const crossing = Object.fromEntries(
        Object.keys(p).map((k) => [k, last[k] + (p[k] - last[k]) * mix]),
      );
      run.push(crossing);
      runs[side].push(outline(run));
      run = [crossing, p];
      side = nextSide;
    } else run.push(p);
  }
  runs[side].push(outline(run));
  // Travel from the ground tail into the hidden lower end, then follow the
  // fixed coil in reverse toward the upper-right paint tip. Both depth layers
  // share this exact path and dash origin, so occlusion never resets the flow.
  const flow =
    RIBBON_TAIL +
    "C545,590 602,555 " +
    xy(points.at(-1)) +
    "L" +
    points.slice().reverse().map(xy).join("L") +
    "C920,250 915,170 949,138C995,152 1065,192 1093,230";
  return { front: runs.front.join(""), rear: runs.rear.join(""), flow };
}
