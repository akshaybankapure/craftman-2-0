import React from 'react';
import { Zap } from 'lucide-react';
import type { ResolvedStrategy } from '../../planner/strategy/architecturalStrategy.ts';
import { metricDef } from '../../planner/optimize/metrics.ts';

interface Props {
  strategy: ResolvedStrategy;
  onClose: () => void;
}

/**
 * "View detailed reasoning" dialog — resolved automatic values, assumptions,
 * relaxed preferences, infeasibility warnings and manual overrides.
 * Never shows raw utility weights as numbers to steer by; priorities are
 * shown as readable labels.
 */
export const StrategyReasoningDialog: React.FC<Props> = ({ strategy, onClose }) => {
  const block = (title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 16 }}>
      <p style={{ color: '#93c5fd', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        {title}
      </p>
      {children}
    </div>
  );

  const lines = (items: string[], color = '#94a3b8') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((t, i) => (
        <p key={i} style={{ fontSize: '0.7rem', color, lineHeight: 1.5, display: 'flex', gap: 6 }}>
          <span style={{ color: '#3b82f6', flexShrink: 0 }}>•</span>
          <span>{t}</span>
        </p>
      ))}
    </div>
  );

  const g = strategy.geometry;
  const aspectRows = Object.entries(g.maximumAspectRatioByRoomType).map(([room, v]) => {
    const relaxed = g.relaxedPreferences.some(r => r.startsWith(`${room} aspect`));
    const hard = g.hardAspectRatioByRoomType[room as keyof typeof g.hardAspectRatioByRoomType] ?? 0;
    return `${room}: ${v.toFixed(1)}:1 (hard max ${hard.toFixed(1)})${relaxed ? ' — relaxed' : ''}`;
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4, 6, 10, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: '92vw',
          maxHeight: '82vh',
          overflowY: 'auto',
          background: '#12151a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          padding: '18px 20px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} color="#3b82f6" /> Architect Recommended Strategy
          </p>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 10px' }} onClick={onClose}>
            Close
          </button>
        </div>

        {block('Strategy', lines(strategy.summary, '#cbd5e1'))}

        {block('Resolved automatic values', lines([
          `Daylight façades: ${strategy.daylight.preferredFacades.join(' / ') || 'any exterior'}`,
          `Exterior required: ${strategy.daylight.requiredRoomTypes.join(', ')}${strategy.daylight.preferredRoomTypes.length ? ` · preferred: ${strategy.daylight.preferredRoomTypes.join(', ')}` : ''}`,
          ...aspectRows,
          `Corridor: target ≈ ${g.corridorAreaTargetPercent}%, limit ${g.corridorAreaLimitPercent}%, feasible floor ≈ ${g.corridorAreaFloorPercent}%`,
          `Corridor width: ${g.corridorWidthRange.minimum}–${g.corridorWidthRange.maximum} m (preferred ${g.corridorWidthRange.preferred} m)`,
          `Privacy depth: bedroom ${strategy.privacy.preferredDepthByRoomType.bedroom} · living ${strategy.privacy.preferredDepthByRoomType.living} (graph steps from entry)`,
          `Profile: ${strategy.optimisation.profile} · priority: ${strategy.optimisation.lexicographicPriorities.map(k => metricDef(k).label).join(' → ')}`,
          `Wet zones: ${strategy.wetZones.clusterWetRooms ? 'clustered' : 'free'} · shared plumbing walls ${strategy.wetZones.preferSharedPlumbingWalls ? 'preferred' : 'optional'} · max separation ${strategy.wetZones.maximumPlumbingSeparation} m`,
        ]))}

        {block('Daylight reasoning', lines(strategy.daylight.reasoning))}

        {strategy.geometry.relaxedPreferences.length > 0 &&
          block('Relaxed preferences', lines(strategy.geometry.relaxedPreferences, '#fbbf24'))}

        {strategy.assumptions.length > 0 && block('Assumptions', lines(strategy.assumptions))}

        {strategy.warnings.length > 0 && block('Infeasibility warnings', lines(strategy.warnings, '#fbbf24'))}

        {strategy.manuallyOverriddenFields.length > 0 &&
          block('Manual overrides', lines(strategy.manuallyOverriddenFields, '#f472b6'))}

        {block('Entrance visibility rules', lines(strategy.privacy.entranceVisibilityRules))}
      </div>
    </div>
  );
};
