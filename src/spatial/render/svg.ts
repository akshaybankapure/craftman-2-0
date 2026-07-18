import type { CertifiedPlan, Point, Polygon, RoomType } from "../types.ts";
import { stableHash } from "../verify/hash.ts";
import { furnishingContentHash } from "../furnishing/FurnishingFeasibilitySolver.ts";

const FILL: Record<RoomType, string> = {
  LIVING: "#4b351d",
  BEDROOM: "#192845",
  KITCHEN: "#073a2d",
  BATHROOM: "#0c4252",
  ENSUITE: "#0c4252",
  FOYER: "#2c2047",
  PRIVATE_LOBBY: "#272b35",
  CORRIDOR: "#272b35",
  DINING: "#4b351d",
  STUDY: "#28304c",
  UTILITY: "#174236",
  STORAGE: "#30333b",
  FAMILY_LOUNGE: "#46311f"
};

function points(poly: Polygon, scale: number, pad: number): string {
  return poly.outer.map((p: Point) => `${pad + p.x * scale},${pad + p.y * scale}`).join(" ");
}

export function renderPlanSvg(plan: CertifiedPlan, widthPx = 1200): string {
  if (!plan?.certificate?.valid || plan.certificate.candidateId !== plan.candidate.id) {
    throw new Error("Renderer accepts certified plans only.");
  }
  const candidate = plan.candidate;
  const liveGridHash = stableHash([candidate.grid.width, candidate.grid.height, candidate.grid.cellSizeMm, ...Array.from(candidate.grid.labels)]);
  const liveFurnishingHash = furnishingContentHash(candidate.furnishing.settings, candidate.furnishing.rooms);
  if (liveGridHash !== plan.certificate.gridHash || liveFurnishingHash !== plan.certificate.furnishingHash) {
    throw new Error("Renderer refuses stale or mutated certified plans.");
  }
  const env = candidate.brief.envelope.outer;
  const maxX = Math.max(...env.map((p) => p.x));
  const maxY = Math.max(...env.map((p) => p.y));
  const pad = 30;
  const scale = (widthPx - 2 * pad) / maxX;
  const heightPx = Math.ceil(maxY * scale + 2 * pad);
  const labels = candidate.spaces.map((space) => {
    const poly = space.polygon!;
    const cx = poly.outer.reduce((s, p) => s + p.x, 0) / poly.outer.length;
    const cy = poly.outer.reduce((s, p) => s + p.y, 0) / poly.outer.length;
    const areaSqM = space.cellCount * candidate.grid.cellSizeMm * candidate.grid.cellSizeMm / 1_000_000;
    return `<text x="${pad + cx * scale}" y="${pad + cy * scale}" text-anchor="middle" fill="#d9e5ff" font-size="13" font-family="Arial"><tspan font-weight="700">${space.id.toUpperCase()}</tspan><tspan x="${pad + cx * scale}" dy="18">${areaSqM.toFixed(1)} m²</tspan></text>`;
  }).join("\n");
  const rooms = candidate.spaces.map((space) => `<polygon points="${points(space.polygon!, scale, pad)}" fill="${FILL[space.type]}" fill-opacity="0.82" stroke="#b7d8ff" stroke-width="2"/>`).join("\n");
  const furniture = candidate.furnishing.rooms.flatMap((room) => room.placements).map((item) => {
    const x = pad + item.xCell * candidate.grid.cellSizeMm * scale;
    const y = pad + item.yCell * candidate.grid.cellSizeMm * scale;
    const w = item.widthCells * candidate.grid.cellSizeMm * scale;
    const h = item.heightCells * candidate.grid.cellSizeMm * scale;
    return `<g data-furniture="${item.kind}" data-room="${item.roomId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#d7a95b" fill-opacity="0.42" stroke="#ffe0a6" stroke-width="1"/><text x="${x + w / 2}" y="${y + h / 2}" dominant-baseline="middle" text-anchor="middle" fill="#fff1cf" font-size="8" font-family="Arial">${item.kind}</text></g>`;
  }).join("\n");
  const doors = candidate.doors.map((door) => {
    const s = door.boundary;
    if (s.orientation === "H") return `<line x1="${pad + s.start * scale}" y1="${pad + s.fixed * scale}" x2="${pad + s.end * scale}" y2="${pad + s.fixed * scale}" stroke="#19c2ff" stroke-width="5"/>`;
    return `<line x1="${pad + s.fixed * scale}" y1="${pad + s.start * scale}" x2="${pad + s.fixed * scale}" y2="${pad + s.end * scale}" stroke="#19c2ff" stroke-width="5"/>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
<rect width="100%" height="100%" fill="#080d14"/>
${rooms}
${furniture}
${doors}
${labels}
<text x="${pad}" y="20" fill="#91a8c8" font-size="12" font-family="Arial">${candidate.topology.family} · score ${candidate.quality.total.toFixed(1)} · furnishing ${candidate.furnishing.settings.clearanceProfile} · certificate ${plan.certificate.gridHash}</text>
</svg>`;
}
