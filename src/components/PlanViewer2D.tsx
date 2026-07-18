import React from 'react';
import type { FloorGraph, Vec2 } from '../types/index';
import { polygonArea } from '../geometry/vec2';
import type { EntranceDirection } from '../planner/ProgramBuilder';
import type { FlowInfo } from '../optimizer/objectives';
import type { FloorPlan } from '../planner/types';
import {
  type AreaUnitMode,
  formatAreaCompact,
  formatDimsCompact,
  formatOutline,
  unitModeLabel,
} from '../planner/units';

interface RoomColorDef {
  bg: string;
  border: string;
  label: string;
}

interface PlanViewer2DProps {
  graph: FloorGraph;
  width: number;
  height: number;
  showGraphOverlay?: boolean;
  flowData?: FlowInfo | null;
  entranceDirection?: EntranceDirection;
  roomColors?: Record<string, RoomColorDef>;
  /** Topology-first plan with physical doors / debug data. */
  floorPlan?: FloorPlan | null;
  showDebugOverlay?: boolean;
  /** Display unit for room areas / dimensions on the plan. */
  areaUnit?: AreaUnitMode;
}

const DEFAULT_COLORS: Record<string, RoomColorDef> = {
  living:   { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: '#fbbf24' },
  kitchen:  { bg: 'rgba(16, 185, 129, 0.12)', border: '#10b981', label: '#34d399' },
  bedroom:  { bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6', label: '#60a5fa' },
  bathroom: { bg: 'rgba(6, 182, 212, 0.12)',  border: '#06b6d4', label: '#22d3ee' },
  ensuite:  { bg: 'rgba(6, 182, 212, 0.18)',  border: '#0891b2', label: '#22d3ee' },
  corridor: { bg: 'rgba(100, 116, 139, 0.08)', border: '#64748b', label: '#94a3b8' },
  entry:    { bg: 'rgba(139, 92, 246, 0.12)', border: '#8b5cf6', label: '#a78bfa' },
  foyer:    { bg: 'rgba(139, 92, 246, 0.08)', border: '#a78bfa', label: '#c4b5fd' },
  utility:  { bg: 'rgba(161, 161, 170, 0.10)', border: '#a1a1aa', label: '#d4d4d8' },
  balcony:  { bg: 'rgba(52, 211, 153, 0.10)', border: '#34d399', label: '#6ee7b7' },
};

export const PlanViewer2D: React.FC<PlanViewer2DProps> = ({
  graph,
  width,
  height,
  showGraphOverlay = false,
  flowData = null,
  entranceDirection = 'S',
  roomColors,
  floorPlan = null,
  showDebugOverlay = false,
  areaUnit = 'm2',
}) => {
  const colors = roomColors || DEFAULT_COLORS;
  const padding = 60;
  const positions = Array.from(graph.vertices.values()).map(v => v.pos);
  if (positions.length === 0) return <div>No geometry</div>;

  const minX = Math.min(...positions.map(p => p.x));
  const maxX = Math.max(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxY = Math.max(...positions.map(p => p.y));

  const contentWidth = maxX - minX || 1;
  const contentHeight = maxY - minY || 1;
  const svgScale = Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight);

  const tx = (x: number) => (x - minX) * svgScale + padding;
  const ty = (y: number) => (y - minY) * svgScale + padding;

  const faceCentroids = new Map<string, Vec2>();
  for (const [faceId, face] of graph.faces) {
    const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    faceCentroids.set(faceId, { x: cx, y: cy });
  }

  const typeCounters = new Map<string, number>();
  const typeTotals = new Map<string, number>();
  for (const face of graph.faces.values()) {
    typeTotals.set(face.type, (typeTotals.get(face.type) || 0) + 1);
  }

  const hasEntry = Array.from(graph.faces.values()).some(f => f.type === 'entry');
  const actualShowGraphOverlay = showGraphOverlay && hasEntry;

  // Portal routes through doors (prefer FloorPlan routes)
  const routePaths: string[] = [];
  if (actualShowGraphOverlay) {
    if (floorPlan) {
      const internal = floorPlan.doors.filter(d => d.roomBId !== '__EXTERIOR__');
      for (const d of internal) {
        const route = floorPlan.routes.find(
          r =>
            (r.roomAId === d.roomAId && r.roomBId === d.roomBId) ||
            (r.roomAId === d.roomBId && r.roomBId === d.roomAId),
        );
        const pts = route?.points;
        if (pts && pts.length >= 2) {
          routePaths.push(
            pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x)} ${ty(p.y)}`).join(' '),
          );
        } else {
          const cA = faceCentroids.get(d.roomAId);
          const cB = faceCentroids.get(d.roomBId);
          if (cA && cB) {
            routePaths.push(
              `M ${tx(cA.x)} ${ty(cA.y)} L ${tx(d.position.x)} ${ty(d.position.y)} L ${tx(cB.x)} ${ty(cB.y)}`,
            );
          }
        }
      }
    } else if (flowData?.edges) {
      for (const edge of flowData.edges) {
        if (edge.route && edge.route.length >= 2) {
          routePaths.push(
            edge.route.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x)} ${ty(p.y)}`).join(' '),
          );
        } else {
          const cA = faceCentroids.get(edge.faceA);
          const cB = faceCentroids.get(edge.faceB);
          if (cA && cB && edge.doorPt) {
            routePaths.push(
              `M ${tx(cA.x)} ${ty(cA.y)} L ${tx(edge.doorPt.x)} ${ty(edge.doorPt.y)} L ${tx(cB.x)} ${ty(cB.y)}`,
            );
          }
        }
      }
    }
  }

  const compassCx = width - 60;
  const compassCy = 80;
  const compassR = 28;

  const doors = floorPlan?.doors ?? [];

  return (
    <svg width={width} height={height} style={{ background: 'transparent' }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {Array.from(graph.faces.values()).map(face => {
        const points = face.loop.map(vId => {
          const v = graph.vertices.get(vId)!;
          return `${tx(v.pos.x)},${ty(v.pos.y)}`;
        }).join(' ');

        const centroid = faceCentroids.get(face.id)!;
        const cx = tx(centroid.x);
        const cy = ty(centroid.y);
        const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
        const area = Math.abs(polygonArea(pts));
        const roomColor = colors[face.type] || { bg: 'rgba(255,255,255,0.05)', border: '#555', label: '#999' };
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const roomW = Math.max(...xs) - Math.min(...xs);
        const roomH = Math.max(...ys) - Math.min(...ys);

        const total = typeTotals.get(face.type) || 1;
        const counter = (typeCounters.get(face.type) || 0) + 1;
        typeCounters.set(face.type, counter);
        const displayName = face.type.charAt(0).toUpperCase() + face.type.slice(1);
        const label = total > 1 ? `${displayName} ${counter}` : displayName;

        return (
          <g key={face.id}>
            <polygon
              points={points}
              fill={roomColor.bg}
              stroke={roomColor.border}
              strokeWidth="1.5"
              strokeOpacity="0.6"
            />
            <text
              x={cx} y={actualShowGraphOverlay ? cy - 18 : cy - 6}
              textAnchor="middle"
              fill={roomColor.label}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
              }}
            >
              {label}
            </text>
            <text
              x={cx} y={actualShowGraphOverlay ? cy + 26 : cy + 10}
              textAnchor="middle"
              fill="#94a3b8"
              style={{ fontSize: areaUnit === 'both' ? '8px' : '9px', fontWeight: 500 }}
            >
              {formatAreaCompact(area, areaUnit)}
            </text>
            <text
              x={cx} y={actualShowGraphOverlay ? cy + 38 : cy + 22}
              textAnchor="middle"
              fill="#64748b"
              style={{ fontSize: areaUnit === 'both' ? '6.5px' : '7.5px' }}
            >
              {formatDimsCompact(roomW, roomH, areaUnit)}
            </text>
          </g>
        );
      })}

      {Array.from(graph.edges.values()).map(edge => {
        const vA = graph.vertices.get(edge.a)!;
        const vB = graph.vertices.get(edge.b)!;
        return (
          <line
            key={edge.id}
            x1={tx(vA.pos.x)}
            y1={ty(vA.pos.y)}
            x2={tx(vB.pos.x)}
            y2={ty(vB.pos.y)}
            stroke={edge.isExterior ? 'white' : 'rgba(255,255,255,0.5)'}
            strokeWidth={edge.isExterior ? 2.5 : 1.5}
            strokeLinecap="round"
          />
        );
      })}

      {Array.from(graph.vertices.values()).map(v => (
        <circle
          key={v.id}
          cx={tx(v.pos.x)}
          cy={ty(v.pos.y)}
          r="3"
          fill="white"
          stroke="#4f46e5"
          strokeWidth="1.5"
        />
      ))}

      {/* Physical doors: gap + swing arc */}
      {doors.map(door => {
        const px = tx(door.position.x);
        const py = ty(door.position.y);
        const doorSize = Math.max(8, door.width * svgScale * 0.55);
        const isH = door.orientation === 'horizontal';
        const gapHalf = (door.width * svgScale) / 2;
        return (
          <g key={door.id}>
            {/* Opening gap */}
            <line
              x1={isH ? px - gapHalf : px}
              y1={isH ? py : py - gapHalf}
              x2={isH ? px + gapHalf : px}
              y2={isH ? py : py + gapHalf}
              stroke="#0f172a"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <line
              x1={isH ? px - gapHalf : px}
              y1={isH ? py : py - gapHalf}
              x2={isH ? px + gapHalf : px}
              y2={isH ? py : py + gapHalf}
              stroke={door.isEntrance ? '#8b5cf6' : '#38bdf8'}
              strokeWidth={2}
              strokeLinecap="round"
            />
            {/* Swing arc */}
            <path
              d={swingArcPath(px, py, doorSize, door.orientation, door.isEntrance ?? false)}
              fill={door.isEntrance ? 'rgba(139, 92, 246, 0.12)' : 'rgba(56, 189, 248, 0.1)'}
              stroke={door.isEntrance ? '#8b5cf6' : '#38bdf8'}
              strokeWidth="1.2"
              strokeDasharray="3 2"
            />
          </g>
        );
      })}

      {/* Fallback decorative entry if no FloorPlan doors */}
      {doors.length === 0 && Array.from(graph.faces.values())
        .filter(f => f.type === 'entry')
        .map(face => {
          const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
          const xs = pts.map(p => p.x);
          const ys = pts.map(p => p.y);
          let doorX: number, doorY: number;
          switch (entranceDirection) {
            case 'S':
              doorX = tx((Math.min(...xs) + Math.max(...xs)) / 2);
              doorY = ty(Math.max(...ys));
              break;
            case 'N':
              doorX = tx((Math.min(...xs) + Math.max(...xs)) / 2);
              doorY = ty(Math.min(...ys));
              break;
            case 'E':
              doorX = tx(Math.max(...xs));
              doorY = ty((Math.min(...ys) + Math.max(...ys)) / 2);
              break;
            case 'W':
              doorX = tx(Math.min(...xs));
              doorY = ty((Math.min(...ys) + Math.max(...ys)) / 2);
              break;
          }
          return (
            <g key="door-arc-fallback">
              <circle cx={doorX} cy={doorY} r="10" fill="rgba(139, 92, 246, 0.15)" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="3 2" />
            </g>
          );
        })}

      {/* Portal routes through doors */}
      {actualShowGraphOverlay && routePaths.map((d, i) => (
        <path
          key={`route-${i}`}
          d={d}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.75"
        />
      ))}

      {actualShowGraphOverlay && Array.from(graph.faces.values()).map(face => {
        const centroid = faceCentroids.get(face.id)!;
        const cx = tx(centroid.x);
        const cy = ty(centroid.y);
        const depth = flowData?.pathLengths.get(face.id) ?? 999;
        let nodeColor = '#fbbf24';
        if (depth === 0) nodeColor = '#10b981';
        else if (depth === 1) nodeColor = '#06b6d4';
        else if (depth === 2) nodeColor = '#fbbf24';
        else if (depth >= 3) nodeColor = '#ec4899';
        if (depth === 999) nodeColor = '#ef4444';

        return (
          <g key={`dual-node-${face.id}`}>
            <circle
              cx={cx} cy={cy} r="11"
              fill="rgba(15, 23, 42, 0.9)"
              stroke={nodeColor}
              strokeWidth="2"
            />
            <text
              x={cx} y={cy + 3}
              textAnchor="middle"
              fill="white"
              style={{ fontSize: '8px', fontWeight: 'bold', pointerEvents: 'none' }}
            >
              {depth === 999 ? '✕' : depth}
            </text>
          </g>
        );
      })}

      {/* Dev debug overlay */}
      {showDebugOverlay && floorPlan && (
        <g opacity="0.9">
          {/* Desired topology */}
          {floorPlan.topology.edges.map((e, i) => {
            const a = floorPlan.rooms.find(r => r.id === e.parentId);
            const b = floorPlan.rooms.find(r => r.id === e.childId);
            if (!a || !b) return null;
            const hasDoor = floorPlan.doors.some(
              d =>
                (d.roomAId === e.parentId && d.roomBId === e.childId) ||
                (d.roomAId === e.childId && d.roomBId === e.parentId),
            );
            return (
              <line
                key={`topo-${i}`}
                x1={tx(a.x + a.w / 2)}
                y1={ty(a.y + a.h / 2)}
                x2={tx(b.x + b.w / 2)}
                y2={ty(b.y + b.h / 2)}
                stroke={hasDoor ? '#22c55e' : '#ef4444'}
                strokeWidth={hasDoor ? 1 : 2}
                strokeDasharray={hasDoor ? '2 4' : '6 3'}
                opacity="0.7"
              />
            );
          })}
          {/* Shared walls */}
          {floorPlan.sharedWalls.map((w, i) => (
            <line
              key={`sw-${i}`}
              x1={tx(w.start.x)}
              y1={ty(w.start.y)}
              x2={tx(w.end.x)}
              y2={ty(w.end.y)}
              stroke="#f59e0b"
              strokeWidth="3"
              opacity="0.5"
            />
          ))}
          {/* Corridor centreline */}
          {floorPlan.spine.centreline.length >= 2 && (
            <path
              d={floorPlan.spine.centreline
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x)} ${ty(p.y)}`)
                .join(' ')}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="2"
              strokeDasharray="8 4"
            />
          )}
          {/* Validation errors badge */}
          {!floorPlan.validation.valid && (
            <text x={padding} y={24} fill="#ef4444" style={{ fontSize: '11px', fontWeight: 700 }}>
              INVALID: {floorPlan.validation.errors.length} errors
            </text>
          )}
          {/* Multi-layer engine debug: mission family + geometry path */}
          <text x={padding} y={floorPlan.validation.valid ? 24 : 40} fill="#a78bfa" style={{ fontSize: '10px', fontWeight: 600 }}>
            {String(floorPlan.missionGraph?.family ?? floorPlan.debug?.missionFamily ?? 'legacy')}
            {' · '}
            {String(floorPlan.debug?.geometryEngine ?? '?')}
            {floorPlan.fingerprint ? ` · fp:${floorPlan.fingerprint.missionGraphFamily}` : ''}
          </text>
        </g>
      )}

      {/* Compass */}
      <g>
        <circle cx={compassCx} cy={compassCy} r={compassR + 6} fill="rgba(15, 23, 42, 0.85)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <circle cx={compassCx} cy={compassCy} r={compassR} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        <text x={compassCx} y={compassCy - compassR + 1} textAnchor="middle"
          fill={entranceDirection === 'N' ? '#a78bfa' : '#64748b'}
          style={{ fontSize: entranceDirection === 'N' ? '11px' : '9px', fontWeight: entranceDirection === 'N' ? 800 : 500 }}>N</text>
        <text x={compassCx} y={compassCy + compassR + 1} textAnchor="middle"
          fill={entranceDirection === 'S' ? '#a78bfa' : '#64748b'}
          style={{ fontSize: entranceDirection === 'S' ? '11px' : '9px', fontWeight: entranceDirection === 'S' ? 800 : 500 }}>S</text>
        <text x={compassCx + compassR + 1} y={compassCy + 3} textAnchor="middle"
          fill={entranceDirection === 'E' ? '#a78bfa' : '#64748b'}
          style={{ fontSize: entranceDirection === 'E' ? '11px' : '9px', fontWeight: entranceDirection === 'E' ? 800 : 500 }}>E</text>
        <text x={compassCx - compassR - 1} y={compassCy + 3} textAnchor="middle"
          fill={entranceDirection === 'W' ? '#a78bfa' : '#64748b'}
          style={{ fontSize: entranceDirection === 'W' ? '11px' : '9px', fontWeight: entranceDirection === 'W' ? 800 : 500 }}>W</text>
        <polygon
          points={`${compassCx},${compassCy - 14} ${compassCx - 4},${compassCy - 6} ${compassCx + 4},${compassCy - 6}`}
          fill={entranceDirection === 'N' ? '#8b5cf6' : '#ef4444'}
          opacity="0.8"
        />
        <circle cx={compassCx} cy={compassCy} r="2.5" fill="#ef4444" />
      </g>

      {/* Unit legend — mirrors sidebar area unit selection */}
      {(() => {
        const boxW = areaUnit === 'both' ? 200 : 148;
        const boxH = floorPlan ? 44 : 28;
        const boxX = 20;
        const boxY = height - boxH - 20;
        return (
          <g>
            <rect
              x={boxX}
              y={boxY}
              width={boxW}
              height={boxH}
              rx={8}
              fill="rgba(12, 14, 18, 0.82)"
              stroke="rgba(255,255,255,0.08)"
            />
            <text x={boxX + 12} y={boxY + 18} fill="#93c5fd" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em' }}>
              UNITS · {unitModeLabel(areaUnit)}
            </text>
            {floorPlan && (
              <text x={boxX + 12} y={boxY + 34} fill="#64748b" style={{ fontSize: '9px', fontWeight: 500 }}>
                Outline {formatOutline(floorPlan.outlineW, floorPlan.outlineH, areaUnit)}
              </text>
            )}
          </g>
        );
      })()}
    </svg>
  );
};

function swingArcPath(
  px: number,
  py: number,
  r: number,
  orientation: 'horizontal' | 'vertical',
  entrance: boolean,
): string {
  const start = orientation === 'horizontal' ? 0 : Math.PI / 2;
  const sweep = entrance ? -Math.PI / 2 : Math.PI / 2;
  const a1 = start;
  const a2 = start + sweep;
  const x1 = px + r * Math.cos(a1);
  const y1 = py + r * Math.sin(a1);
  const x2 = px + r * Math.cos(a2);
  const y2 = py + r * Math.sin(a2);
  const large = 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  return `M ${px} ${py} L ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweepFlag} ${x2} ${y2} Z`;
}
