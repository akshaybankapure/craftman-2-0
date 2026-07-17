import React, { useState, useMemo } from 'react';
import { Layers, Zap, Download, ChevronRight, ChevronLeft, Trophy, Activity, GitCommit, Home, Settings, Box } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlanViewer2D } from './components/PlanViewer2D';
import { MassingViewer3D } from './components/MassingViewer3D';
import { buildFromSpec, geneCount, type EntranceDirection } from './planner/ProgramBuilder';
import { ConstraintSolver } from './solver/ConstraintSolver';
import { NSGA2, type Evaluator, type Individual } from './optimizer/NSGA2';
import { scoreObjectives, computeRoomIntegration } from './optimizer/objectives';
import type { ProgramSpec, RoomType } from './types/index';

// ─── BHK Presets ────────────────────────────────────────────────────────────
type BHKType = '1 BHK' | '2 BHK' | '3 BHK' | '4 BHK';

interface BHKPreset {
  label: BHKType;
  defaultArea: number; // total carpet area
  rooms: ProgramSpec['rooms'];
  adjacencies: ProgramSpec['adjacencies'];
}

const BHK_PRESETS: Record<BHKType, BHKPreset> = {
  '1 BHK': {
    label: '1 BHK',
    defaultArea: 45,
    rooms: [
      { type: 'living', count: 1, targetArea: 14, minDimension: 3.0 },
      { type: 'kitchen', count: 1, targetArea: 7, minDimension: 2.1 },
      { type: 'bedroom', count: 1, targetArea: 12, minDimension: 2.7 },
      { type: 'bathroom', count: 1, targetArea: 4, minDimension: 1.5 },
      { type: 'corridor', count: 1, targetArea: 4, minDimension: 1.05 },
      { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
    ],
    adjacencies: [
      ['living', 'kitchen'],
      ['living', 'corridor'],
      ['bedroom', 'bathroom'],
      ['corridor', 'entry'],
      ['corridor', 'bedroom'],
    ],
  },
  '2 BHK': {
    label: '2 BHK',
    defaultArea: 75,
    rooms: [
      { type: 'living', count: 1, targetArea: 18, minDimension: 3.0 },
      { type: 'kitchen', count: 1, targetArea: 9, minDimension: 2.1 },
      { type: 'bedroom', count: 2, targetArea: 12, minDimension: 2.7 },
      { type: 'bathroom', count: 2, targetArea: 4, minDimension: 1.5 },
      { type: 'corridor', count: 1, targetArea: 5, minDimension: 1.05 },
      { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
    ],
    adjacencies: [
      ['living', 'kitchen'],
      ['living', 'corridor'],
      ['bedroom', 'bathroom'],
      ['corridor', 'entry'],
      ['corridor', 'bedroom'],
    ],
  },
  '3 BHK': {
    label: '3 BHK',
    defaultArea: 105,
    rooms: [
      { type: 'living', count: 1, targetArea: 22, minDimension: 3.5 },
      { type: 'kitchen', count: 1, targetArea: 10, minDimension: 2.4 },
      { type: 'bedroom', count: 3, targetArea: 13, minDimension: 2.7 },
      { type: 'bathroom', count: 2, targetArea: 4.5, minDimension: 1.5 },
      { type: 'corridor', count: 1, targetArea: 6, minDimension: 1.1 },
      { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
    ],
    adjacencies: [
      ['living', 'kitchen'],
      ['living', 'corridor'],
      ['bedroom', 'bathroom'],
      ['corridor', 'entry'],
      ['corridor', 'bedroom'],
    ],
  },
  '4 BHK': {
    label: '4 BHK',
    defaultArea: 140,
    rooms: [
      { type: 'living', count: 1, targetArea: 28, minDimension: 4.0 },
      { type: 'kitchen', count: 1, targetArea: 12, minDimension: 2.4 },
      { type: 'bedroom', count: 4, targetArea: 14, minDimension: 2.7 },
      { type: 'bathroom', count: 3, targetArea: 4.5, minDimension: 1.5 },
      { type: 'corridor', count: 1, targetArea: 7, minDimension: 1.2 },
      { type: 'entry', count: 1, targetArea: 3.5, minDimension: 1.2 },
    ],
    adjacencies: [
      ['living', 'kitchen'],
      ['living', 'corridor'],
      ['bedroom', 'bathroom'],
      ['corridor', 'entry'],
      ['corridor', 'bedroom'],
    ],
  },
};

// ─── Room color palette ─────────────────────────────────────────────────────
const ROOM_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  living:   { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: '#fbbf24' },
  kitchen:  { bg: 'rgba(16, 185, 129, 0.12)', border: '#10b981', label: '#34d399' },
  bedroom:  { bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6', label: '#60a5fa' },
  bathroom: { bg: 'rgba(6, 182, 212, 0.12)',  border: '#06b6d4', label: '#22d3ee' },
  corridor: { bg: 'rgba(100, 116, 139, 0.08)', border: '#64748b', label: '#94a3b8' },
  entry:    { bg: 'rgba(139, 92, 246, 0.12)', border: '#8b5cf6', label: '#a78bfa' },
  storage:  { bg: 'rgba(161, 161, 170, 0.10)', border: '#a1a1aa', label: '#d4d4d8' },
  office:   { bg: 'rgba(236, 72, 153, 0.12)', border: '#ec4899', label: '#f472b6' },
};

// ─── Direction labels for compass ───────────────────────────────────────────
const DIRECTION_LABELS: Record<EntranceDirection, string> = {
  'N': 'North',
  'S': 'South',
  'E': 'East',
  'W': 'West',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'2d' | '3d'>('2d');
  const [bhkType, setBhkType] = useState<BHKType>('2 BHK');
  const [carpetArea, setCarpetArea] = useState(75);
  const [entranceDir, setEntranceDir] = useState<EntranceDirection>('S');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  const [candidates, setCandidates] = useState<Individual[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSolving, setIsSolving] = useState(false);
  const [telemetry, setTelemetry] = useState<string[]>(['[system] architectural core ready']);

  // Derive spec from BHK preset + carpet area
  const spec = useMemo<ProgramSpec>(() => {
    const preset = BHK_PRESETS[bhkType];
    const defaultTotal = preset.rooms.reduce((s, r) => s + r.count * r.targetArea, 0);
    const scale = carpetArea / defaultTotal;
    
    return {
      totalAreaTarget: carpetArea,
      rooms: preset.rooms.map(r => ({
        ...r,
        targetArea: Math.round(r.targetArea * scale * 10) / 10,
      })),
      adjacencies: preset.adjacencies,
    };
  }, [bhkType, carpetArea]);

  // Compute outline dimensions from carpet area (roughly square-ish)
  const { outlineW, outlineH } = useMemo(() => {
    const aspect = 1.3; // slightly rectangular
    const h = Math.sqrt(carpetArea / aspect);
    const w = carpetArea / h;
    return { outlineW: Math.round(w * 10) / 10, outlineH: Math.round(h * 10) / 10 };
  }, [carpetArea]);

  const roomCount = useMemo(() => spec.rooms.reduce((s, r) => s + r.count, 0), [spec]);
  const genes = useMemo(() => geneCount(roomCount), [roomCount]);

  const activeGraph = useMemo(() => {
    if (candidates.length > 0) {
      const ind = candidates[selectedIndex];
      const problem = buildFromSpec(spec, outlineW, outlineH, ind.genome, entranceDir);
      new ConstraintSolver(problem).solve();
      return problem.graph;
    }
    // Default layout
    const problem = buildFromSpec(spec, outlineW, outlineH, Array(genes).fill(0.5), entranceDir);
    new ConstraintSolver(problem).solve();
    return problem.graph;
  }, [candidates, selectedIndex, spec, outlineW, outlineH, genes, entranceDir]);

  const activeFlowData = useMemo(() => {
    return computeRoomIntegration(activeGraph);
  }, [activeGraph]);

  const handleBHKChange = (type: BHKType) => {
    setBhkType(type);
    setCarpetArea(BHK_PRESETS[type].defaultArea);
    setCandidates([]);
    setTelemetry(prev => [...prev.slice(-5), `[config] switched to ${type} preset`]);
  };

  const handleGenerativeRun = () => {
    setIsSolving(true);
    setTelemetry(prev => [...prev, `[nsga] evolving ${bhkType} layouts...`]);
    
    setTimeout(() => {
      const outline = [
        { x: 0, y: 0 }, { x: outlineW, y: 0 },
        { x: outlineW, y: outlineH }, { x: 0, y: outlineH },
      ];

      const evaluator: Evaluator = {
        geneCount: genes,
        evaluate: (genome) => {
          const problem = buildFromSpec(spec, outlineW, outlineH, genome, entranceDir);
          new ConstraintSolver(problem).solve();
          return scoreObjectives(problem.graph, outline);
        }
      };

      const nsga = new NSGA2(evaluator, { 
        populationSize: 40, 
        generations: 20, 
        crossoverProb: 0.9, 
        mutationProb: 0.2, 
        etaC: 15, 
        etaM: 20, 
        seed: Date.now() 
      });
      
      const front = nsga.run((gen) => {
        if (gen % 5 === 0) setTelemetry(prev => [...prev.slice(-5), `[nsga] generation ${gen} evolved`]);
      });

      setCandidates(front);
      setSelectedIndex(0);
      setIsSolving(false);
      setTelemetry(prev => [...prev, `[nsga] pareto front: ${front.length} options`]);
    }, 100);
  };

  const handleSelectBest = () => {
    const outline = [
      { x: 0, y: 0 }, { x: outlineW, y: 0 },
      { x: outlineW, y: outlineH }, { x: 0, y: outlineH },
    ];

    if (candidates.length === 0) {
      setIsSolving(true);
      setTelemetry(prev => [...prev, '[ai] auto-generating + selecting best layout...']);
      
      setTimeout(() => {
        const evaluator: Evaluator = {
          geneCount: genes,
          evaluate: (genome) => {
            const problem = buildFromSpec(spec, outlineW, outlineH, genome, entranceDir);
            new ConstraintSolver(problem).solve();
            return scoreObjectives(problem.graph, outline);
          }
        };

        const nsga = new NSGA2(evaluator, { 
          populationSize: 40, 
          generations: 20, 
          crossoverProb: 0.9, 
          mutationProb: 0.2, 
          etaC: 15, 
          etaM: 20, 
          seed: Date.now() 
        });
        
        const front = nsga.run();
        setCandidates(front);
        selectBestFromPop(front, outline);
        setIsSolving(false);
      }, 100);
    } else {
      selectBestFromPop(candidates, outline);
    }
  };

  const selectBestFromPop = (pop: Individual[], outline: { x: number, y: number }[]) => {
    let bestIndex = 0;
    let minScore = Infinity;

    pop.forEach((ind, index) => {
      const problem = buildFromSpec(spec, outlineW, outlineH, ind.genome, entranceDir);
      new ConstraintSolver(problem).solve();
      const objectives = scoreObjectives(problem.graph, outline);
      const flowInfo = computeRoomIntegration(problem.graph);

      const score = (objectives.areaError * 100) + (objectives.circulation * 10) + ((1 - objectives.daylight) * 30) + (flowInfo.flowScore * 10);
      if (score < minScore) {
        minScore = score;
        bestIndex = index;
      }
    });

    setSelectedIndex(bestIndex);
    setTelemetry(prev => [
      ...prev,
      `[ai] selected Option ${bestIndex + 1} — best graph flow (score: ${minScore.toFixed(1)})`
    ]);
  };

  // ─── BHK selector badge style ──────────────────────────────────────────────
  const bhkBtnStyle = (type: BHKType): React.CSSProperties => ({
    flex: 1,
    padding: '12px 8px',
    background: bhkType === type 
      ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' 
      : 'rgba(255,255,255,0.04)',
    border: bhkType === type 
      ? '1px solid #818cf8' 
      : '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: bhkType === type ? 'white' : '#94a3b8',
    fontSize: '0.85rem',
    fontWeight: bhkType === type ? 700 : 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'center' as const,
    letterSpacing: '0.3px',
  });

  // ─── Direction button style ────────────────────────────────────────────────
  const dirBtnStyle = (dir: EntranceDirection): React.CSSProperties => ({
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: entranceDir === dir 
      ? 'rgba(139, 92, 246, 0.3)' 
      : 'rgba(255,255,255,0.04)',
    border: entranceDir === dir 
      ? '2px solid #8b5cf6' 
      : '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: entranceDir === dir ? '#a78bfa' : '#64748b',
    fontSize: '0.7rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'white',
    fontSize: '0.85rem',
    outline: 'none',
  };

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar glass" style={{ margin: '12px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 24px)', overflow: 'hidden' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ padding: '8px', background: '#4f46e5', borderRadius: '12px' }}>
            <Zap size={24} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.5px' }}>CRAFTMAN</h1>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* ── BHK Type ── */}
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 600, marginBottom: '8px', letterSpacing: '1px' }}>APARTMENT TYPE</p>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['1 BHK', '2 BHK', '3 BHK', '4 BHK'] as BHKType[]).map(t => (
                <button key={t} onClick={() => handleBHKChange(t)} style={bhkBtnStyle(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ── Carpet Area ── */}
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 600, marginBottom: '8px', letterSpacing: '1px' }}>CARPET AREA (m²)</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input 
                type="range" 
                min="30" max="200" step="5"
                value={carpetArea}
                onChange={e => { setCarpetArea(parseInt(e.target.value)); setCandidates([]); }}
                style={{ flex: 1, accentColor: '#4f46e5' }}
              />
              <input
                type="number"
                min="30" max="200"
                value={carpetArea}
                onChange={e => { setCarpetArea(parseInt(e.target.value) || 75); setCandidates([]); }}
                style={{ ...inputStyle, width: '70px', textAlign: 'center' }}
              />
            </div>
            <p style={{ color: '#64748b', fontSize: '0.65rem', marginTop: '4px' }}>
              Outline: {outlineW}m × {outlineH}m
            </p>
          </div>

          {/* ── Entrance Direction ── */}
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 600, marginBottom: '8px', letterSpacing: '1px' }}>ENTRANCE DIRECTION</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* Mini compass widget */}
              <div style={{ 
                display: 'grid', 
                gridTemplateAreas: `". n ." "w c e" ". s ."`,
                gridTemplateColumns: '36px 36px 36px',
                gridTemplateRows: '36px 36px 36px',
                gap: '3px',
              }}>
                <button onClick={() => { setEntranceDir('N'); setCandidates([]); }} style={{ ...dirBtnStyle('N'), gridArea: 'n' }}>N</button>
                <button onClick={() => { setEntranceDir('W'); setCandidates([]); }} style={{ ...dirBtnStyle('W'), gridArea: 'w' }}>W</button>
                <div style={{ 
                  gridArea: 'c', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <Home size={14} color="#64748b" />
                </div>
                <button onClick={() => { setEntranceDir('E'); setCandidates([]); }} style={{ ...dirBtnStyle('E'), gridArea: 'e' }}>E</button>
                <button onClick={() => { setEntranceDir('S'); setCandidates([]); }} style={{ ...dirBtnStyle('S'), gridArea: 's' }}>S</button>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600 }}>
                  {DIRECTION_LABELS[entranceDir]}
                </p>
                <p style={{ color: '#64748b', fontSize: '0.65rem', marginTop: '2px' }}>
                  Main door faces {DIRECTION_LABELS[entranceDir].toLowerCase()}
                </p>
              </div>
            </div>
          </div>

          {/* ── Generate Buttons ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button onClick={handleGenerativeRun} disabled={isSolving} className="btn-primary" style={{ width: '100%', padding: '12px', fontSize: '0.85rem', fontWeight: 600 }}>
              {isSolving ? '⏳ Evolving Layouts...' : '⚡ Generate Options'}
            </button>
            <button 
              onClick={handleSelectBest} 
              disabled={isSolving} 
              style={{ 
                width: '100%', 
                padding: '10px', 
                fontSize: '0.8rem', 
                color: '#fbbf24', 
                border: '1px solid rgba(251, 191, 36, 0.3)', 
                background: 'rgba(251, 191, 36, 0.05)',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                borderRadius: '8px',
                transition: 'all 0.2s',
              }}
            >
              <Activity size={14} color="#fbbf24" />
              <span>Auto-Select Best Layout</span>
            </button>
          </div>

          {/* ── Proposals ── */}
          {candidates.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <p style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '1px' }}>PROPOSALS ({candidates.length})</p>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => setSelectedIndex(s => Math.max(0, s-1))} className="glass" style={{ padding: '4px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px' }}><ChevronLeft size={14}/></button>
                  <button onClick={() => setSelectedIndex(s => Math.min(candidates.length-1, s+1))} className="glass" style={{ padding: '4px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px' }}><ChevronRight size={14}/></button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                {candidates.slice(0, 6).map((c, i) => (
                  <div 
                    key={i} 
                    onClick={() => setSelectedIndex(i)}
                    style={{ 
                      padding: '8px', 
                      cursor: 'pointer', 
                      fontSize: '0.65rem',
                      borderRadius: '8px',
                      border: selectedIndex === i ? '1px solid #4f46e5' : '1px solid rgba(255,255,255,0.06)',
                      background: selectedIndex === i ? 'rgba(79, 70, 229, 0.12)' : 'rgba(255,255,255,0.03)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 600, color: selectedIndex === i ? '#818cf8' : '#e2e8f0' }}>Option {i+1}</span>
                      {i === 0 && <Trophy size={10} color="#fbbf24" />}
                    </div>
                    <p style={{ color: '#94a3b8' }}>Daylight: {((1 - c.objectives[2]) * 100).toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Advanced Room Config (collapsed) ── */}
          <div>
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                color: '#64748b',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                letterSpacing: '0.5px',
              }}
            >
              <Settings size={12} />
              {showAdvanced ? 'HIDE ADVANCED' : 'ADVANCED ROOM SETTINGS'}
            </button>
            
            {showAdvanced && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {spec.rooms.filter(r => r.count > 0).map((r) => (
                  <div key={r.type} style={{ 
                    padding: '8px', 
                    borderRadius: '8px', 
                    background: ROOM_COLORS[r.type]?.bg || 'rgba(255,255,255,0.03)',
                    border: `1px solid ${(ROOM_COLORS[r.type]?.border || '#333')}33`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ 
                        textTransform: 'capitalize', 
                        fontSize: '0.75rem', 
                        fontWeight: 600,
                        color: ROOM_COLORS[r.type]?.label || '#e2e8f0',
                      }}>
                        {r.type} × {r.count}
                      </span>
                      <span style={{ fontSize: '0.6rem', color: '#64748b' }}>
                        {(r.targetArea * r.count).toFixed(0)}m² total
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.55rem', color: '#64748b', marginBottom: '1px' }}>Area (each)</label>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{r.targetArea}m²</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.55rem', color: '#64748b', marginBottom: '1px' }}>Min Dim</label>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{r.minDimension}m</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button className="glass" style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'white', cursor: 'pointer', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Download size={16} />
            <span style={{ fontSize: '0.8rem' }}>Export IFC for Revit</span>
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="main-view" style={{ flex: 1, position: 'relative', height: '100vh' }}>
        <div style={{ position: 'absolute', top: '24px', left: '24px', display: 'flex', gap: '8px', zIndex: 10 }}>
          <button onClick={() => setActiveTab('2d')} style={{ 
            background: activeTab === '2d' ? '#4f46e5' : 'rgba(25, 25, 30, 0.8)', 
            color: 'white', 
            border: activeTab === '2d' ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.08)', 
            padding: '8px 16px', 
            borderRadius: '8px', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            fontSize: '0.8rem',
            fontWeight: 500,
            backdropFilter: 'blur(12px)',
          }}>
            <Layers size={16} /> Plan View
          </button>
          <button onClick={() => setActiveTab('3d')} style={{ 
            background: activeTab === '3d' ? '#4f46e5' : 'rgba(25, 25, 30, 0.8)', 
            color: 'white', 
            border: activeTab === '3d' ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.08)', 
            padding: '8px 16px', 
            borderRadius: '8px', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            fontSize: '0.8rem',
            fontWeight: 500,
            backdropFilter: 'blur(12px)',
          }}>
            <Box size={16} /> 3D Massing
          </button>
          <button 
            onClick={() => setShowGraphOverlay(o => !o)} 
            style={{ 
              background: showGraphOverlay ? 'rgba(16, 185, 129, 0.15)' : 'rgba(25, 25, 30, 0.8)', 
              color: showGraphOverlay ? '#10b981' : '#94a3b8', 
              border: showGraphOverlay ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255,255,255,0.08)',
              padding: '8px 16px', 
              borderRadius: '8px', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '0.8rem',
              fontWeight: 500,
              backdropFilter: 'blur(12px)',
            }}
          >
            <GitCommit size={16} />
            Graph
          </button>
        </div>

        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ width: '100%', height: '100%' }}>
              {activeTab === '2d' ? (
                <PlanViewer2D 
                  graph={activeGraph} 
                  width={window.innerWidth - 360} 
                  height={window.innerHeight} 
                  showGraphOverlay={showGraphOverlay}
                  flowData={activeFlowData}
                  entranceDirection={entranceDir}
                  roomColors={ROOM_COLORS}
                />
              ) : (
                <MassingViewer3D graph={activeGraph} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Console Overlay */}
        <div style={{ 
          position: 'absolute', 
          bottom: '24px', 
          right: '24px', 
          width: '280px', 
          padding: '14px', 
          fontSize: '0.7rem', 
          borderRadius: '12px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <p style={{ color: '#4f46e5', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', letterSpacing: '0.5px' }}>
            <Zap size={10} /> ANALYSIS LOG
          </p>
          <div style={{ fontFamily: 'monospace', color: '#64748b', maxHeight: '120px', overflowY: 'auto', lineHeight: 1.6 }}>
            {telemetry.slice(-6).map((t, i) => <p key={i}>{t}</p>)}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
