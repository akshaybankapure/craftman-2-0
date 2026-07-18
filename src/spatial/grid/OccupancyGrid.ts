import type { OccupancyGridData, Point, Polygon } from "../types.ts";
import { boundingBox, pointInPolygon } from "../geometry/polygon.ts";

export const OUTSIDE_LABEL = -2;
export const UNASSIGNED_LABEL = -1;

export class OccupancyGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSizeMm: number;
  readonly envelopeMask: Uint8Array;
  readonly labels: Int16Array;

  constructor(data: OccupancyGridData) {
    this.width = data.width;
    this.height = data.height;
    this.cellSizeMm = data.cellSizeMm;
    this.envelopeMask = data.envelopeMask;
    this.labels = data.labels;
  }

  static rasterize(envelope: Polygon, cellSizeMm: number): OccupancyGrid {
    const box = boundingBox(envelope);
    const width = Math.ceil((box.maxX - box.minX) / cellSizeMm);
    const height = Math.ceil((box.maxY - box.minY) / cellSizeMm);
    const envelopeMask = new Uint8Array(width * height);
    const labels = new Int16Array(width * height);
    labels.fill(OUTSIDE_LABEL);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const center: Point = {
          x: box.minX + (x + 0.5) * cellSizeMm,
          y: box.minY + (y + 0.5) * cellSizeMm
        };
        const idx = y * width + x;
        if (pointInPolygon(center, envelope)) {
          envelopeMask[idx] = 1;
          labels[idx] = UNASSIGNED_LABEL;
        }
      }
    }

    return new OccupancyGrid({ width, height, cellSizeMm, envelopeMask, labels });
  }

  clone(): OccupancyGrid {
    return new OccupancyGrid({
      width: this.width,
      height: this.height,
      cellSizeMm: this.cellSizeMm,
      envelopeMask: this.envelopeMask.slice(),
      labels: this.labels.slice()
    });
  }

  toData(): OccupancyGridData {
    return {
      width: this.width,
      height: this.height,
      cellSizeMm: this.cellSizeMm,
      envelopeMask: this.envelopeMask.slice(),
      labels: this.labels.slice()
    };
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  coords(index: number): { x: number; y: number } {
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isInside(index: number): boolean {
    return this.envelopeMask[index] === 1;
  }

  neighbours4(index: number): number[] {
    const { x, y } = this.coords(index);
    const result: number[] = [];
    if (x > 0) result.push(this.index(x - 1, y));
    if (x + 1 < this.width) result.push(this.index(x + 1, y));
    if (y > 0) result.push(this.index(x, y - 1));
    if (y + 1 < this.height) result.push(this.index(x, y + 1));
    return result;
  }

  insideCellCount(): number {
    let n = 0;
    for (const value of this.envelopeMask) n += value;
    return n;
  }

  assignedInsideCount(): number {
    let n = 0;
    for (let i = 0; i < this.labels.length; i++) {
      if (this.envelopeMask[i] === 1 && this.labels[i]! >= 0) n++;
    }
    return n;
  }
}
