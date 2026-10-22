// Geometry used by the one-time SVG extractor. Coordinates stay in SVG space.
export type Point = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number];
export type Rectangle = { x: number; y: number; width: number; height: number };
export const identity: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

export function transformPoint(p: Point, m: Matrix): Point {
  return { x: m[0]*p.x+m[2]*p.y+m[4], y: m[1]*p.x+m[3]*p.y+m[5] };
}

export function inverse(m: Matrix): Matrix {
  const d = m[0]*m[3]-m[1]*m[2];
  if (Math.abs(d) < 1e-12) throw new Error("Singular SVG transform");
  return [m[3]/d, -m[1]/d, -m[2]/d, m[0]/d, (m[2]*m[5]-m[3]*m[4])/d, (m[1]*m[4]-m[0]*m[5])/d];
}

export function parseTransform(value = ""): Matrix {
  let matrix = identity;
  for (const match of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = match[2].trim().split(/[\s,]+/).map(Number);
    let next: Matrix;
    if (match[1] === "matrix" && n.length === 6) next = n as Matrix;
    else if (match[1] === "translate") next = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (match[1] === "scale") next = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (match[1] === "rotate") {
      const angle = n[0]*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle);
      const x = n[1] ?? 0, y = n[2] ?? 0;
      next = [c, s, -s, c, x-c*x+s*y, y-s*x-c*y];
    } else throw new Error(`Unsupported SVG transform: ${match[1]}`);
    if (!next.every(Number.isFinite)) throw new Error("Invalid SVG transform");
    matrix = multiply(matrix, next);
  }
  if (value.replace(/([a-zA-Z]+)\s*\(([^)]*)\)/g, "").trim()) throw new Error("Invalid SVG transform syntax");
  return matrix;
}

export function rectanglePoints(r: Rectangle): Point[] {
  return [{x:r.x,y:r.y}, {x:r.x+r.width,y:r.y}, {x:r.x+r.width,y:r.y+r.height}, {x:r.x,y:r.y+r.height}];
}

// Accept only closed, axis-aligned rectangles; never guess unsupported geometry.
export function parseRectanglePath(d: string): Rectangle | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  let x = 0, y = 0, i = 0;
  const points: Point[] = [];
  while (i < tokens.length) {
    const command = tokens[i++];
    const relative = command === command.toLowerCase();
    const read = () => Number(tokens[i++]);
    if (command.toLowerCase() === "z") { if (i !== tokens.length) return null; break; }
    if (command.toLowerCase() === "m" || command.toLowerCase() === "l") {
      const a = read(), b = read(); x = relative ? x+a : a; y = relative ? y+b : b;
    } else if (command.toLowerCase() === "h") { const a = read(); x = relative ? x+a : a; }
    else if (command.toLowerCase() === "v") { const a = read(); y = relative ? y+a : a; }
    else return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({x,y});
  }
  if (points.length === 5 && Math.hypot(points[0].x-x, points[0].y-y) < 0.01) points.pop();
  if (points.length !== 4 || !/[zZ]\s*$/.test(d)) return null;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const r = {x:Math.min(...xs), y:Math.min(...ys), width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys)};
  if (r.width <= 0 || r.height <= 0) return null;
  const corners = rectanglePoints(r);
  return corners.every(c=>points.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<0.02)) ? r : null;
}

export function splitWall(r: Rectangle, separators: Point[][]): Rectangle[] {
  const horizontal = r.width > r.height;
  const start = horizontal ? r.x : r.y, length = horizontal ? r.width : r.height;
  const thickness = horizontal ? r.height : r.width;
  const crossStart = horizontal ? r.y : r.x;
  const cuts = separators.flatMap(points => {
    const along = points.map(p=>horizontal ? p.x : p.y);
    const cross = points.map(p=>horizontal ? p.y : p.x);
    const center = (Math.min(...along)+Math.max(...along))/2;
    const crossCenter = (Math.min(...cross)+Math.max(...cross))/2;
    // A divider is thin along the wall and spans its thickness.
    if (center <= start+thickness || center >= start+length-thickness ||
        Math.max(...along)-Math.min(...along) > thickness*1.2 ||
        Math.max(...cross)-Math.min(...cross) < thickness*0.65 ||
        Math.abs(crossCenter-(crossStart+thickness/2)) > thickness*0.2) return [];
    return [center];
  }).sort((a,b)=>a-b).filter((v,i,a)=>i===0 || v-a[i-1]>thickness*0.5);
  const boundaries = [start, ...cuts, start+length];
  return boundaries.slice(1).map((end,i)=>horizontal
    ? {...r,x:boundaries[i],width:end-boundaries[i]}
    : {...r,y:boundaries[i],height:end-boundaries[i]});
}
