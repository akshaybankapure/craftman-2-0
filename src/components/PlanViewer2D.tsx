import React from 'react';
import type { FloorGraph, Vec2 } from '../types/index';
import { polygonArea } from '../geometry/vec2';
import type { EntranceDirection } from '../planner/ProgramBuilder';

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
  flowData?: {
    pathLengths: Map<string, number>;
  } | null;
  entranceDirection?: EntranceDirection;
  roomColors?: Record<string, RoomColorDef>;
}

const DEFAULT_COLORS: Record<string, RoomColorDef> = {
  living:   { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: '#fbbf24' },
  kitchen:  { bg: 'rgba(16, 185, 129, 0.12)', border: '#10b981', label: '#34d399' },
  bedroom:  { bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6', label: '#60a5fa' },
  bathroom: { bg: 'rgba(6, 182, 212, 0.12)',  border: '#06b6d4', label: '#22d3ee' },
  corridor: { bg: 'rgba(100, 116, 139, 0.08)', border: '#64748b', label: '#94a3b8' },
  entry:    { bg: 'rgba(139, 92, 246, 0.12)', border: '#8b5cf6', label: '#a78bfa' },
};

export const PlanViewer2D: React.FC<PlanViewer2DProps> = ({ 
  graph, 
  width, 
  height,
  showGraphOverlay = false,
  flowData = null,
  entranceDirection = 'S',
  roomColors,
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

  // Compute room centroids
  const faceCentroids = new Map<string, Vec2>();
  for (const [faceId, face] of graph.faces) {
    const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    faceCentroids.set(faceId, { x: cx, y: cy });
  }

  // Count room types for labeling (Bedroom 1, Bedroom 2, etc.)
  const typeCounters = new Map<string, number>();
  const typeTotals = new Map<string, number>();
  for (const face of graph.faces.values()) {
    typeTotals.set(face.type, (typeTotals.get(face.type) || 0) + 1);
  }

  // Build dual graph edges for overlay
  const hasEntry = Array.from(graph.faces.values()).some(f => f.type === 'entry');
  const actualShowGraphOverlay = showGraphOverlay && hasEntry;

  const faceEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (actualShowGraphOverlay) {
    const edgeToFaces = new Map<string, string[]>();
    for (const [faceId, face] of graph.faces) {
      const loop = face.loop;
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const v1 = loop[i];
        const v2 = loop[(i + 1) % n];
        const sortedEdgeKey = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
        for (const [edgeId, edge] of graph.edges) {
          const ea = edge.a;
          const eb = edge.b;
          const eKey = ea < eb ? `${ea}-${eb}` : `${eb}-${ea}`;
          if (eKey === sortedEdgeKey) {
            const list = edgeToFaces.get(edgeId) ?? [];
            list.push(faceId);
            edgeToFaces.set(edgeId, list);
            break;
          }
        }
      }
    }
    for (const [_, faces] of edgeToFaces) {
      if (faces.length === 2) {
        const [fa, fb] = faces;
        const cA = faceCentroids.get(fa)!;
        const cB = faceCentroids.get(fb)!;
        faceEdges.push({
          x1: tx(cA.x), y1: ty(cA.y),
          x2: tx(cB.x), y2: ty(cB.y),
        });
      }
    }
  }

  // Compass rose position (top-right of viewport)
  const compassCx = width - 60;
  const compassCy = 80;
  const compassR = 28;

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
        <filter id="roomGlow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* ── Color-coded Room Faces ── */}
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

        // Compute room dimensions
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const roomW = Math.max(...xs) - Math.min(...xs);
        const roomH = Math.max(...ys) - Math.min(...ys);

        // Label: "Bedroom 1" if there are multiple bedrooms, just "Bedroom" if only one
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
            {/* Room type label */}
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
            {/* Area + dimensions */}
            <text 
              x={cx} y={actualShowGraphOverlay ? cy + 26 : cy + 10} 
              textAnchor="middle" 
              fill="#94a3b8" 
              style={{ fontSize: '9px', fontWeight: 500 }}
            >
              {area.toFixed(1)}m²
            </text>
            <text 
              x={cx} y={actualShowGraphOverlay ? cy + 38 : cy + 22} 
              textAnchor="middle" 
              fill="#64748b" 
              style={{ fontSize: '7.5px' }}
            >
              {roomW.toFixed(1)}m × {roomH.toFixed(1)}m
            </text>
          </g>
        );
      })}

      {/* ── Wall Edges ── */}
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

      {/* ── Wall Junction Vertices ── */}
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

      {/* ── Entry Door Arc ── */}
      {Array.from(graph.faces.values())
        .filter(f => f.type === 'entry')
        .map(face => {
          const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
          const xs = pts.map(p => p.x);
          const ys = pts.map(p => p.y);
          const roomMinX = Math.min(...xs);
          const roomMaxX = Math.max(...xs);
          const roomMinY = Math.min(...ys);
          const roomMaxY = Math.max(...ys);

          // Place door arc on the entrance edge
          let doorX: number, doorY: number, startAngle: number;
          const doorSize = 12;
          switch (entranceDirection) {
            case 'S':
              doorX = tx((roomMinX + roomMaxX) / 2);
              doorY = ty(roomMaxY);
              startAngle = 0;
              break;
            case 'N':
              doorX = tx((roomMinX + roomMaxX) / 2);
              doorY = ty(roomMinY);
              startAngle = 180;
              break;
            case 'E':
              doorX = tx(roomMaxX);
              doorY = ty((roomMinY + roomMaxY) / 2);
              startAngle = 270;
              break;
            case 'W':
              doorX = tx(roomMinX);
              doorY = ty((roomMinY + roomMaxY) / 2);
              startAngle = 90;
              break;
          }

          // Draw 90° arc
          const a1 = (startAngle * Math.PI) / 180;
          const a2 = ((startAngle + 90) * Math.PI) / 180;
          const x1 = doorX + doorSize * Math.cos(a1);
          const y1 = doorY + doorSize * Math.sin(a1);
          const x2 = doorX + doorSize * Math.cos(a2);
          const y2 = doorY + doorSize * Math.sin(a2);

          return (
            <g key="door-arc">
              <path
                d={`M ${doorX} ${doorY} L ${x1} ${y1} A ${doorSize} ${doorSize} 0 0 1 ${x2} ${y2} Z`}
                fill="rgba(139, 92, 246, 0.15)"
                stroke="#8b5cf6"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
              {/* Small door opening line */}
              <line
                x1={doorX - 6} y1={doorY}
                x2={doorX + 6} y2={doorY}
                stroke="#8b5cf6"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          );
        })}

      {/* ── Dual Graph Adjacency Overlay ── */}
      {actualShowGraphOverlay && faceEdges.map((fe, i) => (
        <line
          key={`dual-edge-${i}`}
          x1={fe.x1} y1={fe.y1}
          x2={fe.x2} y2={fe.y2}
          stroke="#10b981"
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.7"
        />
      ))}

      {/* ── Dual Graph Centrality Nodes ── */}
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
              style={{ filter: `drop-shadow(0 0 4px ${nodeColor})` }}
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

      {/* ── Compass Rose ── */}
      <g>
        {/* Background circle */}
        <circle cx={compassCx} cy={compassCy} r={compassR + 6} fill="rgba(15, 23, 42, 0.85)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <circle cx={compassCx} cy={compassCy} r={compassR} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        
        {/* Cross lines */}
        <line x1={compassCx} y1={compassCy - compassR + 4} x2={compassCx} y2={compassCy + compassR - 4} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <line x1={compassCx - compassR + 4} y1={compassCy} x2={compassCx + compassR - 4} y2={compassCy} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        {/* N */}
        <text x={compassCx} y={compassCy - compassR + 1} textAnchor="middle" 
          fill={entranceDirection === 'N' ? '#a78bfa' : '#64748b'} 
          style={{ fontSize: entranceDirection === 'N' ? '11px' : '9px', fontWeight: entranceDirection === 'N' ? 800 : 500 }}>
          N
        </text>
        {entranceDirection === 'N' && <circle cx={compassCx} cy={compassCy - compassR + 6} r="2" fill="#8b5cf6" />}

        {/* S */}
        <text x={compassCx} y={compassCy + compassR + 1} textAnchor="middle" 
          fill={entranceDirection === 'S' ? '#a78bfa' : '#64748b'} 
          style={{ fontSize: entranceDirection === 'S' ? '11px' : '9px', fontWeight: entranceDirection === 'S' ? 800 : 500 }}>
          S
        </text>
        {entranceDirection === 'S' && <circle cx={compassCx} cy={compassCy + compassR - 4} r="2" fill="#8b5cf6" />}

        {/* E */}
        <text x={compassCx + compassR + 1} y={compassCy + 3} textAnchor="middle" 
          fill={entranceDirection === 'E' ? '#a78bfa' : '#64748b'} 
          style={{ fontSize: entranceDirection === 'E' ? '11px' : '9px', fontWeight: entranceDirection === 'E' ? 800 : 500 }}>
          E
        </text>
        {entranceDirection === 'E' && <circle cx={compassCx + compassR - 4} cy={compassCy} r="2" fill="#8b5cf6" />}

        {/* W */}
        <text x={compassCx - compassR - 1} y={compassCy + 3} textAnchor="middle" 
          fill={entranceDirection === 'W' ? '#a78bfa' : '#64748b'} 
          style={{ fontSize: entranceDirection === 'W' ? '11px' : '9px', fontWeight: entranceDirection === 'W' ? 800 : 500 }}>
          W
        </text>
        {entranceDirection === 'W' && <circle cx={compassCx - compassR + 4} cy={compassCy} r="2" fill="#8b5cf6" />}

        {/* North arrow */}
        <polygon 
          points={`${compassCx},${compassCy - 14} ${compassCx - 4},${compassCy - 6} ${compassCx + 4},${compassCy - 6}`}
          fill={entranceDirection === 'N' ? '#8b5cf6' : '#ef4444'}
          opacity="0.8"
        />
        {/* Center dot */}
        <circle cx={compassCx} cy={compassCy} r="2.5" fill="#ef4444" />
      </g>
    </svg>
  );
};
