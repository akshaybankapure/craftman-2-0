import React from 'react';
import { Sun, Ruler, GitCommit, Home, Target, Activity, Bug } from 'lucide-react';
import type { EntranceDirection } from '../../planner/types.ts';
import type { RoomType } from '../../types/index.ts';
import type {
  OverrideValue,
  ResolvedStrategy,
  StrategyOverrides,
  StrategyProfile,
} from '../../planner/strategy/architecturalStrategy.ts';
import { OVERRIDE_KEYS } from '../../planner/strategy/strategyResolver.ts';
import { metricDef, type MetricKey } from '../../planner/optimize/metrics.ts';

interface Props {
  strategy: ResolvedStrategy;
  overrides: StrategyOverrides;
  onOverride: (key: string, value: OverrideValue) => void;
  onReset: (key: string) => void;
}

const DIRECTIONS: EntranceDirection[] = ['N', 'E', 'S', 'W'];
const PROFILES: StrategyProfile[] = ['balanced', 'daylight', 'privacy', 'compact'];
const ASPECT_ROOMS: Array<{ room: RoomType; label: string }> = [
  { room: 'living', label: 'Living' },
  { room: 'bedroom', label: 'Bedroom' },
  { room: 'kitchen', label: 'Kitchen' },
  { room: 'bathroom', label: 'Bathroom' },
  { room: 'foyer', label: 'Foyer' },
];

/**
 * Advanced Generation Settings — collapsed by default. Every control is
 * Auto by default (driven by the resolved strategy); overriding one field
 * pins only that field and switches the strategy to hybrid mode.
 */
export const AdvancedGenerationSettings: React.FC<Props> = ({
  strategy,
  overrides,
  onOverride,
  onReset,
}) => {
  const manual = (key: string) => strategy.manuallyOverriddenFields.includes(key);

  const badge = (isManual: boolean) => (
    <span
      style={{
        fontSize: '0.58rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: isManual ? '#fbbf24' : '#34d399',
        background: isManual ? 'rgba(251, 191, 36, 0.10)' : 'rgba(52, 211, 153, 0.10)',
        border: `1px solid ${isManual ? 'rgba(251, 191, 36, 0.35)' : 'rgba(52, 211, 153, 0.35)'}`,
        borderRadius: 5,
        padding: '1px 6px',
        flexShrink: 0,
      }}
    >
      {isManual ? 'Manual' : 'Auto'}
    </span>
  );

  const rowStyle: React.CSSProperties = {
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  };

  const labelRow = (label: string, autoText: string, key: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {!manual(key) && <span style={{ fontSize: '0.66rem', color: '#64748b' }}>{autoText}</span>}
        {badge(manual(key))}
        {manual(key) && (
          <button
            type="button"
            className="chip"
            style={{ fontSize: '0.6rem', padding: '2px 8px' }}
            onClick={() => onReset(key)}
          >
            Reset to Auto
          </button>
        )}
      </span>
    </div>
  );

  const overrideHint = (key: string, start: () => void) =>
    !manual(key) ? (
      <button type="button" className="chip" style={{ fontSize: '0.62rem' }} onClick={start}>
        Override
      </button>
    ) : null;

  const warningFor = (fragment: string) =>
    strategy.warnings.find(w => w.toLowerCase().includes(fragment.toLowerCase()));

  const boolEditor = (key: string, value: boolean) => (
    <div className="chip-row">
      {[true, false].map(v => (
        <button
          key={String(v)}
          type="button"
          className={`chip${value === v ? ' primary' : ''}`}
          onClick={() => onOverride(key, v)}
        >
          {v ? 'On' : 'Off'}
        </button>
      ))}
    </div>
  );

  const sliderEditor = (key: string, value: number, min: number, max: number, step: number, format: (v: number) => string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onOverride(key, parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: '0.7rem', color: '#93c5fd', minWidth: 44, textAlign: 'right' }}>{format(value)}</span>
    </div>
  );

  const subsection = (icon: React.ReactNode, title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <p style={{ color: '#64748b', fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {title}
      </p>
      {children}
    </div>
  );

  // ── Current (auto or pinned) values ────────────────────────────────────
  const facadeKey = OVERRIDE_KEYS.daylightFacades;
  const facades = (overrides[facadeKey] as EntranceDirection[] | undefined) ?? strategy.daylight.preferredFacades;
  const kitchenKey = OVERRIDE_KEYS.kitchenExteriorRequired;
  const kitchenRequired = (overrides[kitchenKey] as boolean | undefined) ?? strategy.daylight.requiredRoomTypes.includes('kitchen');
  const corridorKey = OVERRIDE_KEYS.corridorLimit;
  const corridorLimit = (overrides[corridorKey] as number | undefined) ?? strategy.geometry.corridorAreaLimitPercent;
  const privacyKey = OVERRIDE_KEYS.privacyFacade;
  const privacyFacade = (overrides[privacyKey] as boolean | undefined) ?? strategy.privacy.keepBedroomsAwayFromEntranceFacade;
  const profileKey = OVERRIDE_KEYS.profile;
  const profile = (overrides[profileKey] as StrategyProfile | undefined) ?? strategy.optimisation.profile;
  const wetKey = OVERRIDE_KEYS.wetCluster;
  const wetCluster = (overrides[wetKey] as boolean | undefined) ?? strategy.wetZones.clusterWetRooms;

  const toggleFacade = (d: EntranceDirection) => {
    const has = facades.includes(d);
    onOverride(facadeKey, has ? facades.filter(x => x !== d) : [...facades, d]);
  };

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      {subsection(<Sun size={11} />, 'DAYLIGHT & FAÇADE', (
        <>
          <div style={rowStyle}>
            {labelRow('Preferred daylight façades', facades.join(' / ') || 'any', facadeKey)}
            {manual(facadeKey) ? (
              <div className="chip-row">
                {DIRECTIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`chip${facades.includes(d) ? ' primary' : ''}`}
                    onClick={() => toggleFacade(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : (
              overrideHint(facadeKey, () => onOverride(facadeKey, [...facades]))
            )}
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            {labelRow('Kitchen exterior exposure required', kitchenRequired ? 'On' : 'Off', kitchenKey)}
            {manual(kitchenKey) ? boolEditor(kitchenKey, kitchenRequired) : overrideHint(kitchenKey, () => onOverride(kitchenKey, !kitchenRequired))}
          </div>
        </>
      ))}

      {subsection(<Ruler size={11} />, 'ROOM GEOMETRY', (
        <>
          {ASPECT_ROOMS.map(({ room, label }, i) => {
            const key = OVERRIDE_KEYS.aspectRatio(room);
            const hard = strategy.geometry.hardAspectRatioByRoomType[room] ?? 3;
            const auto = strategy.geometry.maximumAspectRatioByRoomType[room] ?? 2;
            const value = (overrides[key] as number | undefined) ?? auto;
            const warn = warningFor(`${room} aspect`);
            return (
              <div key={room} style={{ ...rowStyle, borderBottom: i === ASPECT_ROOMS.length - 1 ? 'none' : rowStyle.borderBottom }}>
                {labelRow(`Max ${label.toLowerCase()} aspect ratio`, `${auto.toFixed(1)}:1`, key)}
                {manual(key)
                  ? sliderEditor(key, value, 1.4, hard, 0.1, v => `${v.toFixed(1)}:1`)
                  : overrideHint(key, () => onOverride(key, auto))}
                {manual(key) && <p style={{ fontSize: '0.6rem', color: '#64748b', marginTop: 2 }}>Hard maximum {hard.toFixed(1)}:1 — never exceeded silently.</p>}
                {manual(key) && warn && <p style={{ fontSize: '0.62rem', color: '#fbbf24', marginTop: 3 }}>{warn}</p>}
              </div>
            );
          })}
        </>
      ))}

      {subsection(<GitCommit size={11} />, 'CIRCULATION', (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          {labelRow(
            'Max corridor share of carpet',
            `≤ ${strategy.geometry.corridorAreaLimitPercent}% (target ≈ ${strategy.geometry.corridorAreaTargetPercent}%)`,
            corridorKey,
          )}
          {manual(corridorKey)
            ? sliderEditor(corridorKey, corridorLimit, 3, 14, 0.5, v => `${v.toFixed(1)}%`)
            : overrideHint(corridorKey, () => onOverride(corridorKey, strategy.geometry.corridorAreaLimitPercent))}
          {manual(corridorKey) && warningFor('corridor limit') && (
            <p style={{ fontSize: '0.62rem', color: '#fbbf24', marginTop: 3 }}>{warningFor('corridor limit')}</p>
          )}
        </div>
      ))}

      {subsection(<Home size={11} />, 'PRIVACY', (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          {labelRow('Keep bedrooms off entrance façade', privacyFacade ? 'On' : 'Off', privacyKey)}
          {manual(privacyKey) ? boolEditor(privacyKey, privacyFacade) : overrideHint(privacyKey, () => onOverride(privacyKey, !privacyFacade))}
          <p style={{ fontSize: '0.6rem', color: '#64748b', marginTop: 3 }}>
            Privacy is scored on access depth and door visibility — a façade-touching bedroom is allowed when its door stays screened.
          </p>
        </div>
      ))}

      {subsection(<Target size={11} />, 'OPTIMISATION STRATEGY', (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          {labelRow('Optimisation profile', profile, profileKey)}
          {manual(profileKey) ? (
            <div className="chip-row">
              {PROFILES.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`chip${profile === p ? ' primary' : ''}`}
                  onClick={() => onOverride(profileKey, p)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : (
            overrideHint(profileKey, () => onOverride(profileKey, profile))
          )}
          <p style={{ fontSize: '0.6rem', color: '#64748b', marginTop: 3 }}>
            Hard validity (containment, overlaps, min sizes, legal circulation, doors, connectivity) is always enforced first and cannot be reordered.
          </p>
        </div>
      ))}

      {subsection(<Activity size={11} />, 'WET-ZONE & PLUMBING', (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          {labelRow('Cluster bathrooms & kitchen (shared plumbing walls)', wetCluster ? 'On' : 'Off', wetKey)}
          {manual(wetKey) ? boolEditor(wetKey, wetCluster) : overrideHint(wetKey, () => onOverride(wetKey, !wetCluster))}
        </div>
      ))}

      {subsection(<Bug size={11} />, 'DEVELOPER DIAGNOSTICS', (
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.62rem', color: '#64748b', lineHeight: 1.6 }}>
          <p>mode: {strategy.mode} · profile: {strategy.optimisation.profile}</p>
          <p>priorities: {strategy.optimisation.lexicographicPriorities.map(k => metricDef(k).short).join(' → ')}</p>
          <p>
            weights: {Object.entries(strategy.optimisation.weights)
              .filter(([, w]) => w !== 1)
              .map(([k, w]) => `${metricDef(k as MetricKey).short}×${w}`)
              .join(', ') || 'all 1.0'}
          </p>
          <p>overrides: {strategy.manuallyOverriddenFields.join(', ') || 'none'}</p>
          <p>assumptions: {strategy.assumptions.length} · warnings: {strategy.warnings.length}</p>
        </div>
      ))}
    </div>
  );
};
