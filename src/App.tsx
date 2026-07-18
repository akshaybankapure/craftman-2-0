import React, { useMemo, useState } from 'react';
import {
  Layers, Zap, Download, ChevronRight, ChevronLeft, Trophy, Activity,
  GitCommit, Home, Settings, Box, Bug, Ruler, Building2, Trees, LayoutGrid,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlanViewer2D } from './components/PlanViewer2D';
import { MassingViewer3D } from './components/MassingViewer3D';
import { DesignStrategySummary } from './components/strategy/DesignStrategySummary';
import { AdvancedGenerationSettings } from './components/strategy/AdvancedGenerationSettings';
import { StrategyReasoningDialog } from './components/strategy/StrategyReasoningDialog';
import { type EntranceDirection } from './planner/ProgramBuilder';
import { generateFloorPlanOptions, floorPlanToSolveProblem } from './planner/ProgramBuilder';
import { buildFromSpecTopologyFirst } from './planner/generateFloorPlan';
import { flowInfoFromPlan } from './optimizer/objectives';
import type { FloorPlan } from './planner/types';
import {
  METRIC_DEFS,
  formatMetricRaw,
  getMetricRaw,
  metricDef,
  metricQualityPercent,
  sortPlansByPriority,
} from './planner/optimize/metrics';
import { rescorePlan } from './planner/optimize/validPlanOptimizer';
import {
  resolveArchitecturalStrategy,
  designPrefsFromStrategy,
  withOverride,
  withoutOverride,
} from './planner/strategy/strategyResolver';
import type {
  OverrideValue,
  StrategyOverrides,
  StrategyPresetId,
} from './planner/strategy/architecturalStrategy';
import {
  AREA_UNIT_OPTIONS,
  type AreaUnitMode,
  formatArea,
  formatLength,
  formatOutline,
  m2ToSqft,
  sqftToM2,
} from './planner/units';
import {
  BHK_OPTIONS,
  TYPOLOGY_OPTIONS,
  availableVariants,
  defaultBathroomCount,
  defaultCarpetM2,
  programSpecFromTemplate,
  resolveTemplate,
  withBathroomCount,
  type BuildingTypology,
  type TemplateVariant,
} from './planner/typology';
import { createDefaultUnitMix, resolveUnitMix } from './domain/unitMix';

const ROOM_COLORS: Record<string, { bg: string; border: string; label: string }> = {
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
  storage:  { bg: 'rgba(161, 161, 170, 0.10)', border: '#a1a1aa', label: '#d4d4d8' },
  office:   { bg: 'rgba(236, 72, 153, 0.12)', border: '#ec4899', label: '#f472b6' },
};

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('debug')) return true;
  const meta = import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } };
  if (meta.env?.DEV || meta.env?.MODE === 'development') return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

const DIRECTION_LABELS: Record<EntranceDirection, string> = {
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'2d' | '3d'>('2d');
  const [typology, setTypology] = useState<BuildingTypology>('apartment');
  const [bhk, setBhk] = useState<number>(2);
  const [variant, setVariant] = useState<TemplateVariant>('standard');
  /** Always stored in m² — display converts via areaUnit */
  const [carpetAreaM2, setCarpetAreaM2] = useState(() =>
    defaultCarpetM2('apartment', resolveTemplate(2, 'standard')),
  );
  const [areaUnit, setAreaUnit] = useState<AreaUnitMode>('sqft');
  const [entranceDir, setEntranceDir] = useState<EntranceDirection>('S');
  const [bathrooms, setBathrooms] = useState(() => defaultBathroomCount(resolveTemplate(2, 'standard')));
  const [exactEnvelope, setExactEnvelope] = useState<{ w: number; h: number } | null>(null);
  const [wantsBalcony, setWantsBalcony] = useState(false);
  const [wantsUtility, setWantsUtility] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [candidates, setCandidates] = useState<FloorPlan[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSolving, setIsSolving] = useState(false);
  const [telemetry, setTelemetry] = useState<string[]>(['[system] typology-first studio ready']);
  /** Strategy layer state: a high-level preset + pinned per-field overrides. */
  const [strategyPreset, setStrategyPreset] = useState<StrategyPresetId>('recommended');
  const [overrides, setOverrides] = useState<StrategyOverrides>({});
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const debugEnabled = isDebugEnabled();

  const template = useMemo(() => resolveTemplate(bhk, variant), [bhk, variant]);
  const variants = useMemo(() => availableVariants(bhk), [bhk]);
  const canGenerate = typology !== 'multi_unit';

  const mixPreview = useMemo(() => {
    try {
      return resolveUnitMix(createDefaultUnitMix());
    } catch {
      return null;
    }
  }, []);

  const spec = useMemo(
    () => withBathroomCount(
      programSpecFromTemplate(template, carpetAreaM2, typology === 'multi_unit' ? 'apartment' : typology),
      bathrooms,
    ),
    [template, carpetAreaM2, typology, bathrooms],
  );

  const autoEnvelope = useMemo(() => {
    const aspect = typology === 'house' ? 1.15 : 1.3;
    const h = Math.sqrt(carpetAreaM2 / aspect);
    const w = carpetAreaM2 / h;
    return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
  }, [carpetAreaM2, typology]);

  const outlineW = exactEnvelope?.w ?? autoEnvelope.w;
  const outlineH = exactEnvelope?.h ?? autoEnvelope.h;

  // ── Architectural strategy: resolved automatically from basic inputs.
  //    Manual overrides stay pinned across input changes (hybrid mode). ──
  const strategy = useMemo(
    () => resolveArchitecturalStrategy({
      spec,
      bhk,
      carpetAreaM2,
      outlineW,
      outlineH,
      entranceDir,
      bathroomCount: bathrooms,
      typology: typology === 'multi_unit' ? 'apartment' : typology,
      hasBalcony: wantsBalcony,
      hasUtility: wantsUtility,
      preset: strategyPreset,
      overrides,
    }),
    [spec, bhk, carpetAreaM2, outlineW, outlineH, entranceDir, bathrooms, typology, wantsBalcony, wantsUtility, strategyPreset, overrides],
  );

  const designPrefs = useMemo(() => designPrefsFromStrategy(strategy), [strategy]);
  const metricPriority = strategy.optimisation.lexicographicPriorities;
  const metricWeights = strategy.optimisation.weights;
  const primaryKey = metricPriority[0] ?? 'areaError';

  const strategyKey = useMemo(
    () => JSON.stringify({ d: designPrefs, p: metricPriority, w: metricWeights }),
    [designPrefs, metricPriority, metricWeights],
  );

  const defaultPlan = useMemo(() => {
    if (!canGenerate) return null;
    const { plan } = buildFromSpecTopologyFirst(spec, outlineW, outlineH, entranceDir, 42);
    return plan ? rescorePlan(plan, designPrefs) : plan;
  }, [spec, outlineW, outlineH, entranceDir, designPrefs, canGenerate]);

  const activePlan = candidates.length > 0
    ? candidates[Math.min(selectedIndex, candidates.length - 1)]
    : defaultPlan;

  const activeGraph = useMemo(() => {
    if (!activePlan) {
      return { vertices: new Map(), edges: new Map(), faces: new Map() };
    }
    return floorPlanToSolveProblem(activePlan).graph;
  }, [activePlan]);

  const activeFlowData = useMemo(() => {
    if (!activePlan) return null;
    return flowInfoFromPlan(activePlan);
  }, [activePlan]);

  // Re-score and re-rank candidates whenever the resolved strategy changes.
  React.useEffect(() => {
    if (candidates.length === 0) return;
    const current = candidates[Math.min(selectedIndex, candidates.length - 1)];
    const rescored = candidates.map(p => rescorePlan(p, designPrefs));
    const sorted = sortPlansByPriority(rescored, metricPriority, metricWeights);
    const nextIdx = current
      ? Math.max(0, sorted.findIndex(p => p.seed === current.seed))
      : 0;
    setCandidates(sorted);
    setSelectedIndex(nextIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyKey]);

  const carpetMax = typology === 'house' ? 250 : 200;

  const setCarpetFromM2 = (m2: number) => {
    setCarpetAreaM2(Math.max(28, Math.min(carpetMax, Math.round(m2))));
    setCandidates([]);
  };

  const applyTypology = (next: BuildingTypology) => {
    setTypology(next);
    setCandidates([]);
    const t = resolveTemplate(bhk, variant);
    const carpet = defaultCarpetM2(next === 'multi_unit' ? 'apartment' : next, t);
    setCarpetAreaM2(carpet);
    setBathrooms(defaultBathroomCount(t));
    setTelemetry(prev => [...prev.slice(-5), `[typology] ${next.replace('_', ' ')}`]);
  };

  const applyBhk = (next: number) => {
    setBhk(next);
    const vars = availableVariants(next);
    const nextVariant = vars.includes(variant) ? variant : vars[0] ?? 'standard';
    setVariant(nextVariant);
    const t = resolveTemplate(next, nextVariant);
    setCarpetAreaM2(defaultCarpetM2(typology === 'multi_unit' ? 'apartment' : typology, t));
    setBathrooms(defaultBathroomCount(t));
    setCandidates([]);
    setTelemetry(prev => [...prev.slice(-5), `[config] ${next} BHK · ${nextVariant}`]);
  };

  const applyVariant = (next: TemplateVariant) => {
    setVariant(next);
    const t = resolveTemplate(bhk, next);
    setCarpetAreaM2(defaultCarpetM2(typology === 'multi_unit' ? 'apartment' : typology, t));
    setBathrooms(defaultBathroomCount(t));
    setCandidates([]);
  };

  const handleOverride = (key: string, value: OverrideValue) => {
    setOverrides(o => withOverride(o, key, value));
    setCandidates([]);
  };

  const handleResetOverride = (key: string) => {
    setOverrides(o => withoutOverride(o, key));
    setCandidates([]);
  };

  const carpetInputValue = areaUnit === 'sqft'
    ? Math.round(m2ToSqft(carpetAreaM2))
    : carpetAreaM2;

  const onCarpetNumberChange = (raw: number) => {
    if (areaUnit === 'sqft') setCarpetFromM2(sqftToM2(raw));
    else setCarpetFromM2(raw);
  };

  const runGenerate = (selectBest: boolean) => {
    if (!canGenerate) {
      setTelemetry(prev => [...prev, '[info] multi-unit floor plates coming next — pick Apartment or House for now']);
      return;
    }
    setIsSolving(true);
    setTelemetry(prev => [
      ...prev,
      `[topo] ${typology} · ${template.name} · ${strategy.optimisation.profile} strategy`,
    ]);

    setTimeout(() => {
      const result = generateFloorPlanOptions(spec, outlineW, outlineH, entranceDir, {
        seeds: 72,
        retain: 6,
        baseSeed: Date.now() % 100000,
        optimizeIterations: 35,
        metricPriority,
        metricWeights,
        designPrefs,
      });

      if (result.infeasible && result.plans.length === 0) {
        setCandidates([]);
        setTelemetry(prev => [...prev, `[error] ${result.infeasible}`]);
      } else {
        setCandidates(result.plans);
        setSelectedIndex(0);
        setTelemetry(prev => [
          ...prev,
          `[topo] ${result.validCount} valid / ${result.attempts} seeds → ${result.plans.length} options`,
          selectBest
            ? `[ai] best by ${metricDef(primaryKey).label}`
            : `[rank] ordered by ${metricDef(primaryKey).label}`,
        ]);
      }
      setIsSolving(false);
    }, 50);
  };

  const handleGenerativeRun = () => runGenerate(false);

  const handleSelectBest = () => {
    if (candidates.length === 0) {
      runGenerate(true);
      return;
    }
    const sorted = sortPlansByPriority(candidates, metricPriority, metricWeights);
    setCandidates(sorted);
    setSelectedIndex(0);
    setTelemetry(prev => [
      ...prev,
      `[ai] selected Option 1 — ${metricDef(primaryKey).label} ${formatMetricRaw(primaryKey, getMetricRaw(sorted[0], primaryKey))}`,
    ]);
  };

  const dirBtnStyle = (dir: EntranceDirection): React.CSSProperties => ({
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: entranceDir === dir ? 'rgba(59, 130, 246, 0.22)' : 'rgba(255,255,255,0.03)',
    border: entranceDir === dir ? '1px solid rgba(59, 130, 246, 0.55)' : '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: entranceDir === dir ? '#93c5fd' : '#64748b',
    fontSize: '0.7rem',
    fontWeight: 700,
    cursor: 'pointer',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: 'white',
    fontSize: '0.85rem',
    outline: 'none',
  };

  const bathroomOptions = Array.from({ length: Math.min(4, bhk + 1) }, (_, i) => i + 1);

  return (
    <div className="layout">
      <aside className="sidebar glass">
        <div className="brand">
          <div className="brand-mark">
            <Zap size={18} color="white" />
          </div>
          <div>
            <div className="brand-title">Craftman</div>
            <div className="brand-sub">Floorplan Studio</div>
          </div>
        </div>

        <div className="sidebar-scroll">
          <div className="section">
            <p className="section-label">Building type</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TYPOLOGY_OPTIONS.map(opt => {
                const Icon = opt.id === 'apartment' ? Building2 : opt.id === 'house' ? Trees : LayoutGrid;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`seg-btn${typology === opt.id ? ' active' : ''}`}
                    onClick={() => applyTypology(opt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      textAlign: 'left',
                      padding: '10px 12px',
                      opacity: opt.available || typology === opt.id ? 1 : 0.85,
                    }}
                  >
                    <Icon size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem' }}>
                        {opt.label}
                        {!opt.available && (
                          <span style={{ marginLeft: 6, fontSize: '0.62rem', color: '#fbbf24', fontWeight: 600 }}>SOON</span>
                        )}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 400, marginTop: 2 }}>
                        {opt.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {typology === 'multi_unit' ? (
            <div className="section">
              <p className="section-label">Unit mix preview</p>
              <p className="section-hint" style={{ marginBottom: 10 }}>
                Multi-unit floor plates need a dedicated packer (core + unit slots). Preview of a typical Indian mix:
              </p>
              {mixPreview && (
                <>
                  {mixPreview.entries.map(e => (
                    <div key={e.template.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 6, color: '#cbd5e1' }}>
                      <span>{e.count}× {e.template.name}</span>
                      <span style={{ color: '#64748b' }}>{formatArea(e.carpetAreaPerUnit, areaUnit)}</span>
                    </div>
                  ))}
                  <p className="section-hint" style={{ marginTop: 8 }}>
                    Floor carpet ~{formatArea(mixPreview.totals.totalCarpetArea, areaUnit)} · efficiency {(mixPreview.totals.carpetEfficiency * 100).toFixed(0)}%
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="section">
                <p className="section-label">Programme · {template.name}</p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {BHK_OPTIONS.map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`seg-btn${bhk === n ? ' active' : ''}`}
                      onClick={() => applyBhk(n)}
                    >
                      {n} BHK
                    </button>
                  ))}
                </div>
                <p style={{ color: '#64748b', fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                  MARKET TIER
                </p>
                <div className="chip-row">
                  {variants.map(v => (
                    <button
                      key={v}
                      type="button"
                      className={`chip${variant === v ? ' primary' : ''}`}
                      onClick={() => applyVariant(v)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="section-hint">{template.description}</p>
              </div>

              <div className="section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <p className="section-label" style={{ marginBottom: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Ruler size={11} /> Carpet area
                    </span>
                  </p>
                  <div className="chip-row">
                    {AREA_UNIT_OPTIONS.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        className={`chip${areaUnit === u.id ? ' primary' : ''}`}
                        onClick={() => setAreaUnit(u.id)}
                        style={{ padding: '4px 8px', fontSize: '0.68rem' }}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range"
                    min={template.carpetAreaRange.min}
                    max={carpetMax}
                    step={5}
                    value={carpetAreaM2}
                    onChange={e => setCarpetFromM2(parseInt(e.target.value, 10))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={areaUnit === 'sqft' ? Math.round(m2ToSqft(28)) : 28}
                    max={areaUnit === 'sqft' ? Math.round(m2ToSqft(carpetMax)) : carpetMax}
                    step={areaUnit === 'sqft' ? 10 : 1}
                    value={carpetInputValue}
                    onChange={e => onCarpetNumberChange(parseFloat(e.target.value) || carpetAreaM2)}
                    style={{ ...inputStyle, width: areaUnit === 'both' ? 64 : 78, textAlign: 'center' }}
                  />
                </div>
                <p className="section-hint">
                  Typical {formatArea(template.carpetAreaRange.min, areaUnit, 0)}–{formatArea(template.carpetAreaRange.max, areaUnit, 0)}
                </p>
              </div>

              <div className="section">
                <p className="section-label">Envelope</p>
                {exactEnvelope ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <input
                        type="number"
                        min={4}
                        max={40}
                        step={0.1}
                        value={exactEnvelope.w}
                        onChange={e => setExactEnvelope({ ...exactEnvelope, w: Math.max(4, parseFloat(e.target.value) || exactEnvelope.w) })}
                        style={{ ...inputStyle, width: 72, textAlign: 'center' }}
                      />
                      <span style={{ color: '#64748b', fontSize: '0.75rem' }}>×</span>
                      <input
                        type="number"
                        min={4}
                        max={40}
                        step={0.1}
                        value={exactEnvelope.h}
                        onChange={e => setExactEnvelope({ ...exactEnvelope, h: Math.max(4, parseFloat(e.target.value) || exactEnvelope.h) })}
                        style={{ ...inputStyle, width: 72, textAlign: 'center' }}
                      />
                      <span style={{ color: '#64748b', fontSize: '0.7rem' }}>m</span>
                      <button type="button" className="chip" style={{ marginLeft: 'auto', fontSize: '0.62rem' }} onClick={() => { setExactEnvelope(null); setCandidates([]); }}>
                        Reset to Auto
                      </button>
                    </div>
                    <p className="section-hint">Manual envelope pinned — derived from carpet area when reset.</p>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p className="section-hint" style={{ marginBottom: 0 }}>
                      {formatOutline(outlineW, outlineH, areaUnit)} · auto
                    </p>
                    <button type="button" className="chip" style={{ fontSize: '0.62rem' }} onClick={() => { setExactEnvelope({ w: outlineW, h: outlineH }); setCandidates([]); }}>
                      Set exact size
                    </button>
                  </div>
                )}
              </div>

              <div className="section">
                <p className="section-label">Bathrooms</p>
                <div className="chip-row">
                  {bathroomOptions.map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`chip${bathrooms === n ? ' primary' : ''}`}
                      onClick={() => { setBathrooms(n); setCandidates([]); }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="section">
                <p className="section-label">Extras</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip${wantsBalcony ? ' primary' : ''}`}
                    onClick={() => { setWantsBalcony(v => !v); setCandidates([]); }}
                  >
                    Balcony
                  </button>
                  <button
                    type="button"
                    className={`chip${wantsUtility ? ' primary' : ''}`}
                    onClick={() => { setWantsUtility(v => !v); setCandidates([]); }}
                  >
                    Utility
                  </button>
                </div>
                {(wantsBalcony || wantsUtility) && (
                  <p className="section-hint" style={{ marginTop: 6 }}>
                    Noted in the design strategy — in-plan placement is coming soon.
                  </p>
                )}
              </div>
            </>
          )}

          {typology !== 'multi_unit' && (
          <div className="section">
            <p className="section-label">Entrance</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                display: 'grid',
                gridTemplateAreas: `". n ." "w c e" ". s ."`,
                gridTemplateColumns: '36px 36px 36px',
                gridTemplateRows: '36px 36px 36px',
                gap: 3,
              }}>
                <button type="button" onClick={() => { setEntranceDir('N'); setCandidates([]); }} style={{ ...dirBtnStyle('N'), gridArea: 'n' }}>N</button>
                <button type="button" onClick={() => { setEntranceDir('W'); setCandidates([]); }} style={{ ...dirBtnStyle('W'), gridArea: 'w' }}>W</button>
                <div style={{
                  gridArea: 'c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <Home size={14} color="#64748b" />
                </div>
                <button type="button" onClick={() => { setEntranceDir('E'); setCandidates([]); }} style={{ ...dirBtnStyle('E'), gridArea: 'e' }}>E</button>
                <button type="button" onClick={() => { setEntranceDir('S'); setCandidates([]); }} style={{ ...dirBtnStyle('S'), gridArea: 's' }}>S</button>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600 }}>
                  {DIRECTION_LABELS[entranceDir]}
                </p>
                <p style={{ color: '#64748b', fontSize: '0.68rem', marginTop: 2 }}>
                  Main door faces {DIRECTION_LABELS[entranceDir].toLowerCase()}
                </p>
              </div>
            </div>
          </div>
          )}

          {typology !== 'multi_unit' && (
            <>
              <DesignStrategySummary
                strategy={strategy}
                preset={strategyPreset}
                onPresetChange={p => { setStrategyPreset(p); setCandidates([]); }}
                advancedOpen={showAdvancedSettings}
                onViewAdvanced={() => setShowAdvancedSettings(v => !v)}
                onViewReasoning={() => setShowReasoning(true)}
              />

              {showAdvancedSettings && (
                <div className="section" style={{ paddingTop: 0 }}>
                  <AdvancedGenerationSettings
                    strategy={strategy}
                    overrides={overrides}
                    onOverride={handleOverride}
                    onReset={handleResetOverride}
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" onClick={handleGenerativeRun} disabled={isSolving || !canGenerate} className="btn-primary">
                  {isSolving ? 'Generating layouts…' : 'Generate options'}
                </button>
                <button type="button" onClick={handleSelectBest} disabled={isSolving || !canGenerate} className="btn-secondary">
                  <Activity size={14} />
                  Select best by {metricDef(primaryKey).short}
                </button>
              </div>
            </>
          )}

          {candidates.length > 0 && (
            <div className="section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p className="section-label" style={{ marginBottom: 0 }}>Proposals · {candidates.length}</p>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="btn-ghost" style={{ width: 'auto', padding: 4 }} onClick={() => setSelectedIndex(s => Math.max(0, s - 1))}>
                    <ChevronLeft size={14} />
                  </button>
                  <button type="button" className="btn-ghost" style={{ width: 'auto', padding: 4 }} onClick={() => setSelectedIndex(s => Math.min(candidates.length - 1, s + 1))}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {candidates.slice(0, 6).map((c, i) => {
                  const raw = getMetricRaw(c, primaryKey);
                  const quality = metricQualityPercent(primaryKey, raw);
                  return (
                    <div
                      key={`${c.seed}-${i}`}
                      role="button"
                      tabIndex={0}
                      className={`proposal-card${selectedIndex === i ? ' selected' : ''}`}
                      onClick={() => setSelectedIndex(i)}
                      onKeyDown={e => { if (e.key === 'Enter') setSelectedIndex(i); }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.72rem', color: selectedIndex === i ? '#93c5fd' : '#e2e8f0' }}>
                          Option {i + 1}
                        </span>
                        {i === 0 && <Trophy size={11} color="#fbbf24" />}
                      </div>
                      <p style={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                        {c.validation.valid ? 'Valid' : 'Invalid'} · {c.doors.length} doors
                      </p>
                      <p style={{ color: '#64748b', fontSize: '0.65rem', marginTop: 2 }}>
                        {metricDef(primaryKey).short}: {formatMetricRaw(primaryKey, raw)}
                      </p>
                      <div className="metric-bar"><span style={{ width: `${quality}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activePlan && (
            <div className="section">
              <p className="section-label">Scorecard</p>
              {METRIC_DEFS.map(m => {
                const raw = getMetricRaw(activePlan, m.key);
                const quality = metricQualityPercent(m.key, raw);
                const isPrimary = m.key === primaryKey;
                return (
                  <div key={m.key} className="score-row">
                    <span className="score-name" style={{ color: isPrimary ? '#93c5fd' : undefined, fontWeight: isPrimary ? 600 : 400 }}>
                      {m.short}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="metric-bar"><span style={{ width: `${quality}%`, opacity: isPrimary ? 1 : 0.7 }} /></div>
                    </div>
                    <span className="score-val">{formatMetricRaw(m.key, raw)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <button type="button" className="btn-ghost" onClick={() => setShowAdvanced(!showAdvanced)}>
              <Settings size={12} />
              {showAdvanced ? 'Hide programme' : 'Programme breakdown'}
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {spec.rooms.filter(r => r.count > 0).map(r => (
                  <div
                    key={r.type}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      background: ROOM_COLORS[r.type]?.bg || 'rgba(255,255,255,0.03)',
                      border: `1px solid ${(ROOM_COLORS[r.type]?.border || '#333')}33`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{
                        textTransform: 'capitalize',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: ROOM_COLORS[r.type]?.label || '#e2e8f0',
                      }}>
                        {r.type} × {r.count}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                        {formatArea(r.targetArea * r.count, areaUnit)}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.65rem', color: '#64748b' }}>
                      {formatArea(r.targetArea, areaUnit)} each · min {formatLength(r.minDimension, areaUnit === 'both' ? 'm2' : areaUnit)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="btn-ghost" style={{ color: '#e2e8f0', padding: 10 }}>
            <Download size={15} />
            Export IFC for Revit
          </button>
        </div>
      </aside>

      <main className="main-view" style={{ flex: 1, position: 'relative', height: '100vh' }}>
        <div className="viewport-toolbar">
          <button type="button" className={`toolbar-btn${activeTab === '2d' ? ' active' : ''}`} onClick={() => setActiveTab('2d')}>
            <Layers size={15} /> Plan
          </button>
          <button type="button" className={`toolbar-btn${activeTab === '3d' ? ' active' : ''}`} onClick={() => setActiveTab('3d')}>
            <Box size={15} /> 3D
          </button>
          <button
            type="button"
            className={`toolbar-btn tone-green${showGraphOverlay ? ' active' : ''}`}
            onClick={() => setShowGraphOverlay(o => !o)}
          >
            <GitCommit size={15} /> Graph
          </button>
          {debugEnabled && (
            <button
              type="button"
              className={`toolbar-btn tone-amber${showDebugOverlay ? ' active' : ''}`}
              onClick={() => setShowDebugOverlay(o => !o)}
            >
              <Bug size={15} /> Debug
            </button>
          )}
        </div>

        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} style={{ width: '100%', height: '100%' }}>
              {typology === 'multi_unit' ? (
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#94a3b8', flexDirection: 'column', gap: 12, padding: 40, textAlign: 'center',
                }}>
                  <LayoutGrid size={40} color="#64748b" />
                  <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0' }}>Multi-unit floor plates</p>
                  <p style={{ maxWidth: 420, fontSize: '0.85rem', lineHeight: 1.5 }}>
                    Unit-mix math is ready. Layout generation (shared core + multiple units) is next.
                    Switch to Apartment or House to generate a single dwelling now.
                  </p>
                </div>
              ) : activeTab === '2d' && activePlan ? (
                <PlanViewer2D
                  graph={activeGraph}
                  width={window.innerWidth - 380}
                  height={window.innerHeight}
                  showGraphOverlay={showGraphOverlay}
                  flowData={activeFlowData}
                  entranceDirection={entranceDir}
                  roomColors={ROOM_COLORS}
                  floorPlan={activePlan}
                  showDebugOverlay={showDebugOverlay && debugEnabled}
                  areaUnit={areaUnit}
                />
              ) : activeTab === '3d' && activePlan ? (
                <MassingViewer3D graph={activeGraph} />
              ) : (
                <div style={{ color: '#64748b' }}>No plan yet — generate options</div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="hud-panel">
          <p className="hud-title"><Zap size={11} /> Session log</p>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748b', maxHeight: 110, overflowY: 'auto', lineHeight: 1.55, fontSize: '0.68rem' }}>
            {telemetry.slice(-6).map((t, i) => <p key={`${i}-${t}`}>{t}</p>)}
          </div>
        </div>
      </main>

      {showReasoning && (
        <StrategyReasoningDialog strategy={strategy} onClose={() => setShowReasoning(false)} />
      )}
    </div>
  );
};

export default App;
