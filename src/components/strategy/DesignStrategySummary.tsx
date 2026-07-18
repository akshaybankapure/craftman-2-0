import React from 'react';
import { Zap, ChevronRight, Settings, Sun } from 'lucide-react';
import type { ResolvedStrategy, StrategyPresetId } from '../../planner/strategy/architecturalStrategy.ts';
import { STRATEGY_PRESETS } from '../../planner/strategy/architecturalStrategy.ts';

interface Props {
  strategy: ResolvedStrategy;
  preset: StrategyPresetId;
  onPresetChange: (p: StrategyPresetId) => void;
  advancedOpen: boolean;
  onViewAdvanced: () => void;
  onViewReasoning: () => void;
}

const MODE_BADGE: Record<ResolvedStrategy['mode'], { label: string; color: string; bg: string }> = {
  automatic: { label: 'Auto', color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)' },
  hybrid: { label: 'Hybrid', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)' },
  manual: { label: 'Manual', color: '#f472b6', bg: 'rgba(244, 114, 182, 0.12)' },
};

/**
 * Read-only "DESIGN STRATEGY — Auto · Architect Recommended" card.
 * Replaces the old optimisation controls in the default workflow.
 */
export const DesignStrategySummary: React.FC<Props> = ({
  strategy,
  preset,
  onPresetChange,
  advancedOpen,
  onViewAdvanced,
  onViewReasoning,
}) => {
  const badge = MODE_BADGE[strategy.mode];
  const presetLabel = STRATEGY_PRESETS.find(p => p.id === preset)?.label ?? 'Architect Recommended';

  return (
    <div className="section">
      <p className="section-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Sun size={11} /> Design strategy
        </span>
      </p>

      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '10px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>
            {presetLabel}
          </span>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: badge.color,
              background: badge.bg,
              border: `1px solid ${badge.color}44`,
              borderRadius: 6,
              padding: '2px 7px',
            }}
          >
            {badge.label}
            {strategy.mode !== 'automatic' && ` · ${strategy.manuallyOverriddenFields.length} override${strategy.manuallyOverriddenFields.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {strategy.summary.map((line, i) => (
            <p key={i} style={{ fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.45, display: 'flex', gap: 6 }}>
              <span style={{ color: '#3b82f6', flexShrink: 0 }}>•</span>
              <span>{line}</span>
            </p>
          ))}
        </div>

        {strategy.warnings.length > 0 && (
          <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {strategy.warnings.map((w, i) => (
              <p
                key={i}
                style={{
                  fontSize: '0.66rem',
                  color: '#fbbf24',
                  background: 'rgba(251, 191, 36, 0.08)',
                  border: '1px solid rgba(251, 191, 36, 0.25)',
                  borderRadius: 8,
                  padding: '6px 8px',
                  lineHeight: 1.45,
                }}
              >
                {w}
              </p>
            ))}
          </div>
        )}

        <div className="chip-row" style={{ marginBottom: 10 }}>
          {STRATEGY_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`chip${preset === p.id ? ' primary' : ''}`}
              onClick={() => onPresetChange(p.id)}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="btn-secondary" onClick={onViewAdvanced}>
            <Settings size={13} />
            {advancedOpen ? 'Hide advanced settings' : 'View advanced settings'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onViewReasoning}
            style={{ justifyContent: 'space-between', color: '#93c5fd' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Zap size={12} /> View detailed reasoning
            </span>
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
