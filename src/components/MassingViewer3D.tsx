import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Float, ContactShadows } from '@react-three/drei';
import type { FloorGraph } from '../types/index';
import * as THREE from 'three';

interface MassingViewer3DProps {
  graph: FloorGraph;
}

export const MassingViewer3D: React.FC<MassingViewer3DProps> = ({ graph }) => {
  return (
    <Canvas style={{ width: '100%', height: '100%' }}>
      <PerspectiveCamera makeDefault position={[15, 15, 15]} />
      <OrbitControls makeDefault />
      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />

      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        {Array.from(graph.faces.values()).map((face, i) => {
          const pts = face.loop.map((vId) => {
            const v = graph.vertices.get(vId)!;
            return new THREE.Vector2(v.pos.x, v.pos.y);
          });
          
          const shape = new THREE.Shape(pts);
          const extrudeSettings = {
            steps: 1,
            depth: 3, // height of floor
            beveled: true,
          };

          return (
            <mesh key={face.id} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
              <extrudeGeometry args={[shape, extrudeSettings]} />
              <meshStandardMaterial 
                color="#4f46e5" 
                roughness={0.1}
                metalness={0.8}
                transparent={true}
                opacity={0.6}
                emissive="#4f46e5"
                emissiveIntensity={0.2}
              />
            </mesh>
          );
        })}
      </Float>

      <ContactShadows 
        position={[0, -0.01, 0]} 
        opacity={0.4} 
        scale={20} 
        blur={2} 
        far={4.5} 
      />
      <gridHelper args={[20, 20, '#1e1b4b', '#0a0a0c']} />
    </Canvas>
  );
};
