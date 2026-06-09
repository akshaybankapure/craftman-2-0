/**
 * Minimal IFC2x3 (STEP / ISO-10303-21) exporter.
 *
 * WHY THIS MATTERS: IFC is the interoperability format the entire AEC industry
 * runs on (Revit, ArchiCAD, etc. all import it). A floor-plan tool that cannot
 * emit IFC is a toy. This writes a SMALL but STRUCTURALLY VALID file: project ->
 * site -> building -> storey, with IfcWallStandardCase (with extruded solid
 * geometry) and IfcSpace per room. It is intentionally minimal — it is honest
 * about being a feasibility-stage export, not a full BIM authoring round-trip —
 * but it opens in IFC viewers, which is the bar that matters.
 *
 * Implementation note: IFC STEP files are a flat list of #N= ENTITY(...) lines
 * referencing each other by id. We build them with an id allocator.
 */

import type { FloorGraph, Vec2 } from '../types/index.ts';
import { polygonArea } from '../geometry/vec2.ts';

export interface IfcExportOptions {
  projectName: string;
  storeyElevation: number; // meters
  wallHeight: number;      // meters
  wallThickness: number;   // meters
}

export const DEFAULT_IFC_OPTIONS: IfcExportOptions = {
  projectName: 'Finch-Core Feasibility Model',
  storeyElevation: 0,
  wallHeight: 3.0,
  wallThickness: 0.2,
};

class StepWriter {
  private lines: string[] = [];
  private id = 0;
  add(entity: string): number {
    this.id++;
    this.lines.push(`#${this.id}=${entity};`);
    return this.id;
  }
  body(): string {
    return this.lines.join('\n');
  }
  count(): number {
    return this.id;
  }
}

function guid(): string {
  // IFC uses compressed 22-char base64-ish GUIDs; a plain pseudo-random string
  // is accepted by all viewers we target.
  const chars =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let s = '';
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * 64)];
  return s;
}

export function exportIFC(
  graph: FloorGraph,
  opts: IfcExportOptions = DEFAULT_IFC_OPTIONS
): string {
  const w = new StepWriter();

  // --- Units & geometric context ---
  const dimExp = w.add('IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0)');
  const lenUnit = w.add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const areaUnit = w.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const angUnit = w.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const unitAssign = w.add(`IFCUNITASSIGNMENT((#${lenUnit},#${areaUnit},#${angUnit}))`);

  const origin = w.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const zDir = w.add('IFCDIRECTION((0.,0.,1.))');
  const xDir = w.add('IFCDIRECTION((1.,0.,0.))');
  const worldCS = w.add(`IFCAXIS2PLACEMENT3D(#${origin},#${zDir},#${xDir})`);
  const ctx = w.add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${worldCS},$)`
  );

  // --- Ownership history (minimal) ---
  const person = w.add("IFCPERSON($,'Finch','Core',$,$,$,$,$)");
  const org = w.add("IFCORGANIZATION($,'Finch-Core',$,$,$)");
  const personOrg = w.add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = w.add(`IFCAPPLICATION(#${org},'1.0','Finch-Core','FC')`);
  const now = Math.floor(Date.now() / 1000);
  const ownerHist = w.add(
    `IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,${now})`
  );

  // --- Spatial structure: project -> site -> building -> storey ---
  const project = w.add(
    `IFCPROJECT('${guid()}',#${ownerHist},'${opts.projectName}',$,$,$,$,(#${ctx}),#${unitAssign})`
  );
  const sitePlacement = w.add(`IFCLOCALPLACEMENT($,#${worldCS})`);
  const site = w.add(
    `IFCSITE('${guid()}',#${ownerHist},'Site',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`
  );
  const bldgPlacement = w.add(`IFCLOCALPLACEMENT(#${sitePlacement},#${worldCS})`);
  const building = w.add(
    `IFCBUILDING('${guid()}',#${ownerHist},'Building',$,$,#${bldgPlacement},$,$,.ELEMENT.,$,$,$)`
  );

  const storeyPt = w.add(`IFCCARTESIANPOINT((0.,0.,${fmt(opts.storeyElevation)}))`);
  const storeyCS = w.add(`IFCAXIS2PLACEMENT3D(#${storeyPt},#${zDir},#${xDir})`);
  const storeyPlacement = w.add(`IFCLOCALPLACEMENT(#${bldgPlacement},#${storeyCS})`);
  const storey = w.add(
    `IFCBUILDINGSTOREY('${guid()}',#${ownerHist},'Ground Floor',$,$,#${storeyPlacement},$,$,.ELEMENT.,${fmt(opts.storeyElevation)})`
  );

  // Aggregation relationships.
  w.add(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${project},(#${site}))`);
  w.add(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${site},(#${building}))`);
  w.add(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${building},(#${storey}))`);

  // --- Walls (one IfcWallStandardCase per edge, extruded solid) ---
  const wallIds: number[] = [];
  for (const edge of graph.edges.values()) {
    const a = graph.vertices.get(edge.a)!.pos;
    const b = graph.vertices.get(edge.b)!.pos;
    const wallId = emitWall(w, ownerHist, ctx, storeyPlacement, a, b, opts);
    wallIds.push(wallId);
  }
  if (wallIds.length) {
    w.add(
      `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${ownerHist},$,$,(${wallIds
        .map((i) => `#${i}`)
        .join(',')}),#${storey})`
    );
  }

  // --- Spaces (one IfcSpace per room) ---
  const spaceIds: number[] = [];
  for (const face of graph.faces.values()) {
    const pts = face.loop.map((id) => graph.vertices.get(id)!.pos);
    const spaceId = emitSpace(w, ownerHist, ctx, storeyPlacement, pts, face.type, opts);
    spaceIds.push(spaceId);
  }
  if (spaceIds.length) {
    w.add(
      `IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${storey},(${spaceIds
        .map((i) => `#${i}`)
        .join(',')}))`
    );
  }

  return assembleStep(w.body(), opts.projectName);
}

function emitWall(
  w: StepWriter,
  ownerHist: number,
  ctx: number,
  parentPlacement: number,
  a: Vec2,
  b: Vec2,
  opts: IfcExportOptions
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  // Place the wall local coordinate system at vertex a, rotated to the wall dir.
  const locPt = w.add(`IFCCARTESIANPOINT((${fmt(a.x)},${fmt(a.y)},0.))`);
  const dir = w.add(`IFCDIRECTION((${fmt(Math.cos(angle))},${fmt(Math.sin(angle))},0.))`);
  const axis2d = w.add(`IFCAXIS2PLACEMENT3D(#${locPt},$,#${dir})`);
  const placement = w.add(`IFCLOCALPLACEMENT(#${parentPlacement},#${axis2d})`);

  // Rectangle profile (length x thickness), extruded vertically.
  const profPtOrigin = w.add(`IFCCARTESIANPOINT((${fmt(length / 2)},0.))`);
  const profCS = w.add(`IFCAXIS2PLACEMENT2D(#${profPtOrigin},$)`);
  const profile = w.add(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profCS},${fmt(length)},${fmt(opts.wallThickness)})`
  );
  const extrudeDir = w.add('IFCDIRECTION((0.,0.,1.))');
  const extrudeOriginPt = w.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const extrudeCS = w.add(`IFCAXIS2PLACEMENT3D(#${extrudeOriginPt},$,$)`);
  const solid = w.add(
    `IFCEXTRUDEDAREASOLID(#${profile},#${extrudeCS},#${extrudeDir},${fmt(opts.wallHeight)})`
  );
  const shapeRep = w.add(
    `IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`
  );
  const prodShape = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);

  return w.add(
    `IFCWALLSTANDARDCASE('${guid()}',#${ownerHist},'Wall',$,$,#${placement},#${prodShape},$,$)`
  );
}

function emitSpace(
  w: StepWriter,
  ownerHist: number,
  ctx: number,
  parentPlacement: number,
  pts: Vec2[],
  type: string,
  opts: IfcExportOptions
): number {
  const placePt = w.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const cs = w.add(`IFCAXIS2PLACEMENT3D(#${placePt},$,$)`);
  const placement = w.add(`IFCLOCALPLACEMENT(#${parentPlacement},#${cs})`);

  // Footprint polyline -> arbitrary closed profile -> extruded solid.
  const ptIds = pts.map((p) =>
    w.add(`IFCCARTESIANPOINT((${fmt(p.x)},${fmt(p.y)}))`)
  );
  // Close the loop.
  const polyline = w.add(
    `IFCPOLYLINE((${[...ptIds, ptIds[0]].map((i) => `#${i}`).join(',')}))`
  );
  const profile = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${polyline})`);
  const extrudeDir = w.add('IFCDIRECTION((0.,0.,1.))');
  const exOriginPt = w.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const exCS = w.add(`IFCAXIS2PLACEMENT3D(#${exOriginPt},$,$)`);
  const solid = w.add(
    `IFCEXTRUDEDAREASOLID(#${profile},#${exCS},#${extrudeDir},${fmt(opts.wallHeight)})`
  );
  const shapeRep = w.add(
    `IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`
  );
  const prodShape = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);

  return w.add(
    `IFCSPACE('${guid()}',#${ownerHist},'${type}',$,$,#${placement},#${prodShape},$,$,.ELEMENT.,.INTERNAL.,$)`
  );
}

function fmt(n: number): string {
  // IFC reals must contain a decimal point.
  if (!isFinite(n)) return '0.';
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.');
  return s.includes('.') ? s : s + '.';
}

function assembleStep(body: string, name: string): string {
  const ts = new Date().toISOString();
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('${name}','${ts}',(''),(''),'Finch-Core','Finch-Core','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
${body}
ENDSEC;
END-ISO-10303-21;
`;
}
