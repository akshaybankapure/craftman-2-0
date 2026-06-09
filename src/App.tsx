import React, { useState, useMemo } from 'react';
import { Box, Layers, Zap, Search, Download, ChevronRight, ChevronLeft, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlanViewer2D } from './components/PlanViewer2D';
import { MassingViewer3D } from './components/MassingViewer3D';
import { buildFromSpec, geneCount } from './planner/ProgramBuilder';
import { ConstraintSolver } from './solver/ConstraintSolver';
import { NSGA2, type Evaluator, type Individual } from './optimizer/NSGA2';
import { scoreObjectives } from './optimizer/objectives';
import type { ProgramSpec, RoomType } from './types/index';

const DEFAULT_SPEC: ProgramSpec = {
  totalAreaTarget: 85,
  rooms: [
    { type: 'living', count: 1, targetArea: 18, minDimension: 3.0 },
    { type: 'kitchen', count: 1, targetArea: 9, minDimension: 2.1 },
    { type: 'bedroom', count: 2, targetArea: 12, minDimension: 2.7 },
    { type: 'bathroom', count: 1, targetArea: 4, minDimension: 1.5 },
    { type: 'corridor', count: 1, targetArea: 5, minDimension: 1.05 },
    { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
  ],
  adjacencies: [
    ['living', 'kitchen'],
    ['living', 'corridor'],
    ['bedroom', 'bathroom'],
    ['corridor', 'entry'],
  ],
};

const OUTLINE_W = 12;
const OUTLINE_H = 9;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'2d' | '3d'>('2d');
  const [prompt, setPrompt] = useState('2BHK Compact — 85 m²');
  const [candidates, setCandidates] = useState<Individual[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSolving, setIsSolving] = useState(false);
  const [telemetry, setTelemetry] = useState<string[]>(['[system] architectural core ready']);

  const roomCount = DEFAULT_SPEC.rooms.reduce((s, r) => s + r.count, 0);
  const genes = geneCount(roomCount);

  const activeGraph = useMemo(() => {
    if (candidates.length > 0) {
      const ind = candidates[selectedIndex];
      const problem = buildFromSpec(DEFAULT_SPEC, OUTLINE_W, OUTLINE_H, ind.genome);
      new ConstraintSolver(problem).solve();
      return problem.graph;
    }
    // Default layout
    const problem = buildFromSpec(DEFAULT_SPEC, OUTLINE_W, OUTLINE_H, Array(genes).fill(0.5));
    new ConstraintSolver(problem).solve();
    return problem.graph;
  }, [candidates, selectedIndex]);

  const handleGenerativeRun = () => {
    setIsSolving(true);
    setTelemetry(prev => [...prev, '[nsga] initializing population of 40...']);
    
    setTimeout(() => {
      const outline = [
        { x: 0, y: 0 }, { x: OUTLINE_W, y: 0 },
        { x: OUTLINE_W, y: OUTLINE_H }, { x: 0, y: OUTLINE_H },
      ];

      const evaluator: Evaluator = {
        geneCount: genes,
        evaluate: (genome) => {
          const problem = buildFromSpec(DEFAULT_SPEC, OUTLINE_W, OUTLINE_H, genome);
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
      setTelemetry(prev => [...prev, `[nsga] pareto front found: ${front.length} options`]);
    }, 100);
  };

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar glass" style={{ margin: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ padding: '8px', background: '#4f46e5', borderRadius: '12px' }}>
            <Zap size={24} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.5px' }}>CRAFTMAN</h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 500, marginBottom: '8px' }}>PROJECT SCOPE</p>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: '12px', top: '12px', color: '#64748b' }} size={18} />
              <input 
                type="text" 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                style={{ width: '100%', padding: '12px 12px 12px 40px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: 'white', outline: 'none' }}
              />
            </div>
            
            <button onClick={handleGenerativeRun} disabled={isSolving} className="btn-primary" style={{ width: '100%', padding: '12px' }}>
              {isSolving ? 'Evolving Space...' : 'Generate Spatial Options'}
            </button>
          </div>
        </div>

        {candidates.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 500 }}>PROPOSALS ({candidates.length})</p>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setSelectedIndex(s => Math.max(0, s-1))} className="glass" style={{ padding: '4px', cursor: 'pointer' }}><ChevronLeft size={16}/></button>
                <button onClick={() => setSelectedIndex(s => Math.min(candidates.length-1, s+1))} className="glass" style={{ padding: '4px', cursor: 'pointer' }}><ChevronRight size={16}/></button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {candidates.slice(0, 4).map((c, i) => (
                <div 
                  key={i} 
                  onClick={() => setSelectedIndex(i)}
                  className={`glass ${selectedIndex === i ? 'selected' : ''}`} 
                  style={{ 
                    padding: '10px', 
                    cursor: 'pointer', 
                    fontSize: '0.7rem',
                    borderColor: selectedIndex === i ? '#4f46e5' : 'rgba(255,255,255,0.1)',
                    background: selectedIndex === i ? 'rgba(79, 70, 229, 0.1)' : 'rgba(255,255,255,0.05)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600 }}>Option {i+1}</span>
                    <Trophy size={10} color={i === 0 ? '#fbbf24' : '#94a3b8'} />
                  </div>
                  <p>Efficiency: {((1 - c.objectives[1]) * 100).toFixed(0)}%</p>
                  <p>Daylight: {((1 - c.objectives[2]) * 100).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: '24px' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 500, marginBottom: '12px' }}>PROGRAM LOADS</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {DEFAULT_SPEC.rooms.map((r, i) => (
              <div key={i} className="glass" style={{ padding: '12px', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ textTransform: 'capitalize' }}>{r.type} {r.count > 1 ? `×${r.count}` : ''}</span>
                <span style={{ color: '#4f46e5', fontFamily: 'monospace' }}>{r.targetArea}m²</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <button className="glass" style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'white', cursor: 'pointer' }}>
            <Download size={18} />
            <span>Export IFC for Revit</span>
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="main-view">
        <div style={{ position: 'absolute', top: '24px', left: '24px', display: 'flex', gap: '12px', zIndex: 10 }}>
          <button onClick={() => setActiveTab('2d')} className="glass" style={{ background: activeTab === '2d' ? '#4f46e5' : 'rgba(25, 25, 30, 0.6)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} /> Plan View
          </button>
          <button onClick={() => setActiveTab('3d')} className="glass" style={{ background: activeTab === '3d' ? '#4f46e5' : 'rgba(25, 25, 30, 0.6)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Box size={18} /> 3D Massing
          </button>
        </div>

        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ width: '100%', height: '100%' }}>
              {activeTab === '2d' ? (
                <PlanViewer2D graph={activeGraph} width={window.innerWidth - 360} height={window.innerHeight} />
              ) : (
                <MassingViewer3D graph={activeGraph} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Console Overlay */}
        <div className="glass" style={{ position: 'absolute', bottom: '24px', right: '24px', width: '300px', padding: '16px', fontSize: '0.75rem' }}>
          <p style={{ color: '#4f46e5', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Zap size={12} /> REAL-TIME ANALYSIS
          </p>
          <div style={{ fontFamily: 'monospace', color: '#94a3b8' }}>
            {telemetry.map((t, i) => <p key={i}>{t}</p>)}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
