import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tacticalMaps } from '../app/map-data.ts';
import { applySurfaceCorrections } from '../app/map-surface-corrections.ts';
import { identity, multiply, inverse, parseTransform, parseRectanglePath, rectanglePoints, transformPoint, splitWall } from '../app/map-surface-geometry.ts';

const extracted = spawnSync('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('./extract-map-surfaces.ps1', import.meta.url))], { encoding: 'utf8', maxBuffer: 8*1024*1024 });
if (extracted.status !== 0) throw new Error(extracted.stderr || 'SVG extraction failed');
const sources = JSON.parse(extracted.stdout.replace(/^\uFEFF/, ''));
const layouts = {};
const issues = [];
for (const map of tacticalMaps) for (const layout of map.layouts) {
  if (!layout.mapModsImage) continue;
  const source = sources.find(s=>s.source === layout.mapModsImage);
  if (!source) { issues.push({layoutId:layout.id, reason:'Missing SVG'}); continue; }
  const shapes = source.shapes.flatMap(s=> {
    try {
      const rect = s.tag === 'rect' ? {x:Number(s.x),y:Number(s.y),width:Number(s.width),height:Number(s.height)} : parseRectanglePath(s.d);
      if (!rect || !Object.values(rect).every(Number.isFinite)) throw new Error('Unsupported rectangle');
      const matrix = s.transforms.reduce((m,t)=>multiply(m,parseTransform(t)),identity);
      return [{...s,rect,matrix}];
    } catch(error) { issues.push({layoutId:layout.id,sourceId:s.id,reason:error.message}); return []; }
  });
  const black = shapes.filter(s=>s.kind === 'wall' && ['#000','#000000','black'].includes(s.fill));
  const targets = shapes.filter(s=>s.fill.startsWith('url(') || ['#fc0','#ffcc00','yellow'].includes(s.fill));
  const features = [];
  for (const shape of targets) {
    const local = inverse(shape.matrix);
    const dividers = black.map(b=>rectanglePoints(b.rect).map(p=>transformPoint(transformPoint(p,b.matrix),local)));
    const segments = shape.kind === 'wall' ? splitWall(shape.rect,dividers) : [shape.rect];
    for (const [index,segment] of segments.entries()) {
      const points = rectanglePoints(segment).map(p=>transformPoint(p,shape.matrix)).map(p=>({x:Number(p.x.toFixed(4)),y:Number(p.y.toFixed(4))}));
      features.push({id:`${shape.id}:${index}`,sourceId:shape.id,kind:shape.kind,points,needsReview:false});
    }
  }
  const edge = features.filter(f=>f.kind==='hatch').map(f=>Math.hypot(f.points[1].x-f.points[0].x,f.points[1].y-f.points[0].y)).sort((a,b)=>a-b);
  const reference = edge[Math.floor(edge.length/2)];
  for (const f of features) if (f.kind==='wall') {
    const a = Math.hypot(f.points[1].x-f.points[0].x,f.points[1].y-f.points[0].y), b = Math.hypot(f.points[2].x-f.points[1].x,f.points[2].y-f.points[1].y);
    // Long uninterrupted regions require human verification; no inferred panel count.
    f.needsReview = reference ? Math.max(a,b)>reference*1.8 : false;
  }
  layouts[layout.id] = {source:source.source,viewBox:source.viewBox,features:applySurfaceCorrections(layout.id,features)};
}
await writeFile(new URL('../app/map-surfaces.generated.json',import.meta.url),JSON.stringify({version:1,layouts,issues})+'\n');
const features=Object.values(layouts).flatMap(l=>l.features);
console.log(JSON.stringify({layouts:Object.keys(layouts).length,walls:features.filter(f=>f.kind==='wall').length,hatches:features.filter(f=>f.kind==='hatch').length,needsReview:features.filter(f=>f.needsReview).length,issues},null,2));
