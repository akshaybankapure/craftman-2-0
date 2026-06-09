import React from 'react';
import type { FloorGraph, Vec2 } from '../types/index';
import { polygonArea } from '../geometry/vec2';

interface PlanViewer2DProps {
  graph: FloorGraph;
  width: number;
  height: number;
}

export const PlanViewer2D: React.FC<PlanViewer2DProps> = ({ graph, width, height }) => {
  // Center and scale the graph
  const padding = 40;
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

  return (
    <svg width={width} height={height} style={{ background: 'transparent' }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Faces */}
      {Array.from(graph.faces.values()).map(face => {
        const points = face.loop.map(vId => {
          const v = graph.vertices.get(vId)!;
          return `${tx(v.pos.x)},${ty(v.pos.y)}`;
        }).join(' ');
        
        // Calculate center for label
        const pts = face.loop.map(id => graph.vertices.get(id)!.pos);
        const cx = tx(pts.reduce((s, p) => s + p.x, 0) / pts.length);
        const cy = ty(pts.reduce((s, p) => s + p.y, 0) / pts.length);
        const area = Math.abs(polygonArea(pts));

        return (
          <g key={face.id}>
            <polygon
              points={points}
              fill="rgba(79, 70, 229, 0.05)"
              stroke="rgba(79, 70, 229, 0.3)"
              strokeWidth="1"
            />
            <text 
              x={cx} y={cy - 5} 
              textAnchor="middle" 
              fill="white" 
              style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              {face.type}
            </text>
            <text 
              x={cx} y={cy + 10} 
              textAnchor="middle" 
              fill="#94a3b8" 
              style={{ fontSize: '8px' }}
            >
              {area.toFixed(1)}m²
            </text>
          </g>
        );
      })}

      {/* Edges */}
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
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#glow)"
          />
        );
      })}

      {/* Vertices */}
      {Array.from(graph.vertices.values()).map(v => (
        <circle
          key={v.id}
          cx={tx(v.pos.x)}
          cy={ty(v.pos.y)}
          r="4"
          fill="white"
          stroke="#4f46e5"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
};
