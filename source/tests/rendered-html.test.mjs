import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { register } from "node:module";
import { getCalibrationFactors, getReferenceLength, parseMapCalibration, getCalibratedReferenceView, standardReferencePixels } from "../app/map-calibration-data.ts";
import { tacticalMaps } from "../app/map-data.ts";
import { getAbilityIconScale, getMapModificationIconScale } from "../app/map-mod-scale.ts";
import { playerGadgetTools, getPlayerGadgetTool, getSlotPlacementLabel, isSlotPlacementVisible, reorderSlotEquipment } from "../app/player-gadgets.ts";
import { getMapModIconStyle } from "../app/map-mod-icon-style.ts";
import { countReinforcedSurfaces } from "../app/map-surfaces.ts";
import { operators } from "../app/operator-data.ts";
import { getMapProjectionScale, projectMapPoint, mapCoordinateAspectRatio } from "../app/map-coordinates.ts";

// Rendering a Sites bundle in Node needs the same unavailable-bindings boundary
// as an anonymous Worker request. Account DB behavior has its own D1 tests.
const workersStub = "data:text/javascript," + encodeURIComponent("export const env = {};");
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ${JSON.stringify(workersStub)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`), import.meta.url);

test("operator ability names cover supplied operators and preserve generic gadget labels", () => {
  for (const operator of operators) {
    if (["striker","sentry","blackbeard"].includes(operator.slug)) {
      assert.equal(operator.abilityName,undefined);
    } else assert.ok(operator.abilityName,`Missing ability name for ${operator.slug}`);
  }
  for (const [slug,name] of [["smoke","Remote Gas Grenade"],["skops","V10 Pantheon Shells"],["tubaro","Zoto Canister"],["jger","ACTIVE DEFENSE"],["nkk","HEL Presence Reduction"],["capito","Tactical Crossbow"]]) {
    const operator=operators.find(operator=>operator.slug===slug);
    assert.equal(operator.abilityName,name);
    assert.equal(getSlotPlacementLabel(undefined,0,operator.abilityName),name);
    assert.equal(getSlotPlacementLabel("ability",1,operator.abilityName),name);
    assert.equal(getSlotPlacementLabel("shield",1,operator.abilityName),"Shield");
  }
  assert.equal(getSlotPlacementLabel(undefined,1),"Ability 2");
});

test("Noor is a Defense operator with complete assets and a compatible standalone icon", async () => {
  const noor=operators.find(operator=>operator.slug === "noor");
  assert.equal(noor.name,"Noor");
  assert.equal(noor.side,"Defense");
  assert.equal(noor.abilityName,"Horus Lance Launcher");
  assert.equal(noor.sprite,undefined,"adding Noor must preserve the existing sprite sheet coordinates");
  for (const path of [noor.icon,noor.portrait,noor.gadgetIcon]) {
    const data=await readFile(new URL(`../public${path}`,import.meta.url));
    assert.equal(data.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.ok(data.readUInt32BE(16)>0 && data.readUInt32BE(20)>0);
  }
  const {transpileModule,ModuleKind,JsxEmit}=await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/OperatorIcon.tsx",import.meta.url),"utf8");
  const context={exports:{},require:name=>name === "react/jsx-runtime" ? runtime : {operatorIconSheet:"/operators/operator-icons-sheet.png"}};
  runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const icon=context.exports.OperatorIcon({operator:noor,size:28,alt:"Noor marker",detailed:true});
  assert.equal(icon.type,"img");assert.equal(icon.props.src,noor.icon);assert.equal(icon.props.alt,"Noor marker");
  assert.equal(getSlotPlacementLabel(undefined,0,noor.abilityName),"Horus Lance Launcher");
});

test("map coordinates stay attached to cover-fitted artwork across resize, zoom and pan", async () => {
  const source=await readFile(new URL("../app/StratBuilder.tsx",import.meta.url),"utf8");
  const {transpileModule}=await import("typescript");
  const start=source.indexOf("  function getMapPointFromClient(");
  const code=source.slice(start,source.indexOf("  function getMapPoint(",start));
  const canonical={x:58,y:42};
  for(const [width,height] of [[1200,500],[800,900],[1600,900],[450,600]]) {
    const scale=getMapProjectionScale(mapCoordinateAspectRatio,width/height);
    const projected=projectMapPoint(canonical,scale);
    // Independent object-fit: cover calculation against the intrinsic image.
    const cover=Math.max(width/1600,height/900);
    const artworkX=(width-1600*cover)/2+canonical.x/100*1600*cover;
    const artworkY=(height-900*cover)/2+canonical.y/100*900*cover;
    assert.ok(Math.abs(projected.x/100*width-artworkX)<1e-9);
    assert.ok(Math.abs(projected.y/100*height-artworkY)<1e-9);
    for(const mapZoom of [1,2.4]) {
      const mapPan={x:37,y:-19};
      const context={canvasRef:{current:{clientWidth:width,clientHeight:height,clientLeft:1,clientTop:1,getBoundingClientRect:()=>({left:20,top:40})}},mapZoom,mapPan,clamp:(v,min,max)=>Math.min(max,Math.max(min,v)),projectMapPoint,getMapProjectionScale,mapCoordinateAspectRatio};
      runInNewContext(transpileModule(code,{}).outputText,context);
      const result=context.getMapPointFromClient(21+width/2+(artworkX-width/2)*mapZoom+mapPan.x,41+height/2+(artworkY-height/2)*mapZoom+mapPan.y);
      assert.ok(Math.abs(result.x-canonical.x)<1e-9);
      assert.ok(Math.abs(result.y-canonical.y)<1e-9);
    }
  }
  assert.ok(projectMapPoint({x:0,y:0},getMapProjectionScale(mapCoordinateAspectRatio,1)).x<0,"cropped points must not snap to the viewport edge");
  assert.match(source,/stroke\.points\.map\(projectEditorPoint\)/);
  assert.match(source,/eraserStroke\.points\.map\(projectEditorPoint\)/);
  for(const point of ["slot.marker","gadget","marker"]) {
    assert.ok(source.includes(`projectEditorPoint(${point}).x`));
    assert.ok(source.includes(`projectEditorPoint(${point}).y`));
  }
  const styles=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(styles,/\.map-workbench\s*\{\s*aspect-ratio: 16 \/ 9;\s*min-height: 0;/);
});

test("map resize notifications defer layout updates and keep unchanged canvas dimensions stable", async () => {
  const {transpileModule} = await import("typescript");
  for (const file of ["StratBuilder","StratViewer"]) {
    const source=await readFile(new URL(`../app/${file}.tsx`,import.meta.url),"utf8");
    const marker=source.indexOf('    const measuredCanvas = canvas;');
    const start=source.lastIndexOf('  useEffect(() => {',marker);
    const end=source.indexOf('\n  }, [',marker);
    const effect=source.slice(start,end)+'\n  }, []);';
    let callback,cleanup,disconnected=false,reads=0,size={width:0,height:0};
    const frames=new Map();let nextFrame=0;
    const canvas={clientWidth:800,clientHeight:450,getBoundingClientRect(){reads++;return {width:this.clientWidth,height:this.clientHeight};}};
    const context={canvasRef:{current:canvas},useEffect:fn=>{cleanup=fn();},getCoverZoom:()=>1,setCanvasCoverZoom:()=>{},setCanvasAspectRatio:()=>{},setCanvasSize:fn=>{size=fn(size);},window:{requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)},ResizeObserver:class {
      constructor(fn){callback=fn;}observe(target){assert.equal(target,canvas);}disconnect(){disconnected=true;}
    }};
    runInNewContext(transpileModule(effect,{}).outputText,context);
    const initialSize=size;
    callback();callback();
    assert.equal(reads,1,"observer callback must not mutate layout during resize delivery");
    assert.equal(frames.size,1,"multiple notifications share one animation frame");
    const runFrame=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
    runFrame();
    assert.equal(size,initialSize,"same dimensions must not trigger a new object state update");
    canvas.clientHeight=500;callback();runFrame();
    assert.equal(size.height,500,"real size changes still update the map calibration");
    callback();cleanup();
    assert.equal(disconnected,true);
    assert.equal(frames.size,0,"pending resize work is canceled on unmount");
  }
});

test("viewer team button shows only its opaque icon and keeps its accessible label and action", async () => {
  const source=await readFile(new URL("../app/StratViewer.tsx",import.meta.url),"utf8");
  const start=source.indexOf('<button data-fd-id="btn-viewer-team-overview"');
  const markup=source.slice(start,source.indexOf('</button>',start)+9);
  const {transpileModule,ModuleKind,JsxEmit}=await import("typescript");
  const jsxRuntime=await import("react/jsx-runtime");
  const changes=[];
  const context={exports:{},require:()=>jsxRuntime,selectedViewSlotIndex:1,setSelectedViewSlotIndex:value=>changes.push(value),setSelectedGadgetKey:value=>changes.push(value)};
  runInNewContext(transpileModule(`export const button=(${markup});`,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const button=context.exports.button;
  assert.equal(button.props["aria-label"],"Team");
  assert.equal(button.props.children.type,"span");
  assert.equal(button.props.children.props.children,undefined);
  button.props.onClick();assert.deepEqual(changes,[null,null]);
  const styles=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(styles,/\.viewer-team-background\s*\{[^}]*background: currentColor;[^}]*opacity: 1;/);
});

test("Smoke and Skopos use the matching operator sprite cells", async () => {
  const {getOperatorSprite} = await import("../app/operator-data.ts");
  assert.deepEqual(getOperatorSprite("smoke"),{column:1,row:8});
  assert.deepEqual(getOperatorSprite("skops"),{column:3,row:8});
});

test("drawing mode exits for other controls but keeps canvas strokes and drawing tools active", async () => {
  const source = await readFile(new URL("../app/StratBuilder.tsx",import.meta.url),"utf8");
  const end = source.indexOf('  const sideOperators =');
  const start = source.lastIndexOf('  useEffect(() => {',end);
  const {transpileModule} = await import("typescript");
  const listeners = new Map();
  const changes = [];
  const canvas = {};
  class Target {
    constructor(control,tool=false) { this.control=control;this.tool=tool; }
    closest(selector) { return selector === ".drawing-panel, .drawing-toggle" ? this.tool ? {} : null : this.control; }
  }
  let cleanup;
  const context = {isDrawingMode:true,Element:Target,canvasRef:{current:canvas},drawingDragState:{current:null},setIsDrawingMode:value=>changes.push(value),useEffect:effect=>{cleanup=effect();},document:{
    addEventListener:(type,handler,capture)=>{assert.equal(capture,true);listeners.set(type,handler);},
    removeEventListener:(type,handler,capture)=>{assert.equal(capture,true);assert.equal(listeners.get(type),handler);listeners.delete(type);},
  }};
  runInNewContext(transpileModule(source.slice(start,end),{}).outputText,context);
  for (const type of ["pointerdown","click"]) {
    const handle = listeners.get(type);
    for (const target of [new Target(canvas),new Target(null),new Target({},true)]) handle({target});
    assert.equal(changes.length,0,"drawing and changing pen tools must remain possible");
    context.drawingDragState.current = {id:"active"};
    handle({target:new Target({})});
    assert.equal(changes.pop(),false,"another control exits drawing, including keyboard clicks");
    assert.equal(context.drawingDragState.current,null);
  }
  cleanup();
  assert.equal(listeners.size,0);
  context.isDrawingMode=false;
  runInNewContext(transpileModule(source.slice(start,end),{}).outputText,context);
  assert.equal(listeners.size,0);
});

test("drawing width stays uniform in every direction and erasers share the saved coordinate projection", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const jsxRuntime = await import("react/jsx-runtime");
  const strokes = [
    {id:"horizontal",width:12,color:"#ffffff",points:[{x:10,y:20},{x:90,y:20}]},
    {id:"vertical",width:12,color:"#ffffff",points:[{x:10,y:20},{x:10,y:80}]},
    {id:"eraser",width:12,isEraser:true,points:[{x:50,y:0},{x:50,y:100}]},
  ];
  const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  for (const file of ["StratBuilder","StratViewer"]) {
    const source = await readFile(new URL(`../app/${file}.tsx`,import.meta.url),"utf8");
    const start = source.lastIndexOf("<svg",source.indexOf('className="drawing-layer"'));
    const markup = source.slice(start,source.indexOf("</svg>",start)+6);
    const context = {exports:{},require:()=>jsxRuntime,visibleDrawingStrokes:strokes,projectedDrawings:strokes,projectEditorPoint:point=>projectMapPoint(point,{x:1,y:1})};
    runInNewContext(transpileModule(`export const layer = (${markup});`,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
    const layer = context.exports.layer;
    const [, , width, height] = layer.props.viewBox.split(" ").map(Number);
    const scaleX = 1600/width, scaleY = 900/height;
    assert.equal(scaleX,scaleY,"16:9 viewport must scale stroke width equally in both axes");
    for (const mask of nodes(layer).filter(node=>node.type === "mask")) {
      assert.equal(mask.props.maskUnits,"userSpaceOnUse","horizontal and vertical strokes must not use a zero-area object bounding box for masking");
      assert.equal(Number(mask.props.width),width);
      assert.equal(Number(mask.props.height),height);
    }
    const lines = nodes(layer).filter(node=>node.type === "polyline");
    const ink = lines.filter(node=>node.props.stroke === "#ffffff");
    assert.equal(ink[0].props.strokeWidth*scaleY,ink[1].props.strokeWidth*scaleX);
    assert.equal(ink[0].props.points,"10,11.25 90,11.25");
    assert.equal(ink[1].props.points,"10,11.25 10,45");
    for (const eraser of lines.filter(node=>node.props.stroke === "black")) {
      assert.equal(eraser.props.points,"50,0 50,56.25");
      assert.ok(eraser.props.strokeWidth > ink[0].props.strokeWidth);
    }
    assert.ok(nodes(layer).filter(node=>node.type === "rect").every(node=>Number(node.props.height) === height));
  }
});

test("advanced wall menu delays changes until position is chosen and leaves basic mode and hatches unchanged", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const jsxRuntime = await import("react/jsx-runtime");
  const {getSurfaceActions} = await import("../app/map-surfaces.ts");
  const source = await readFile(new URL("../app/MapSurfaceMenu.tsx",import.meta.url),"utf8");
  let state=[],cursor=0;
  const context={exports:{},require:name=>name === "react/jsx-runtime" ? jsxRuntime : name === "./map-surfaces" ? {getSurfaceActions} : {
    useEffect:()=>{},useRef:()=>({current:null}),useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],value=>{state[index]=typeof value === "function" ? value(state[index]) : value;}];},
  }};
  runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const text=node=>!node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(child=>typeof child === "string" ? child : text(child)).join("");
  for(const advancedMode of [false,true]) for(const [category,label,action] of [["holes","Head Holes","headholes"],["rotation","Crouching Rotation","crouching-rotation"]]) {
    state=[];const calls=[];
    const props={surface:{id:"qa",kind:"wall"},number:1,advancedMode,onChange:(...args)=>calls.push(args),onClose:()=>{}};
    const render=()=>{cursor=0;return context.exports.MapSurfaceMenu(props);};
    nodes(render()).find(node=>node.props?.["aria-label"]===`Open ${category} options`).props.onClick();
    if (category === "rotation") {
      for (const [rotationLabel,icon] of [["Vault Rotation","vault"],["Crouching Rotation","crouch"],["Walk Rotation","walk"]]) {
        const option = nodes(render()).find(node=>node.type === "button" && text(node) === rotationLabel);
        assert.ok(nodes(option).some(node=>node.props?.style?.maskImage === `url("/icons/wall-menu/${icon}.png")`));
        await access(new URL(`../public/icons/wall-menu/${icon}.png`,import.meta.url));
      }
    }
    nodes(render()).find(node=>node.type === "button" && text(node) === label).props.onClick();
    if(advancedMode){
      assert.equal(calls.length,0);
      assert.ok(nodes(render()).some(node=>node.props?.className === "surface-plan-options is-position"));
      const rightButton=nodes(render()).find(node=>node.type === "button" && node.props["aria-label"] === "Right");
      assert.equal(text(rightButton),"→");
      assert.equal(text(nodes(render()).find(node=>node.type === "button" && node.props["aria-label"] === "Left")),"←");
      rightButton.props.onClick();
      assert.deepEqual(calls,[[action,"right"]]);
      nodes(render()).find(node=>node.props?.["aria-label"] === "Apply without position").props.onClick();
      assert.deepEqual(calls[1],[action]);
    } else assert.deepEqual(calls,[[action]]);
  }
  state=[];cursor=0;const calls=[];
  const hatch=context.exports.MapSurfaceMenu({surface:{id:"hatch",kind:"hatch"},number:1,advancedMode:true,onChange:(...args)=>calls.push(args),onClose:()=>{}});
  for(const [label,icon] of [["Reinforcement","reinforcement-main"],["Popped hatch","popped-hatch"]]) {
    const button=nodes(hatch).find(node=>node.type === "button" && text(node) === label);
    assert.ok(nodes(button).some(node=>node.props?.style?.maskImage === `url("/icons/wall-menu/${icon}.png")`));
  }
  nodes(hatch).find(node=>node.type === "button" && text(node)==="Reinforcement").props.onClick();
  assert.deepEqual(calls,[["reinforcement"]]);
  state=[];cursor=0;const wholeCalls=[];
  const wholeProps={surface:{id:"wall",kind:"wall"},number:1,advancedMode:true,onChange:(...args)=>wholeCalls.push(args),onClose:()=>{}};
  const wholeRender=()=>{cursor=0;return context.exports.MapSurfaceMenu(wholeProps);};
  nodes(wholeRender()).find(node=>node.props?.["aria-label"] === "Open holes options").props.onClick();
  nodes(wholeRender()).find(node=>node.type === "button" && text(node)==="Whole Wall").props.onClick();
  assert.deepEqual(wholeCalls,[["whole-wall"]]);
  const shell=await readFile(new URL("../app/StratAppShell.tsx",import.meta.url),"utf8");
  assert.match(shell,/id: "editor", label: "Editor"/);
  assert.match(shell,/advancedMode=\{advancedEditorMode\}/);
  const wall=getSurfaceLayout("bank-2").features.find(surface=>surface.kind === "wall");
  for(const position of ["left","middle","right"]){
    const plans=setSurfaceAssignment([],"bank-2",wall.id,"headholes",position);
    assert.equal(parseSurfaceAssignments(JSON.parse(JSON.stringify(plans)),["bank-2"])[0].position,position);
    assert.equal(setSurfaceAssignment(plans,"bank-2",wall.id,"reinforcement")[0].position,undefined);
    assert.equal(setSurfaceAssignment(plans,"bank-2",wall.id,"whole-wall",position)[0].position,undefined);
  }
});

test("player plan cards retain gadget controls and reference images while abilities omit resizing", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const jsxRuntime = await import("react/jsx-runtime");
  const source = await readFile(new URL("../app/StratBuilder.tsx",import.meta.url),"utf8");
  const start = source.indexOf("slots[activeSlot].gadgets.map((gadget, index) => {");
  const end = source.indexOf("\n                ) : (",start);
  const changes=[];
  const gadget={id:"qa",type:"shield",layoutId:"bank-1",rotation:45,imageUrls:["one.png","two.png"],description:"Hold the entrance"};
  const context={exports:{},require:()=>jsxRuntime,slots:[{gadgets:[gadget]}],activeSlot:0,activeSlotGadgetMarkerId:"qa",expandedSlotGadgetMarkerId:"qa",activeLayoutId:"bank-1",selectedMap:{layouts:[{id:"bank-1",label:"Basement"}]},getSlotPlacementLabel,getPlayerGadgetTool,MapModificationIcon:()=>null,slotDrawingColors:[{value:"#22e6c2"}],updateSlotGadgetMarker:(...args)=>changes.push(args),resizeSlotGadgetMarker:(...args)=>changes.push(args)};
  context.slotGadgetDropTargetId = null;
  context.activeAbilityName = undefined;
  context.slotEquipmentDrag = {current:null};
  context.activePhaseId = "phase-1";
  context.setSlotGadgetDropTargetId = ()=>{};
  context.reorderSlotGadget = (...args)=>changes.push(args);
  const render=()=>{runInNewContext(transpileModule(`globalThis.cards = ${source.slice(start,end)};`,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);return context.cards;};
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  let elements=render().flatMap(nodes);
  assert.equal(elements.filter(node=>node.type === "input").length,3);
  assert.equal(elements.find(node=>node.type === "textarea").props.value,"Hold the entrance");
  assert.equal(elements.find(node=>node.props?.["aria-label"] === "Collapse Shield").props["aria-expanded"],true);
  elements.find(node=>node.props?.["aria-label"] === "Rotate Shield clockwise 90 degrees").props.onClick();
  assert.equal(changes[0][2].rotation,135);
  elements.find(node=>node.props?.["aria-label"] === "Increase Shield size").props.onClick({stopPropagation(){}});
  assert.deepEqual(changes[1],[0,"qa",1]);
  gadget.type=undefined;
  elements=render().flatMap(nodes);
  assert.ok(!elements.some(node=>node.props?.["aria-label"]?.includes("clockwise")));
  assert.ok(!elements.some(node=>node.props?.["aria-label"]?.includes("size")));
  assert.equal(elements.filter(node=>node.type === "input").length,3);
  for (const file of ["StratBuilder.tsx","StratViewer.tsx"]) {
    const code = await readFile(new URL(`../app/${file}`,import.meta.url),"utf8");
    const marker = code.slice(code.indexOf('className={`slot-gadget-marker'));
    const expression = marker.match(/transform: `scale\(\$\{([^\n]+)\}\)`/)[1];
    for (const mapZoom of [0.5,1,2]) {
      assert.ok(Math.abs(runInNewContext(expression,{gadget:{size:1.5},mapMarkerScale:2,playerGadget:undefined,mapZoom,getAbilityIconScale}) - 3 / Math.pow(mapZoom,0.3)) < 1e-12);
      assert.ok(Math.abs(runInNewContext(expression,{gadget:{size:1.5},mapMarkerScale:2,playerGadget:{type:"shield"},mapZoom,getMapModificationIconScale}) - 3 * getMapModificationIconScale("shield")) < 1e-12);
    }
  }
  context.slots[0].gadgets.push({...gadget,id:"second"});
  const cards=render();
  const grip=nodes(cards[0]).find(node=>node.props?.["aria-label"] === "Reorder Ability 1");
  grip.props.onKeyDown({key:"ArrowDown",preventDefault(){}});
  assert.deepEqual(changes.at(-1),["qa","second"]);
  grip.props.onPointerDown({button:0,pointerId:1,preventDefault(){},stopPropagation(){},currentTarget:{setPointerCapture(){}}});
  context.slotEquipmentDrag.current.targetId="second";
  grip.props.onPointerUp({pointerId:1,currentTarget:{hasPointerCapture(){return false;}}});
  assert.deepEqual(changes.at(-1),["qa","second"]);
  assert.equal(context.slotEquipmentDrag.current,null);
  context.activeAbilityName="Remote Gas Grenade";
  assert.ok(render().flatMap(nodes).some(node=>node.props?.["aria-label"] === "Reorder Remote Gas Grenade"));
});

test("equipment reordering preserves placement data and the original list", () => {
  const items=[{id:"shield",x:12,y:34,layoutId:"bank-1",size:1.3,rotation:45},{id:"ability",description:"Cover entrance",imageUrls:["example.png"]},{id:"alarm",x:56,y:78}];
  const reordered=reorderSlotEquipment(items,"shield","alarm");
  assert.deepEqual(reordered.map(item=>item.id),["ability","alarm","shield"]);
  assert.deepEqual(items.map(item=>item.id),["shield","ability","alarm"]);
  assert.equal(reordered[2],items[0]);
  assert.deepEqual(reorderSlotEquipment(reordered,"shield","ability"),items);
  assert.equal(reorderSlotEquipment(items,"missing","alarm"),items);
  assert.equal(reorderSlotEquipment(items,"ability","ability"),items);
});

test("loaded viewer shares visibility across player briefings and retains phase context and legacy data", async () => {
  const {transpileModule,ModuleKind,JsxEmit}=await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/StratViewer.tsx",import.meta.url),"utf8");
  let state=[],cursor=0;
  const hooks={useEffect:()=>{},useMemo:fn=>fn(),useRef:()=>({current:null}),useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],value=>state[i]=typeof value==="function"?value(state[i]):value];}};
  const context={exports:{},require:name=>name==="react"?hooks:name==="react/jsx-runtime"?runtime:name==="./operator-data"?{operators:[]} :name==="./map-scale"?{getCalibratedMapView:()=>({defaultZoom:1,minimumZoom:1,maximumZoom:3,mapMarkerScale:1})}:name==="./map-mod-scale"?{getAbilityIconScale,getMapModificationIconScale}:name==="./player-gadgets"?{getPlayerGadgetTool,getSlotPlacementLabel,isSlotPlacementVisible}:name==="./map-surfaces"?{parseSurfaceAssignments:()=>[]}:name==="./map-mod-icon-style"?{getMapModIconStyle:()=>({})}:{}};
  runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree||typeof tree!=="object"?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const text=node=>!node||typeof node!=="object"?String(node??""):[node.props?.children].flat(Infinity).map(text).join("");
  const render=()=>{cursor=0;return nodes(context.exports.StratViewer({maps:tacticalMaps}));};
  const strat={name:"Legacy hold",mapSlug:"bank",layoutId:"bank-1",side:"Defense",phases:[{label:"Setup",startsAt:"3:00",slots:[{role:"Anchor",operators:["unknown"],gadget:"Hold site",notes:"Wait for the call",gadgets:[{id:"shield",type:"shield"},{id:"ability",type:"ability"}]},{role:"Support"}]},{label:"Execute",startsAt:"0:45",slots:[{role:"Anchor",gadget:"Deny the plant"},{role:"Support"}]}]};
  strat.phases[0].mapModifications={markers:[
    {typeId:"reinforcement",layoutId:"bank-1",position:{x:30,y:40}},
    {typeId:"headholes",layoutId:"bank-1",position:{x:40,y:40}},
    {typeId:"popped-hatch",layoutId:"bank-1",position:{x:50,y:40}},
    {typeId:"headholes",layoutId:"bank-2",position:{x:60,y:40}}
  ]};
  const modMarkers=tree=>tree.filter(n=>n.props?.className?.startsWith("map-modification-marker"));
  const start=render().find(n=>typeof n.type==="function"&&n.type.name==="ViewerStartScreen");
  start.props.onChange(JSON.stringify(strat));render().find(n=>typeof n.type==="function"&&n.type.name==="ViewerStartScreen").props.onLoad();
  let tree=render();assert.ok(tree.some(n=>n.type==="h1"&&text(n)==="Legacy hold"));
  assert.equal(modMarkers(tree).length,3);
  assert.match(source,/surfaces=\{\{visible:true,assignments:parseSurfaceAssignments/);
  const lineupCard=tree.find(n=>n.props?.className==="viewer-slot-card");
  const lineupChildren=nodes(lineupCard);
  const notesIndex=lineupChildren.findIndex(n=>n.props?.className==="viewer-lineup-notes");
  const planIndex=lineupChildren.findIndex(n=>n.type==="p"&&text(n).includes("Hold site"));
  assert.ok(notesIndex>=0&&notesIndex<planIndex);
  assert.equal(lineupChildren[notesIndex].type,"p");
  assert.ok(text(lineupCard).includes("Wait for the call"));
  assert.ok(text(lineupCard).includes("Shield"));
  assert.ok(!text(lineupCard).includes("Ability 2"));
  assert.ok(!nodes(tree.filter(n=>n.props?.className==="viewer-slot-card")[1]).some(n=>n.props?.className==="viewer-lineup-gadgets"));
  const heading=tree.find(n=>n.props?.className==="viewer-heading-row");
  assert.ok(nodes(heading).some(n=>n.props?.["aria-label"]==="Player slots"));
  const overview=nodes(heading).find(n=>n.type==="button"&&n.props["aria-label"]==="Team");
  assert.equal(nodes(heading).filter(n=>n.type==="button").at(-1),overview);
  assert.ok(!tree.some(n=>n.props?.className==="json-export viewer-import"));
  assert.equal(overview.props["aria-pressed"],true);
  assert.ok(!nodes(tree.find(n=>n.props?.className==="viewer-map-toolbar")).some(n=>n.type==="button"&&text(n)==="Team"));
  assert.ok(!nodes(tree.find(n=>n.props?.className==="viewer-map-panel")).some(n=>n.props?.["aria-label"]==="Player slots"));
  tree.find(n=>n.props?.["aria-label"]==="Open Slot 1: Anchor").props.onClick();
  tree=render();assert.ok(tree.some(n=>n.props?.className==="viewer-briefing-head"&&text(n).includes("Player briefing")));
  assert.equal(modMarkers(tree).length,3);
  assert.ok(tree.some(n=>n.props?.className?.includes("viewer-expanded-gadget-card")&&text(n).includes("Ability 2")));
  assert.equal(tree.find(n=>n.type==="button"&&n.props["aria-label"]==="Team").props["aria-pressed"],false);
  const operatorsToggle=tree.find(n=>n.type==="label"&&text(n).includes("Other operators"));
  nodes(operatorsToggle).find(n=>n.type==="input").props.onChange({target:{checked:true}});
  render().find(n=>n.props?.["aria-label"]==="Open Slot 2: Support").props.onClick();
  tree=render();assert.equal(nodes(tree.find(n=>n.type==="label"&&text(n).includes("Other operators"))).find(n=>n.type==="input").props.checked,true);
  tree.find(n=>n.type==="button"&&text(n).includes("Execute")).props.onClick();
  tree=render();assert.ok(tree.some(n=>n.type==="h1"&&text(n)==="Legacy hold"));
  assert.ok(tree.some(n=>n.type==="button"&&text(n).includes("Execute")&&text(n).includes("0:45")));
  assert.ok(!tree.some(n=>n.props?.className==="viewer-map-toolbar"));
  assert.equal(tree.find(n=>n.props?.["aria-label"]==="Open Slot 2: Support").props["aria-pressed"],true);
  tree.find(n=>n.type==="button"&&n.props["aria-label"]==="Team").props.onClick();
  assert.ok(render().some(n=>n.props?.className==="viewer-briefing-head"&&text(n).includes("Team lineup")));
  assert.equal(render().find(n=>n.type==="button"&&n.props["aria-label"]==="Team").props["aria-pressed"],true);
});

test("viewer starts imports at floor overview without discarding calibrated marker sizing", async () => {
  const source=await readFile(new URL("../app/StratViewer.tsx",import.meta.url),"utf8");
  const start=source.indexOf("  const defaultMapZoom =");
  const end=source.indexOf("  const markerScale =",start);
  const declarations=source.slice(start,end);
  for(const [canvasCoverZoom,baseMinimumMapZoom] of [[1,1],[1,1/1.45],[1.4,1/1.45]]){
    const context={canvasCoverZoom,baseMinimumMapZoom,calibratedView:{defaultZoom:2.84,minimumZoom:.71,maximumZoom:11.36,mapMarkerScale:1/2.84}};
    runInNewContext(declarations+'\nglobalThis.result={defaultMapZoom,minimumMapZoom,maximumMapZoom,mapMarkerScale};',context);
    assert.equal(context.result.defaultMapZoom,canvasCoverZoom*baseMinimumMapZoom);
    assert.ok(context.result.minimumMapZoom<=context.result.defaultMapZoom);
    assert.ok(context.result.maximumMapZoom>=context.result.defaultMapZoom);
    assert.equal(context.result.mapMarkerScale,1/2.84);
  }
  assert.match(source,/\[activeLayoutId, defaultMapZoom, loadedStrat\]/);
});

test("viewer map fills available space without a fixed aspect ratio and retains mobile flow", async () => {
  const styles=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(styles,/\.strat-viewer \.viewer-layout-grid\s*\{[^}]*align-items: stretch/s);
  assert.match(styles,/\.strat-viewer \.viewer-map-panel\s*\{[^}]*flex: 1 1 0/s);
  const canvasRule=styles.match(/\.strat-viewer \.viewer-canvas\s*\{[^}]*\}/)[0];
  assert.match(canvasRule,/width: 100%; height: 100%;/);
  assert.doesNotMatch(canvasRule,/aspect-ratio|100cqh/);
  assert.match(styles,/@media \(max-width: 760px\) \{ \.strat-viewer \.viewer-layout-grid \{ display: grid; \}\.strat-viewer \.viewer-canvas \{ width: 100%; height: clamp\(280px, 60vh, 560px\); \}/);
});

test("editor entry preserves map selection, side, start and JSON import actions", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/StratBuilder.tsx",import.meta.url),"utf8");
  const start=source.indexOf("  if (!isEditorSetupComplete) {");
  const end=source.indexOf("\n  return (",start);
  const calls=[];
  const context={exports:{},require:()=>runtime,isEditorSetupComplete:false,isJsonLoadOpen:false,setupMap:{name:"Bank",layouts:[{id:"bank-1"}]},setupMapSlug:"bank",setupSide:"Defense",maps:[{name:"Bank",slug:"bank"}],getMapPreviewStyle:()=>({backgroundPosition:"0% 0%"}),SetupSideIcon:()=>null,setSetupMapSlug:value=>calls.push(["map",value]),setSetupSide:value=>calls.push(["side",value]),setIsJsonLoadOpen:value=>calls.push(["import",value]),startEditorFromSetup:()=>calls.push(["start"]),renderDropdown:(id,label,value,options,onSelect)=>runtime.jsx("button",{"data-dropdown":id,onClick:()=>onSelect("oregon")})};
  runInNewContext(transpileModule(`function render(){${source.slice(start,end)}}\nglobalThis.entry=render();`,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const tree=nodes(context.entry);
  tree.find(node=>node.props?.["data-dropdown"] === "setup-map").props.onClick();
  const sides=tree.filter(node=>node.type === "button" && node.props?.["aria-pressed"] !== undefined);
  assert.equal(sides.length,2);
  assert.equal(sides[0].props["aria-pressed"],true);
  assert.equal(sides[1].props["aria-pressed"],false);
  sides[1].props.onClick();
  tree.find(node=>node.props?.["data-fd-id"] === "btn-start-editor").props.onClick();
  tree.find(node=>node.props?.["data-fd-id"] === "btn-open-json").props.onClick();
  assert.deepEqual(calls,[["map","oregon"],["side","Attack"],["start"],["import",true]]);
  assert.equal(tree.filter(node=>node.type === context.SetupSideIcon).length,4);
  assert.equal(tree.filter(node=>node.type === context.SetupSideIcon && node.props.watermark).length,2);
});

test("viewer start screen keeps JSON input, load action and parse error accessible", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/StratViewer.tsx",import.meta.url),"utf8");
  const component=source.slice(source.indexOf("function ViewerStartScreen("),source.indexOf("export function StratViewer("));
  const context={exports:{},require:()=>runtime};
  runInNewContext(transpileModule(component+'\nglobalThis.renderStart = ViewerStartScreen;',{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  let draft="",loads=0;
  const render=error=>nodes(context.renderStart({jsonInput:'{"mapSlug":"bank"}',parseError:error,onChange:value=>draft=value,onLoad:()=>loads++}));
  const normal=render("");
  const input=normal.find(node=>node.type === "textarea");
  assert.equal(input.props["aria-label"],"Paste strat JSON");
  assert.equal(input.props.value,'{"mapSlug":"bank"}');
  input.props.onChange({target:{value:"legacy JSON"}});
  assert.equal(draft,"legacy JSON");
  normal.find(node=>node.type === "button").props.onClick();
  assert.equal(loads,1);
  assert.ok(!normal.some(node=>node.props?.role === "alert"));
  const invalid=render("Invalid JSON.");
  assert.equal(invalid.find(node=>node.type === "textarea").props["aria-invalid"],true);
  assert.equal(invalid.find(node=>node.props?.role === "alert").props.children,"Invalid JSON.");
  assert.match(source,/if \(!loadedStrat\) \{\s+return <ViewerStartScreen/);
});

test("sidebar account entry preserves loading, retry, sign-in, setup and signed-in actions", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/AccountPanel.tsx",import.meta.url),"utf8");
  const context={exports:{},require:()=>runtime,isSelfHosted:false,CHATGPT_SIGN_IN_PATH:"/sign-in",CHATGPT_SIGN_OUT_PATH:"/sign-out"};
  runInNewContext(transpileModule(source.slice(source.indexOf("export function RailAccountEntry(")),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  let retries=0,opens=0;
  const render=controller=>nodes(context.exports.RailAccountEntry({controller:{reload:()=>retries++,...controller},onOpenAccount:()=>opens++}));
  assert.ok(render({status:"loading"}).some(node=>node.props?.role === "status"));
  const error=render({status:"error"});
  assert.ok(error.some(node=>node.props?.role === "alert"));
  error.find(node=>node.type === "button").props.onClick();
  assert.equal(retries,1);
  assert.equal(render({status:"ready",signedIn:false}).find(node=>node.type === "a").props.href,"/sign-in");
  render({status:"ready",signedIn:true}).find(node=>node.type === "button").props.onClick();
  const signedIn=render({status:"ready",signedIn:true,account:{username:"thermite_main"}});
  signedIn.find(node=>node.type === "button").props.onClick();
  assert.equal(opens,2);
  assert.equal(signedIn.find(node=>node.type === "button").props.title,"@thermite_main");
  assert.equal(signedIn.find(node=>node.type === "a").props.href,"/sign-out");
  context.isSelfHosted=true;
  const disabled=render({status:"ready",signedIn:true,account:{username:"forged"}});
  assert.equal(disabled.some(node=>node.type === "a" || node.type === "button"),false);
  assert.ok(disabled.some(node=>node.props?.children === "Coming soon"));
});

test("settings rows use accessible controlled Squish Switches without replacing preference handlers", async () => {
  const {transpileModule,ModuleKind,JsxEmit} = await import("typescript");
  const runtime=await import("react/jsx-runtime");
  const source=await readFile(new URL("../app/StratAppShell.tsx",import.meta.url),"utf8");
  const component=source.slice(source.indexOf("function SettingsOption("),source.indexOf("export function StratAppShell("));
  const calls=[];
  const context={exports:{},require:()=>runtime,SquishSwitch:()=>null,props:{title:"Dark Mode",description:"Theme preference",checked:true,appearance:true,onChange:value=>calls.push(value)}};
  runInNewContext(transpileModule(component+"\nglobalThis.row = SettingsOption(props);",{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const toggle=context.row.props.children[1];
  assert.equal(toggle.type,context.SquishSwitch);
  assert.equal(toggle.props.ariaLabel,"Dark Mode");
  assert.equal(toggle.props.checked,true);
  assert.equal(toggle.props.width,48);
  assert.ok(toggle.props.thumbContent);
  toggle.props.onChange(false);
  assert.deepEqual(calls,[false]);
  assert.equal((source.match(/<SettingsOption /g)??[]).length,5);
  assert.match(source,/onChange=\{changeAdvancedEditorMode\}/);
  assert.match(source,/showOtherGadgets: checked/);
});

test("reinforcement counter counts walls and shared hatches once across floors and follows edits", () => {
  const wall = getSurfaceLayout("bank-2").features.find(surface=>surface.kind === "wall");
  const hatch = getSurfaceLayout("bank-1").features.find(surface=>surface.kind === "hatch");
  let plans = setSurfaceAssignment([],"bank-2",wall.id,"reinforcement");
  plans = setSurfaceAssignment(plans,"bank-1",hatch.id,"reinforcement");
  assert.equal(countReinforcedSurfaces(plans),2);
  assert.equal(countReinforcedSurfaces([...plans,plans[1]]),2);
  const target = getSurfaceAssignmentTarget("bank-2",getDisplaySurfaceLayout("bank-2",tacticalMaps.find(map=>map.slug === "bank").layouts).features.find(surface=>surface.assignmentSurfaceId === hatch.id));
  plans = setSurfaceAssignment(plans,target.layoutId,target.surfaceId,"popped-hatch");
  assert.equal(countReinforcedSurfaces(plans),1);
  plans = setSurfaceAssignment(plans,"bank-2",wall.id,null);
  assert.equal(countReinforcedSurfaces(plans),0);
  assert.equal(countReinforcedSurfaces([]),0);
});

test("placed gadget icons use existing full-resolution assets and retain rotation and sprite fallback", async () => {
  for (const tool of playerGadgetTools) {
    const style = getMapModIconStyle(tool.sprite,45,true);
    assert.equal(style.backgroundSize,"contain");
    assert.equal(style.backgroundPosition,"center");
    assert.equal(style.transform,"rotate(45deg)");
    const path = style.backgroundImage.match(/^url\("(.+)"\)$/)[1];
    await access(new URL(`../public${path}`,import.meta.url));
    assert.equal(getMapModIconStyle(tool.sprite).backgroundImage,undefined);
  }
  const fallback = getMapModIconStyle({row:0,col:1},90,true);
  assert.equal(fallback.backgroundImage,undefined);
  assert.equal(fallback.backgroundPosition,"50% 0%");
  assert.equal(fallback.transform,"rotate(90deg)");
});

test("player gadgets have five explicit types and stay assigned to their player in detail view", () => {
  assert.deepEqual(playerGadgetTools.map(tool => tool.type), ["shield", "proximity-alarm", "observation-blocker", "bulletproof-camera", "barbed-wire"]);
  assert.equal(getSlotPlacementLabel(undefined, 0), "Ability 1");
  assert.equal(getPlayerGadgetTool("unknown"), undefined);
  for (const tool of playerGadgetTools) {
    assert.equal(getSlotPlacementLabel(tool.type, 0), tool.label);
    assert.equal(isSlotPlacementVisible(tool.type, 0, null, false), true);
    assert.equal(isSlotPlacementVisible(tool.type, 0, 0, false), true);
    assert.equal(isSlotPlacementVisible(tool.type, 1, 0, false), false);
    assert.equal(isSlotPlacementVisible(tool.type, 1, 0, true), false);
  }
  assert.equal(isSlotPlacementVisible(undefined, 1, 0, false), false);
  assert.equal(isSlotPlacementVisible(undefined, 1, 0, true), true);
});

test("slot JSON restores equipment ownership, floors, rotation and size alongside legacy abilities", async () => {
  const source = await readFile(new URL("../app/StratBuilder.tsx", import.meta.url), "utf8");
  const { transpileModule } = await import("typescript");
  const code = source.slice(source.indexOf("function createSlots("), source.indexOf("function createEmptyPhaseSnapshot(")) + source.slice(source.indexOf("  function findJsonLayout("), source.indexOf("  function getExportJsonText("));
  const context = {
    getMapProjectionScale, projectMapPoint, mapCoordinateAspectRatio,
    getPlayerGadgetTool, allModificationTools: playerGadgetTools,
    getDefaultLayoutId: map => map.layouts[0].id,
    getOperatorSlug: value => value,
    isPoint: value => Boolean(value && typeof value.x === "number" && typeof value.y === "number"),
    clamp: (value, min, max) => Math.min(Math.max(value, min), max),
    parseSurfaceAssignments, defaultMapModSize: 1, minMapModSize: 0.6, maxMapModSize: 1.8,
    maxSlotGadgets: 7, defaultDrawingColor: "#ffffff", defaultDrawingWidth: 4,
  };
  runInNewContext(transpileModule(code, {}).outputText, context);
  const map = {layouts:[{id:"qa-1",label:"1st Floor"},{id:"qa-2",label:"2nd Floor"}]};
  const ability = {id:"ability",position:{x:20,y:30},description:"Legacy ability"};
  const equipment = {id:"shield",type:"shield",layoutId:"qa-2",rotation:45,size:1.1,position:{x:40,y:50},description:"Hold doorway"};
  const strat = {layoutId:"qa-1",playerCount:2,slots:[{gadget:"Legacy plan",gadgets:[ability,equipment]},{gadgets:[{...equipment,id:"wire",type:"barbed-wire"}]}],mapModifications:{markers:[{...equipment,typeId:"shield"}]}};
  const first = context.createSnapshotFromJsonPhase(strat, {}, map);
  assert.equal(first.slots[0].gadget, "Legacy plan");
  assert.equal(first.slots[0].gadgets[0].type, undefined);
  assert.equal(first.slots[0].gadgets[0].rotation, 0);
  assert.equal(first.slots[0].gadgets[0].size, 1);
  const restored = first.slots[0].gadgets[1];
  assert.deepEqual([restored.type,restored.layoutId,restored.rotation,restored.size,restored.x,restored.y], ["shield","qa-2",45,1.1,40,50]);
  assert.equal(first.slots[1].gadgets[0].type, "barbed-wire");
  assert.equal(first.mapModificationMarkers[0].type, "shield");
  const second = context.createSnapshotFromJsonPhase(strat, {slots:[{gadgets:[ability]},{gadgets:[]}]}, map);
  assert.equal(second.slots[0].gadgets.length, 1);
  assert.equal(first.slots[0].gadgets.length, 2);
  for(const aspectRatio of [1,2.4]) {
    const projected=projectMapPoint({x:58,y:42},getMapProjectionScale(mapCoordinateAspectRatio,aspectRatio));
    const legacy={...strat,viewport:{aspectRatio},slots:[{position:projected,gadgets:[{...equipment,position:projected}]}],drawings:[{points:[projected]}],mapModifications:{markers:[{...equipment,typeId:"shield",position:projected}]}};
    const snapshot=context.createSnapshotFromJsonPhase(legacy,{},map);
    const override=context.createSnapshotFromJsonPhase({...legacy,viewport:{aspectRatio:3}},{viewport:{aspectRatio}},map);
    for(const state of [snapshot,override]) for(const point of [state.slots[0].marker,state.slots[0].gadgets[0],state.drawingStrokes[0].points[0],state.mapModificationMarkers[0]]) {
      assert.ok(Math.abs(point.x-58)<1e-9);
      assert.ok(Math.abs(point.y-42)<1e-9);
    }
  }
});

test("placed Map Mod sizes apply individual defaults while retaining manual size multipliers", () => {
  for (const [type, factor] of [["popped-hatch", 1.05], ["proximity-alarm", 0.72], ["bulletproof-camera", 0.64], ["shield", 0.72], ["observation-blocker", 0.8], ["barbed-wire", 0.8], ["reinforcement", 1], ["unknown", 1]]) {
    for (const size of [0.6, 1, 1.8]) {
      assert.ok(Math.abs(size * getMapModificationIconScale(type) - size * 2.8 * factor) < 1e-12);
    }
  }
});
import { surfaceActions, getSurfaceLayout, getDisplaySurfaceLayout, findSurfaceAssignment, getSurfaceAssignmentTarget, parseSurfaceAssignments, setSurfaceAssignment } from "../app/map-surfaces.ts";
import { parseRectanglePath, parseTransform, transformPoint, rectanglePoints, splitWall, inverse } from "../app/map-surface-geometry.ts";

test("wall plan icons face north while position labels retain the wall angle", async () => {
  const {transpileModule,ModuleKind,JsxEmit}=await import("typescript");
  const jsxRuntime=await import("react/jsx-runtime");
  const {surfaceActions}=await import("../app/map-surfaces.ts");
  const source=await readFile(new URL("../app/MapSurfaceLayer.tsx",import.meta.url),"utf8");
  let surface,assignment;
  const context={exports:{},require:name=>name === "react/jsx-runtime" ? jsxRuntime : {
    getDisplaySurfaceLayout:()=>({viewBox:"0 0 100 100",features:[surface]}),
    findSurfaceAssignment:()=>assignment,surfaceActions,
  }};
  runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,context);
  const nodes=tree=>!tree || typeof tree !== "object" ? [] : [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  for(const angle of [0,45,90,-45]) for(const position of [undefined,"left","middle","right"]) for(const action of ["headholes","crouching-rotation","reinforcement"]) {
    const radians=angle*Math.PI/180;
    const project=(x,y)=>({x:50+x*Math.cos(radians)-y*Math.sin(radians),y:50+x*Math.sin(radians)+y*Math.cos(radians)});
    surface={id:"wall",kind:"wall",points:[project(-20,-2),project(20,-2),project(20,2),project(-20,2)]};
    assignment={action,position};
    const tree=nodes(context.exports.MapSurfaceLayer({layoutId:"qa",visible:true}));
    const group=tree.find(node=>node.props?.className === "map-surface-plan-label");
    const image=tree.find(node=>node.type === "image");
    const wallAngle=Number(group.props.transform.match(/rotate\(([^)]+)\)/)[1]);
    const iconRotation=image.props.transform.match(/rotate\(([^ ]+) ([^ ]+) ([^)]+)\)/).slice(1).map(Number);
    assert.ok(Math.abs(wallAngle+iconRotation[0])<1e-10,"icon must cancel wall rotation");
    assert.equal(iconRotation[1],image.props.x+image.props.width/2,"rotate around the icon center to retain its position");
    assert.equal(iconRotation[2],0);
    const text=tree.find(node=>node.type === "text");
    if(position) {
      assert.equal(text.props.transform,undefined,"position label must retain the parent wall rotation");
      assert.equal(text.props.children,position === "left" ? "←" : position === "right" ? "→" : "Middle");
    } else assert.equal(text,undefined);
  }
});

test("permanent walls and hatches remain visible with surface interaction disabled", async () => {
  const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
  const jsxRuntime = await import("react/jsx-runtime");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { surfaceActions } = await import("../app/map-surfaces.ts");
  const source = await readFile(new URL("../app/MapSurfaceLayer.tsx", import.meta.url), "utf8");
  const context = {exports:{},require:name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "./map-surfaces") return {getDisplaySurfaceLayout,findSurfaceAssignment,surfaceActions};
    throw new Error(`Unexpected import: ${name}`);
  }};
  runInNewContext(transpileModule(source, {compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText, context);
  const layoutId = tacticalMaps.find(map=>map.slug === "bank").layouts[0].id;
  const count = getSurfaceLayout(layoutId).features.length;
  for (const interactive of [false,true]) {
    const html = renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId,visible:true,interactive}));
    assert.equal((html.match(/class="map-surface-shape/g) ?? []).length,count);
    assert.equal((html.match(/class="map-surface-hit/g) ?? []).length,interactive ? count : 0);
    assert.match(html,/fill="#ffcc00" fill-opacity="0.24"/);
    assert.match(html,/stroke="#ffcc00" stroke-opacity="0.55"/);
  }
  const builder = await readFile(new URL("../app/StratBuilder.tsx", import.meta.url), "utf8");
  assert.match(builder,/surfaces=\{\{visible:true,assignments:surfaceAssignments,interactive:isDefenseSide/);
  assert.match(builder,/showMapMods=\{showMapModsOverlay\}/);
  const mapLayouts = tacticalMaps.find(map=>map.slug === "bank").layouts;
  const html = renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId:"bank-2",mapLayouts,visible:true}));
  assert.equal((html.match(/data-hatch-direction="above"/g) ?? []).length,3);
  assert.equal((html.match(/data-hatch-direction="below"/g) ?? []).length,5);
  assert.match(html,/fill="#ffe680" fill-opacity="0.24"/);
  assert.match(html,/fill="#b38a00" fill-opacity="0.24"/);
  assert.match(html,/stroke="#ffe680" stroke-opacity="0.35"/);
  assert.match(html,/stroke="#b38a00" stroke-opacity="0.35"/);
  assert.doesNotMatch(html,/class="map-surface-hit"/);
  const hatch = getSurfaceLayout("bank-1").features.find(surface=>surface.kind === "hatch");
  const plannedHtml = renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId:"bank-2",mapLayouts,assignments:[{layoutId:"bank-1",surfaceId:hatch.id,action:"popped-hatch"}]}));
  assert.doesNotMatch(plannedHtml,/<text/);
  assert.match(plannedHtml,/fill="#a875d6" fill-opacity="0.65"/);
  assert.match(plannedHtml,/stroke-opacity="1"/);
  assert.equal((plannedHtml.match(/class="map-surface-shape/g) ?? []).length,1);
  assert.match(plannedHtml,/class="map-surface-plan-icon is-hatch" href="\/icons\/wall-menu\/popped-hatch.png"/);
  await access(new URL("../public/icons/wall-menu/popped-hatch.png",import.meta.url));
  const reinforcedHatchHtml=renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId:"bank-2",mapLayouts,assignments:[{layoutId:"bank-1",surfaceId:hatch.id,action:"reinforcement"}]}));
  const iconDimensions=markup=>markup.match(/<image[^>]*width="([^"]+)" height="([^"]+)"/).slice(1);
  for(const [index,dimension] of iconDimensions(plannedHtml).entries()) {
    assert.ok(Math.abs(Number(dimension)/Number(iconDimensions(reinforcedHatchHtml)[index])-1.2)<1e-10);
  }
  const wall = getSurfaceLayout("bank-2").features.find(surface=>surface.kind === "wall");
  for (const [action,color,text] of [
    ["reinforcement","#a65f4d",""], ["footholes","#42f47b","Foot"],
    ["headholes","#42f47b","Head"], ["topholes","#42f47b","Top"],
    ["whole-wall","#42f47b","Whole"],
    ["vault-rotation","#3aa8ff","Walk"], ["crouching-rotation","#3aa8ff","Crouching"],
    ["standing-rotation","#3aa8ff","Vault"],
  ]) {
    const markup = renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId:"bank-2",mapLayouts,assignments:[{layoutId:"bank-2",surfaceId:wall.id,action}]}));
    assert.ok(markup.includes(`fill="${color}"`));
    assert.doesNotMatch(markup,/<text/);
    const icon=surfaceActions.find(option=>option.action === action).icon;
    assert.ok(markup.includes(`href="${icon}"`));
    await access(new URL(`../public${icon}`,import.meta.url));
  }
  for(const [position,label] of [["left","←"],["middle","Middle"],["right","→"]]) {
    for(const [action,text] of [["headholes","Head"],["crouching-rotation","Crouching"]]) {
      const markup=renderToStaticMarkup(context.exports.MapSurfaceLayer({layoutId:"bank-2",mapLayouts,assignments:[{layoutId:"bank-2",surfaceId:wall.id,action,position}]}));
      assert.ok(markup.includes(`>${label}</text>`));
      assert.ok(markup.includes('class="map-surface-plan-icon"'));
      assert.ok(!markup.includes(`>${text} ${label}</text>`));
      const iconX=Number(markup.match(/<image[^>]* x="([^"]+)"/)[1]);
      const positionX=Number(markup.match(/<text[^>]* x="([^"]+)"/)[1]);
      assert.ok(position === "left" ? positionX < iconX : positionX > iconX);
    }
  }
});

test("each hatch connects adjacent floors and both sides share one backward-compatible plan", () => {
  let connections = 0;
  for (const map of tacticalMaps) {
    for (const [index,floor] of map.layouts.entries()) {
      const raw = getSurfaceLayout(floor.id);
      if (!raw) continue;
      const display = getDisplaySurfaceLayout(floor.id,map.layouts);
      assert.deepEqual(display.features.filter(surface=>surface.kind === "wall"),raw.features.filter(surface=>surface.kind === "wall"));
      const lower = index > 0 ? getSurfaceLayout(map.layouts[index-1].id) : undefined;
      assert.equal(display.features.filter(surface=>surface.hatchDirection === "below").length,lower?.features.filter(surface=>surface.kind === "hatch").length ?? 0);
      for (const hatch of raw.features.filter(surface=>surface.kind === "hatch")) {
        connections++;
        const upper = map.layouts[index+1];
        assert.ok(upper,`${floor.id} hatch has an upper floor`);
        assert.equal(Number(upper.floorImage.match(/floor_(-?\d+)/)[1]),Number(floor.floorImage.match(/floor_(-?\d+)/)[1])+1);
        assert.equal(getSurfaceLayout(upper.id).viewBox,raw.viewBox);
        const mirrored = getDisplaySurfaceLayout(upper.id,map.layouts).features.find(surface=>surface.assignmentLayoutId === floor.id && surface.assignmentSurfaceId === hatch.id);
        assert.ok(mirrored);
        assert.deepEqual(mirrored.points,hatch.points);
        assert.equal(mirrored.hatchDirection,"below");
        assert.equal(display.features.find(surface=>surface.id === hatch.id).hatchDirection,"above");
        const target = getSurfaceAssignmentTarget(upper.id,mirrored);
        let plans = setSurfaceAssignment([],target.layoutId,target.surfaceId,"reinforcement");
        assert.equal(plans.length,1);
        assert.equal(findSurfaceAssignment(plans,floor.id,hatch).action,"reinforcement");
        assert.equal(findSurfaceAssignment(plans,upper.id,mirrored).action,"reinforcement");
        plans = parseSurfaceAssignments(JSON.parse(JSON.stringify(plans)),map.layouts.map(layout=>layout.id));
        plans = setSurfaceAssignment(plans,target.layoutId,target.surfaceId,"popped-hatch");
        assert.equal(findSurfaceAssignment(plans,floor.id,hatch).action,"popped-hatch");
        assert.deepEqual(setSurfaceAssignment(plans,target.layoutId,target.surfaceId,null),[]);
      }
    }
  }
  assert.equal(connections,144);
});

test("human-reviewed walls split equally and migrate old plans without coupling new panels", () => {
  for (const [layoutId, sourceId, count] of [["emeraldplains-1", "rect5307-93-4-5-8", 2], ["fortress-floor-2", "rect5655-0-66-37-6-6", 3]]) {
    const panels = getSurfaceLayout(layoutId).features.filter(feature => feature.sourceId === sourceId);
    assert.equal(panels.length, count);
    assert.ok(panels.every(panel => !panel.needsReview && panel.legacySurfaceId === `${sourceId}:0`));
    const lengths = panels.map(panel => Math.max(...[1,3].map(index => Math.hypot(panel.points[index].x-panel.points[0].x, panel.points[index].y-panel.points[0].y))));
    assert.ok(Math.max(...lengths)-Math.min(...lengths) < 0.0002);
    for (let i = 1; i < panels.length; i++) {
      const previous = panels[i-1].points;
      assert.equal(panels[i].points.filter(point => previous.some(other => other.x===point.x && other.y===point.y)).length, 2);
    }
    const migrated = parseSurfaceAssignments([{layoutId,surfaceId:`${sourceId}:0`,action:"reinforcement"}], [layoutId]);
    assert.equal(migrated.length, count);
    const edited = setSurfaceAssignment(migrated,layoutId,panels[0].id,"headholes");
    assert.equal(edited.find(item=>item.surfaceId===panels[0].id).action,"headholes");
    assert.ok(edited.filter(item=>item.surfaceId!==panels[0].id).every(item=>item.action==="reinforcement"));
    assert.deepEqual(parseSurfaceAssignments(JSON.parse(JSON.stringify(edited)),[layoutId]),edited);
  }
  const tower = getSurfaceLayout("tower-floor-2").features.filter(feature => feature.sourceId === "rect3199-41");
  assert.deepEqual(tower.map(feature=>feature.id), ["rect3199-41:0", "rect3199-41:1"]);
  assert.ok(tower.every(feature=>!feature.needsReview && !feature.legacySurfaceId));
});

test("SVG wall extraction follows transforms and real dividers, rejecting guessed geometry", () => {
  assert.deepEqual(parseRectanglePath("M494.12 131.557h14.483v14.977H494.12z"), {x:494.12,y:131.557,width:14.483000000000004,height:14.977000000000004});
  assert.equal(parseRectanglePath("M0 0C1 2 3 4 5 6z"), null);
  assert.equal(parseRectanglePath("M0 0h10v2h-8z"), null);
  const r = {x:0,y:0,width:24,height:2};
  const divider = rectanglePoints({x:11.5,y:0,width:1,height:2});
  const unrelated = rectanglePoints({x:5,y:10,width:1,height:2});
  assert.deepEqual(splitWall(r,[divider,divider,unrelated]), [{x:0,y:0,width:12,height:2},{x:12,y:0,width:12,height:2}]);
  const matrix = parseTransform("translate(100 50) rotate(30) scale(2 3)");
  const actual = transformPoint(transformPoint({x:7,y:4},matrix),inverse(matrix));
  assert.ok(Math.abs(actual.x-7)<1e-10 && Math.abs(actual.y-4)<1e-10);
  assert.throws(()=>parseTransform("skewX(30)"), /Unsupported/);
});

test("surface registry covers every registered overlay and preserves individually split walls", async () => {
  for (const map of tacticalMaps) for (const floor of map.layouts) {
    if (!floor.mapModsImage) continue;
    const data = getSurfaceLayout(floor.id);
    assert.ok(data, floor.id);
    assert.equal(data.source, floor.mapModsImage);
    await access(new URL(`../public${data.source}`,import.meta.url));
    assert.equal(new Set(data.features.map(f=>f.id)).size,data.features.length);
    for (const feature of data.features) {
      assert.equal(feature.points.length,4);
      assert.ok(feature.points.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
  }
  const basement = getSurfaceLayout("bank-1");
  assert.equal(basement.features.filter(f=>f.kind==="wall").length,15);
  assert.equal(basement.features.filter(f=>f.kind==="hatch").length,5);
  const wall = basement.features.find(f=>f.sourceId==="rect1058");
  assert.ok(Math.abs(wall.points[0].x-(198.949+451.185))<1e-6);
});

test("surface JSON defaults safely, validates types, and keeps phases and floors independent", () => {
  const wall = getSurfaceLayout("bank-1").features.find(f=>f.kind==="wall");
  const hatch = getSurfaceLayout("bank-1").features.find(f=>f.kind==="hatch");
  const phaseOne = setSurfaceAssignment([],"bank-1",wall.id,"reinforcement");
  const phaseTwo = setSurfaceAssignment(phaseOne,"bank-1",wall.id,"headholes");
  assert.equal(phaseOne[0].action,"reinforcement");
  assert.equal(phaseTwo[0].action,"headholes");
  const otherFloor = getSurfaceLayout("bank-2").features[0];
  const withFloor = setSurfaceAssignment(phaseTwo,"bank-2",otherFloor.id,"reinforcement");
  const json = JSON.parse(JSON.stringify(withFloor));
  assert.deepEqual(parseSurfaceAssignments(json,["bank-1","bank-2"]),withFloor);
  assert.deepEqual(setSurfaceAssignment(withFloor,"bank-1",wall.id,null),[withFloor[1]]);
  assert.deepEqual(parseSurfaceAssignments(undefined,["bank-1"]),[]);
  assert.deepEqual(parseSurfaceAssignments([{layoutId:"bank-1",action:"reinforcement"}],["bank-1"]),[]);
  assert.deepEqual(parseSurfaceAssignments([null,{surfaceId:wall.id,layoutId:"missing",action:"reinforcement"},{surfaceId:hatch.id,layoutId:"bank-1",action:"headholes"},{surfaceId:wall.id,layoutId:"bank-1",action:"popped-hatch"},{surfaceId:"missing",layoutId:"bank-1",action:"reinforcement"}],["bank-1"]),[]);
});

test("wall planning uses compact grouped menus while retaining persisted surface actions", async () => {
  const wall = getSurfaceLayout("bank-1").features.find(feature=>feature.kind==="wall");
  const topHoles = setSurfaceAssignment([],"bank-1",wall.id,"topholes");
  assert.equal(topHoles[0].action,"topholes");
  assert.deepEqual(parseSurfaceAssignments(JSON.parse(JSON.stringify(topHoles)),["bank-1"]),topHoles);
  assert.equal(surfaceActions.find(option=>option.action==="vault-rotation")?.label,"Walk Rotation");

  const menu = await readFile(new URL("../app/MapSurfaceMenu.tsx",import.meta.url),"utf8");
  assert.match(menu,/type WallMenuView = "root" \| "holes" \| "rotation"/);
  assert.match(menu,/Reinforcement/);
  assert.match(menu,/Holes/);
  assert.match(menu,/Rotation/);
  assert.match(menu,/Unmodified/);
  assert.match(menu,/Foot Holes/);
  assert.match(menu,/Head Holes/);
  assert.match(menu,/Top Holes/);
  assert.match(menu,/Whole Wall/);
  assert.match(menu,/Vault Rotation/);
  assert.match(menu,/Crouching Rotation/);
  assert.match(menu,/\{ action: "vault-rotation", label: "Walk Rotation"/);
  assert.match(menu,/aria-label="Back to wall options"/);
  assert.match(menu,/surface\.kind === "wall" && wallMenuView === "root"/);

  const styles = await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(styles,/\.surface-plan-menu\s*\{[^}]*width: 280px/s);
  assert.match(styles,/\.surface-plan-options\.is-root\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles,/\.surface-plan-options\.is-root > \.surface-plan-option\s*\{[^}]*min-height: 42px/s);
  assert.match(styles,/\.surface-plan-options\.is-submenu\s*\{[^}]*grid-template-columns: 1fr/s);
  assert.match(styles,/\.surface-plan-option-icon/);
  assert.match(styles,/\.surface-plan-menu \.surface-plan-option\.is-unmodified\s*\{[^}]*border-style: dashed;[^}]*background: transparent/s);
  assert.match(styles,/\.surface-plan-option\.is-unmodified\[aria-pressed="true"\]\s*\{[^}]*box-shadow: inset 2px 0 0 rgba\(143, 164, 161, 0\.48\)/s);
});

test("editor phase snapshots save and restore surface plans alongside existing state", async () => {
  const source = await readFile(new URL("../app/StratBuilder.tsx",import.meta.url),"utf8");
  const {transpileModule} = await import("typescript");
  const snapshotCode = source.slice(source.indexOf("  function createCurrentPhaseSnapshot()"),source.indexOf("  function findJsonMap("));
  const surfaceAssignments = [{surfaceId:"rect1058:0",layoutId:"bank-1",action:"reinforcement"}];
  const restored = {};
  const context = {layoutId:"bank-1",playerCount:3,side:"Defense",activeSlot:0,slots:[],mapModifications:"notes",mapModificationMarkers:[],drawingStrokes:[],surfaceAssignments,defaultMapZoom:1,activePhaseId:"phase-1"};
  for (const name of ["LayoutId","PlayerCount","Side","ActiveSlot","Slots","MapModifications","MapModificationMarkers","DrawingStrokes","SurfaceAssignments","SelectedSurface","ActiveMapModificationMarkerId","PendingGadgetSlotIndex","ActiveSlotGadgetMarkerId","ExpandedSlotGadgetMarkerId","EditorPanel","MapZoom","MapPan"]) context[`set${name}`] = value=>{restored[name]=value;};
  runInNewContext(transpileModule(snapshotCode,{}).outputText,context);
  const first = context.createCurrentPhaseSnapshot();
  context.surfaceAssignments = [];
  const second = context.createCurrentPhaseSnapshot();
  context.applyPhaseSnapshot(first);
  assert.equal(restored.SurfaceAssignments,surfaceAssignments);
  context.applyPhaseSnapshot(second);
  assert.equal(restored.SurfaceAssignments.length,0);
});

test("all 27 calibrated maps share a world scale in both viewport shapes and every floor", async () => {
  const calibration = parseMapCalibration(JSON.parse(await readFile(new URL("../app/map-calibration.json", import.meta.url), "utf8")));
  assert.equal(Object.keys(calibration.measurements).length, tacticalMaps.length);
  for (const map of tacticalMaps) {
    const measurement = calibration.measurements[map.slug];
    const measuredFloor = map.layouts.find(floor => floor.id === measurement.layoutId);
    assert.ok(measuredFloor, map.slug);
    assert.equal(measurement.image, measuredFloor.floorImage ?? measuredFloor.image);
    for (const layout of map.layouts) {
      for (const [width, height] of [[624, 856], [944, 756], [1600, 900]]) {
        const artworkScale = layout.imageTransform?.scale ?? 1;
        const view = getCalibratedReferenceView(calibration, map.slug, width, height, artworkScale);
        const referencePixels = getReferenceLength(measurement) * Math.max(width, height * measurement.imageWidth / measurement.imageHeight) * artworkScale * view.defaultZoom;
        assert.ok(Math.abs(referencePixels - standardReferencePixels) < 1e-9, `${map.slug} ${layout.id}`);
        assert.ok(Math.abs(14 * view.mapMarkerScale * view.defaultZoom - 14) < 1e-9);
        assert.ok(Math.abs(14 * view.mapMarkerScale * view.defaultZoom * 2 - 28) < 1e-9);
        assert.ok(view.minimumZoom < view.defaultZoom && view.maximumZoom > view.defaultZoom);
      }
    }
  }
  assert.deepEqual(getCalibratedReferenceView(calibration, "unknown", 944, 756, 1, 1.5), { defaultZoom: 1.5, minimumZoom: 1.5, maximumZoom: 3, mapMarkerScale: 1 });
});

test("map calibration measures native image distance independently of tool zoom", () => {
  const record = { layoutId: "bank-1", image: "/floor.webp", imageWidth: 2000, imageHeight: 1000, points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.4 }] };
  assert.ok(Math.abs(getReferenceLength(record) - Math.sqrt(0.02)) < 1e-12);
  assert.equal(getReferenceLength({ ...record, imageWidth: 4000, imageHeight: 2000 }), getReferenceLength(record));
  const smaller = { ...record, points: [{ x: 0.1, y: 0.2 }, { x: 0.15, y: 0.3 }] };
  const data = { version: 1, referenceLabel: "Hatch edge", referenceMapSlug: "bank", measurements: { bank: record, chalet: smaller } };
  const factors = getCalibrationFactors(parseMapCalibration(JSON.parse(JSON.stringify(data))));
  assert.deepEqual(parseMapCalibration({ ...data, scaleFactors: factors }), data);
  assert.equal(factors.bank, 1);
  assert.ok(Math.abs(factors.chalet - 2) < 1e-12);
  assert.throws(() => parseMapCalibration({ ...data, measurements: { bank: { ...record, points: [record.points[0], record.points[0]] } } }), /invalid reference/);
  assert.throws(() => parseMapCalibration({ ...data, referenceMapSlug: "missing" }), /reference map is missing/);
  assert.throws(() => parseMapCalibration({ ...data, measurements: { bank: { ...record, imageWidth: 0 } } }), /invalid reference/);
});

test("the one-time calibration tool is separate from the normal editor", async () => {
  const response = await render("/map-calibration");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Map scale calibration/);
  assert.match(html, /Save measurement/);
  assert.match(html, /Export calibration JSON/);
  assert.match(html, /Load calibration JSON/);
  assert.doesNotMatch(html, /Mark the active slot position/);
});

test("map dimensions are measured when editor and viewer canvases first appear", async () => {
  const {transpileModule}=await import("typescript");
  for (const component of ["StratBuilder", "StratViewer"]) {
    const source = await readFile(new URL(`../app/${component}.tsx`, import.meta.url), "utf8");
    const effect = source.match(/useEffect\(\(\) => \{\s*const canvas = canvasRef\.current;(?:(?!useEffect)[\s\S])*?function updateCoverZoom\(\)[\s\S]*?\}, \[[^\]]*\]\);/)?.[0];
    assert.ok(effect, `${component} has a canvas measurement effect`);
    const canvasRef = { current: null };
    let previousDependencies;
    let cleanup;
    let resize;
    let observed;
    let aspectRatio = 16 / 9;
    let coverZoom = 1;
    let disconnected = 0;
    const frames=new Map();
    let nextFrame=0;
    const context = {
      canvasRef,
      activeLayoutId: "bank-1",
      isEditorSetupComplete: false,
      loadedStrat: null,
      getCoverZoom: (width, height) => Math.max(1, (width / height) / (16 / 9), (16 / 9) / (width / height)),
      setCanvasCoverZoom: (value) => { coverZoom = value; },
      setCanvasAspectRatio: (value) => { aspectRatio = value; },
      setCanvasSize() {},
      window:{requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)},
      ResizeObserver: class {
        constructor(callback) { resize = callback; }
        observe(canvas) { observed = canvas; }
        disconnect() { disconnected += 1; }
      },
      useEffect(callback, dependencies) {
        if (!previousDependencies || dependencies.some((value, index) => !Object.is(value, previousDependencies[index]))) {
          cleanup?.();
          cleanup = callback();
          previousDependencies = dependencies;
        }
      },
    };
    const script=transpileModule(effect,{}).outputText;
    runInNewContext(script, context);
    let dimensions = { width: 960, height: 800 };
    canvasRef.current = { getBoundingClientRect: () => dimensions, get clientWidth(){return dimensions.width;}, get clientHeight(){return dimensions.height;} };
    context.isEditorSetupComplete = true;
    context.loadedStrat = { layoutId: "bank-1" };
    runInNewContext(script, context);
    assert.equal(observed, canvasRef.current, `${component} observes the newly mounted canvas without a floor change`);
    assert.equal(aspectRatio, 1.2);
    assert.ok(coverZoom > 1);
    dimensions = { width: 1600, height: 600 };
    resize();
    for(const [id,callback] of frames){frames.delete(id);callback();}
    assert.equal(aspectRatio, 1600/600);
    assert.equal(coverZoom, 1.5);
    if (component === "StratViewer") {
      canvasRef.current = null;
      context.loadedStrat = null;
      runInNewContext(script, context);
      assert.equal(disconnected, 1);
      canvasRef.current = { clientWidth:800,clientHeight:800,getBoundingClientRect: () => ({ width: 800, height: 800 }) };
      context.loadedStrat = { layoutId: "bank-1" };
      runInNewContext(script, context);
      assert.equal(observed, canvasRef.current);
      assert.equal(aspectRatio, 1);
    }
    cleanup?.();
  }
});

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const request = new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    });
  if (typeof worker === "function") return worker(request);
  return worker.fetch(
    request,
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("dashboard previews future discovery without pretending community data exists", async () => {
  const html = await (await render()).text();
  assert.match(html, /href="#dashboard"[^>]*aria-current="page"/);
  assert.ok(html.indexOf('href="#dashboard"') < html.indexOf('href="#strat-editor"'));
  assert.match(html, /Every round starts with a plan/);
  assert.match(html, /id="dashboard-search"[^>]*disabled=""[^>]*aria-describedby="dashboard-search-note"/);
  assert.match(html, /Search by strat name or username/);
  assert.equal((html.match(/class="dashboard-strat-card"/g) ?? []).length, 5);
  assert.match(html, /These examples are not published strategies/);
  assert.match(html, /Most liked strats/);
  assert.match(html, /role="group" aria-label="Most liked time period" aria-describedby="dashboard-likes-note"/);
  assert.match(html, /aria-pressed="true"[^>]*>This Week<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>This Month<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>This Year<\/button>/);
  assert.equal((html.match(/data-fd-id="row-ranking-\d"/g) ?? []).length, 6);
  assert.match(html, /id="strat-editor"[^>]*hidden=""/);
  assert.match(html, /id="view-strat"[^>]*hidden=""/);
  const shell = await readFile(new URL("../app/StratAppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /hidden=\{activeMode !== "editor"\}/);
  assert.match(shell, /hidden=\{activeMode !== "viewer"\}/);
});

test("appearance defaults to dark and keeps a saved preference, including without storage", async () => {
  const source = await readFile(new URL("../app/StratAppShell.tsx", import.meta.url), "utf8");
  const { transpileModule } = await import("typescript");
  const preference = source.slice(source.indexOf('type Theme ='), source.indexOf('export type SlotDetailViewSettings'));
  const script = transpileModule(preference, {}).outputText;
  const storage = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const context = { window, Event };
  runInNewContext(script, context);
  assert.equal(context.getServerTheme(), "dark");
  assert.equal(context.getTheme(), "dark");
  storage.set("r6-stratshare-theme", "light");
  assert.equal(context.getTheme(), "light");
  let notifications = 0;
  const unsubscribe = context.subscribeToTheme(() => notifications++);
  context.changeTheme("dark");
  assert.equal(storage.get("r6-stratshare-theme"), "dark");
  assert.equal(context.getTheme(), "dark");
  storage.set("r6-stratshare-theme", "light");
  window.dispatchEvent(new Event("storage"));
  assert.equal(context.getTheme(), "light");
  window.localStorage.getItem = () => { throw new Error("Storage blocked"); };
  window.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  context.changeTheme("light");
  assert.equal(context.getTheme(), "light");
  context.changeTheme("dark");
  assert.equal(context.getTheme(), "dark");
  assert.equal(notifications, 4);
  unsubscribe();
  context.changeTheme("light");
  assert.equal(notifications, 4);
  const html = await (await render()).text();
  assert.match(html, /id="rail-dark-mode"[^>]*role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /id="rail-dark-mode"[^>]*aria-label="Dark Mode"/);
  assert.doesNotMatch(html, /for="rail-dark-mode"/);
  assert.match(html, /class="squish-switch__thumb"[^>]*>[\s\S]*?<svg class="theme-switch-icon" data-mode="dark"/);
  assert.doesNotMatch(html, /class="rail-theme-button"/);
  assert.match(html, />General<\/button>/);
  assert.match(html, /Appearance/);
  assert.match(html, /data-fd-id="field-settings-dark-mode"/);
});

test("server-renders the R6 StratShare homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /R6 StratShare/);
  assert.match(html, /Strat Creator/);
  assert.doesNotMatch(html, /Creator Status|maps ready/);
  assert.match(html, />Load</);
  assert.match(html, /Start a new strat/);
  assert.match(html, /Select the map and side before opening the editor\./);
  assert.match(html, />Start Editor</);
  assert.match(html, />Defense</);
  assert.match(html, /View Strat/);
  assert.match(html, /<html[^>]+lang="en"/);
  assert.doesNotMatch(html, /Click to mark Slot/);
  assert.doesNotMatch(html, /Layout \/ Floor/);
  assert.doesNotMatch(html, /Custom workspace|Save draft|JSON Export/);
  assert.doesNotMatch(html, /1 to 3 operators per slot/);
  assert.doesNotMatch(html, /Prepare locally|Map, layout, slots, and operators/);
  assert.doesNotMatch(html, /Eigener Arbeitsbereich|Strat JSON anzeigen|Operatoren|Spieler|Seite/);
  assert.doesNotMatch(html, /Assets|Operator Pool|operator-roster|asset-panel/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("site metadata and assets are product-specific", async () => {
  const [page, appShell, stratBuilder, stratViewer, operatorIcon, mapLayoutImage, styles, layout, packageJson, operatorData, mapData] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StratAppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StratBuilder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StratViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OperatorIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MapLayoutImage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/operator-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/map-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /StratAppShell/);
  assert.match(page, /tacticalMaps/);
  assert.match(mapLayoutImage, /function InlineSvgOverlay/);
  assert.match(mapLayoutImage, /sanitizeInlineSvg/);
  assert.match(mapLayoutImage, /function getLayerStyle/);
  assert.match(mapLayoutImage, /translate\(\$\{layout\.floorOffset\.x\}px, \$\{layout\.floorOffset\.y\}px\)/);
  assert.match(mapLayoutImage, /scale\(\$\{scale\}\)/);
  assert.match(mapLayoutImage, /const baseLayerStyle = getLayerStyle\(layout\)/);
  assert.match(mapLayoutImage, /const floorLayerStyle = getLayerStyle\(layout, true\)/);
  assert.match(mapLayoutImage, /className="map-layer-base"[\s\S]*style=\{baseLayerStyle\}/);
  assert.match(mapLayoutImage, /className="map-layer-floor"[\s\S]*style=\{floorLayerStyle\}/);
  assert.match(mapLayoutImage, /<InlineSvgOverlay className="map-layer-overlay map-layer-callouts"[\s\S]*style=\{baseLayerStyle\}/);
  assert.match(mapLayoutImage, /<img alt="" aria-hidden="true" className=\{className\}/);
  assert.doesNotMatch(mapLayoutImage, /map-layer-map-mods"[\s\S]{0,180}style=\{floorLayerStyle\}/);
  assert.doesNotMatch(mapLayoutImage, /map-layer-bombsites"[\s\S]{0,180}style=\{floorLayerStyle\}/);
  assert.doesNotMatch(page, /panel-head/);
  assert.doesNotMatch(page, /topbar|Custom workspace|Save draft|JSON Export/);
  assert.doesNotMatch(page, /Prepare locally|Map, layout, slots, and operators/);
  assert.match(appShell, /editor-mode/);
  assert.match(appShell, /StratBuilder/);
  assert.match(appShell, /StratViewer/);
  assert.match(appShell, /View Strat/);
  assert.match(appShell, /"settings"/);
  assert.match(appShell, /getModeHref/);
  assert.match(appShell, /type SettingsTab = "view"/);
  assert.match(appShell, /settingsTabs/);
  assert.match(appShell, /activeSettingsTab/);
  assert.match(appShell, /className="settings-shell"/);
  assert.match(appShell, /className="settings-tabs"/);
  assert.match(appShell, /type SlotDetailViewSettings/);
  assert.match(appShell, /defaultSlotDetailViewSettings/);
  assert.match(appShell, /slotDetailViewSettings/);
  assert.match(appShell, /slotDetailViewSettings=\{slotDetailViewSettings\}/);
  assert.match(appShell, /Slot Detail View/);
  assert.match(appShell, /Show other operators/);
  assert.match(appShell, /Show other lines/);
  assert.match(appShell, /Show other abilities/);
  assert.doesNotMatch(appShell, /Export/);
  assert.match(stratBuilder, /function requestMapChange/);
  assert.match(stratBuilder, /function applyMapChange/);
  assert.match(stratBuilder, /function getDefaultLayoutId/);
  assert.match(stratBuilder, /layout\.label\.toLowerCase\(\) === "1st floor"/);
  assert.match(stratBuilder, /useState\(\(\) => getDefaultLayoutId\(selectedMap\)\)/);
  assert.match(stratBuilder, /setLayoutId\(getDefaultLayoutId\(nextMap\)\)/);
  assert.match(stratBuilder, /function requestSideChange/);
  assert.match(stratBuilder, /function applySideChange/);
  assert.match(stratBuilder, /function sideHasResettableChanges/);
  assert.match(stratBuilder, /function removeSelectedOperator/);
  assert.match(stratBuilder, /function editorHasChanges/);
  assert.match(stratBuilder, /type StratPhaseSnapshot/);
  assert.match(stratBuilder, /type StratPhase/);
  assert.match(stratBuilder, /createEmptyPhaseSnapshot/);
  assert.match(stratBuilder, /const \[phases, setPhases\]/);
  assert.match(stratBuilder, /const \[activePhaseId, setActivePhaseId\]/);
  assert.match(stratBuilder, /function createCurrentPhaseSnapshot/);
  assert.match(stratBuilder, /function saveActivePhaseSnapshot/);
  assert.match(stratBuilder, /function applyPhaseSnapshot/);
  assert.match(stratBuilder, /function updatePhaseStart/);
  assert.match(stratBuilder, /const \[editingPhaseId, setEditingPhaseId\]/);
  assert.match(stratBuilder, /function updatePhaseLabel/);
  assert.match(stratBuilder, /function stopEditingPhase/);
  assert.match(stratBuilder, /function addPhase/);
  assert.match(stratBuilder, /drawingStrokes: \[\]/);
  assert.match(stratBuilder, /const maxPhaseCount = 10/);
  assert.match(stratBuilder, /phases\.length >= maxPhaseCount/);
  assert.match(stratBuilder, /function removePhase/);
  assert.match(stratBuilder, /phaseId === "phase-1"/);
  assert.match(stratBuilder, /function changePhase/);
  assert.match(stratBuilder, /mapModifications/);
  assert.match(stratBuilder, /mapModificationMarkers/);
  assert.match(stratBuilder, /activeMapModificationMarkerId/);
  assert.match(stratBuilder, /drawingStrokes/);
  assert.match(stratBuilder, /isDrawingMode/);
  assert.match(stratBuilder, /drawingColor/);
  assert.match(stratBuilder, /isEraserMode/);
  assert.match(stratBuilder, /drawingWidth/);
  assert.match(stratBuilder, /visibleDrawingStrokes/);
  assert.match(stratBuilder, /visibleSlotDrawingColors/);
  assert.match(stratBuilder, /visibleMapModificationMarkers/);
  assert.match(stratBuilder, /layoutId: string/);
  assert.match(stratBuilder, /rotation: number/);
  assert.match(stratBuilder, /size: number/);
  assert.match(stratBuilder, /floorOnlyModificationTypes/);
  const floorOnlyTypesBlock = stratBuilder.match(/floorOnlyModificationTypes = new Set<ModificationType>\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  assert.doesNotMatch(floorOnlyTypesBlock, /"popped-hatch"/);
  assert.match(stratBuilder, /visibleMapModificationMarkers = mapModificationMarkers\.filter/);
  assert.match(stratBuilder, /marker\.layoutId !== activeLayoutId/);
  assert.match(stratBuilder, /activeModificationType/);
  assert.match(stratBuilder, /type ModificationType/);
  assert.match(stratBuilder, /standing-rotation/);
  assert.match(stratBuilder, /crouching-rotation/);
  assert.match(stratBuilder, /vault-rotation/);
  assert.match(stratBuilder, /headholes/);
  assert.match(stratBuilder, /footholes/);
  assert.match(stratBuilder, /popped-hatch/);
  assert.match(stratBuilder, /reinforcement/);
  assert.match(stratBuilder, /shield/);
  assert.match(stratBuilder, /barbed-wire/);
  assert.match(stratBuilder, /proximity-alarm/);
  assert.match(stratBuilder, /bulletproof-camera/);
  assert.match(stratBuilder, /observation-blocker/);
  assert.match(stratBuilder, /sprite: \{ row: 0, col: 1 \}/);
  assert.equal(getPlayerGadgetTool("proximity-alarm").sprite.col, 2);
  assert.match(stratBuilder, /function MapModificationIcon/);
  assert.match(
    stratBuilder,
    /const modificationToolGrid[\s\S]*modificationTools\[0\][\s\S]*modificationTools\[1\][\s\S]*modificationTools\[2\][\s\S]*modificationTools\[5\][\s\S]*modificationTools\[3\][\s\S]*modificationTools\[4\][\s\S]*modificationTools\[6\][\s\S]*null/,
  );
  assert.match(stratBuilder, /editorPanel/);
  assert.match(stratBuilder, /Map Mods/);
  assert.match(stratBuilder, /"editor-panel-tabs slots-only"/);
  assert.doesNotMatch(stratBuilder, /className=\{editorPanel === "map-modifications" \? "map-mod-tab active"/);
  assert.match(stratBuilder, /map-modifications-panel/);
  assert.match(stratBuilder, /className="mod-tool-icon"/);
  assert.match(stratBuilder, /Rotations, footholes, lines of sight, barricades\.\.\./);
  assert.match(stratBuilder, /function addMapModificationMarker/);
  assert.match(stratBuilder, /function removeMapModificationMarker/);
  assert.match(stratBuilder, /function selectMapModificationMarker/);
  assert.match(stratBuilder, /function moveMapModificationMarker/);
  assert.match(stratBuilder, /function startMapModificationDrag/);
  assert.match(stratBuilder, /function moveMapModificationDrag/);
  assert.match(stratBuilder, /function endMapModificationDrag/);
  assert.match(stratBuilder, /type SlotMarkerDragState/);
  assert.match(stratBuilder, /function startSlotMarkerDrag/);
  assert.match(stratBuilder, /function moveSlotMarkerDrag/);
  assert.match(stratBuilder, /function endSlotMarkerDrag/);
  assert.match(stratBuilder, /function startDrawingStroke/);
  assert.match(stratBuilder, /function appendDrawingPoint/);
  assert.match(stratBuilder, /function endDrawingStroke/);
  assert.match(stratBuilder, /function undoDrawingStroke/);
  assert.match(stratBuilder, /useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(stratBuilder, /mapModificationListItems = useRef<Record<string, HTMLDivElement \| null>>\(\{\}\)/);
  assert.match(stratBuilder, /scrollIntoView\(\{/);
  assert.match(stratBuilder, /block: "nearest"/);
  assert.match(stratBuilder, /function rotateMapModificationMarker/);
  assert.match(stratBuilder, /function resizeMapModificationMarker/);
  assert.match(stratBuilder, /function dragModification/);
  assert.match(stratBuilder, /function dropModification/);
  assert.match(stratBuilder, /onDragOver=\{allowModificationDrop\}/);
  assert.match(stratBuilder, /onDrop=\{dropModification\}/);
  assert.match(stratBuilder, /className=\{`layout-canvas/);
  assert.match(stratBuilder, /role="button"[\s\S]*tabIndex=\{0\}/);
  assert.match(stratBuilder, /isDrawingMode \? " is-drawing" : ""/);
  assert.match(stratBuilder, /className="drawing-layer"/);
  assert.match(stratBuilder, /visibleDrawingStrokes\.map\(\(stroke, strokeIndex\)/);
  assert.match(stratBuilder, /drawing-eraser-mask-\$\{stroke\.id\}/);
  assert.match(stratBuilder, /visibleDrawingStrokes\.slice\(strokeIndex \+ 1\)\.filter/);
  assert.match(stratBuilder, /eraserStroke\.isEraser/);
  assert.match(stratBuilder, /mask=\{`url\(#drawing-eraser-mask-\$\{stroke\.id\}\)`\}/);
  assert.match(stratBuilder, /stroke\.isEraser/);
  assert.match(stratBuilder, /stroke=\{stroke\.color\}/);
  assert.match(stratBuilder, /strokeWidth=\{stroke\.width \/ 12\}/);
  assert.match(stratBuilder, /className=\{isDrawingMode \? "drawing-toggle active" : "drawing-toggle"\}/);
  assert.match(stratBuilder, /Toggle drawing mode/);
  assert.match(stratBuilder, /className="drawing-panel"/);
  assert.match(stratBuilder, /className="drawing-actions"/);
  assert.match(stratBuilder, /Undo last drawing stroke/);
  assert.match(stratBuilder, /className="undo-drawing"/);
  assert.match(stratBuilder, /Toggle eraser/);
  assert.match(stratBuilder, /title="Eraser"/);
  assert.match(stratBuilder, /\/icons\/eraser-streamline-solar\.svg/);
  assert.match(stratBuilder, /operatorSlugs/);
  assert.match(stratBuilder, /typeId/);
  assert.doesNotMatch(stratBuilder, />Eraser</);
  assert.match(stratBuilder, /aria-pressed=\{isEraserMode\}/);
  assert.match(stratBuilder, /Drawing stroke width/);
  assert.match(stratBuilder, /max=\{22\}/);
  assert.match(stratBuilder, /min=\{1\}/);
  assert.match(stratBuilder, /drawingColors\.map/);
  assert.match(stratBuilder, /className="drawing-slot-colors"/);
  assert.match(stratBuilder, /visibleSlotDrawingColors\.map/);
  assert.match(stratBuilder, /map-modification-marker mod-\$\{marker\.type\} has-icon/);
  assert.match(stratBuilder, /Select \$\{getModificationLabel\(marker\.type\)\} \$\{index \+ 1\}/);
  assert.match(stratBuilder, /onClick=\{\(event\) => selectMapModificationMarker\(event, marker\.id\)\}/);
  assert.match(stratBuilder, /onPointerDown=\{\(event\) => startMapModificationDrag\(event, marker\.id\)\}/);
  assert.match(stratBuilder, /onPointerMove=\{moveMapModificationDrag\}/);
  assert.match(stratBuilder, /onPointerUp=\{endMapModificationDrag\}/);
  assert.match(stratBuilder, /onPointerCancel=\{endMapModificationDrag\}/);
  assert.match(stratBuilder, /aria-current=\{isActiveMapModification \? "true" : undefined\}/);
  assert.match(stratBuilder, /className=\{`mod-marker-item\$\{isActiveMapModification \? " active" : ""\}\$\{isOffFloorMapModification \? " is-off-floor" : ""\}`\}/);
  assert.match(stratBuilder, /mapModificationListItems\.current\[marker\.id\] = element/);
  assert.match(stratBuilder, /const markerTypeIndex = visibleMapModificationMarkers/);
  assert.match(stratBuilder, /\.filter\(\(item\) => item\.type === marker\.type\)\.length/);
  assert.match(stratBuilder, /className="mod-marker-count"/);
  assert.match(stratBuilder, /\{markerTypeIndex\}/);
  assert.match(stratBuilder, /rotation=\{marker\.rotation\}/);
  assert.match(stratBuilder, /Rotate \$\{getModificationLabel\(marker\.type\)\} 90 degrees/);
  assert.match(stratBuilder, /Rotate \$\{getModificationLabel\(marker\.type\)\} 45 degrees/);
  assert.match(stratBuilder, /className="mod-marker-rotate"/);
  assert.match(stratBuilder, /↻ 90/);
  assert.match(stratBuilder, /↻ 45/);
  assert.match(stratBuilder, /Increase \$\{getModificationLabel\(marker\.type\)\} size/);
  assert.match(stratBuilder, /Decrease \$\{getModificationLabel\(marker\.type\)\} size/);
  assert.match(stratBuilder, /className="mod-marker-size"/);
  assert.match(stratBuilder, /className="remove-map-mod"/);
  assert.match(stratBuilder, /className="remove-map-mod"[\s\S]*>\s*X\s*<\/button>/);
  assert.match(stratBuilder, /isDefenseSide && visibleMapModificationMarkers\.map/);
  assert.match(stratBuilder, /editorPanel === "map-modifications" && isDefenseSide/);
  assert.match(stratBuilder, /nextSide !== "Defense"/);
  assert.match(stratBuilder, /No map modifications placed yet/);
  assert.match(stratBuilder, /function AutoGrowTextarea/);
  assert.match(stratBuilder, /textarea\.style\.height = "42px"/);
  assert.match(stratBuilder, /textarea\.scrollHeight/);
  assert.match(stratBuilder, /rows=\{1\}/);
  assert.match(stratBuilder, /function renderDropdown/);
  assert.match(stratBuilder, /custom-select-trigger/);
  assert.match(stratBuilder, /className="custom-select-menu"/);
  assert.match(stratBuilder, /role="listbox"/);
  assert.match(stratBuilder, /role="option"/);
  assert.doesNotMatch(stratBuilder, /<select/);
  assert.doesNotMatch(stratBuilder, /className="slot-readout"|Not marked yet/);
  assert.match(stratBuilder, /pendingMapSlug/);
  assert.match(stratBuilder, /pendingSide/);
  assert.match(stratBuilder, /role="dialog"/);
  assert.match(stratBuilder, /Changing the map will clear selected operators/);
  assert.match(stratBuilder, /Switching sides will clear selected operators, ability plans, and gadgets/);
  assert.match(stratBuilder, /Roles and marked positions will stay in place/);
  assert.doesNotMatch(stratBuilder, /window\.confirm/);
  assert.match(stratBuilder, /mapZoom/);
  assert.match(stratBuilder, /const \[canvasCoverZoom, setCanvasCoverZoom\]/);
  assert.match(stratBuilder, /const \[canvasAspectRatio, setCanvasAspectRatio\] = useState\(mapArtworkAspectRatio\)/);
  assert.match(stratBuilder, /function getCoverZoom/);
  assert.match(stratBuilder, /const baseMinimumMapZoom = selectedLayout\?\.imageTransform\?\.scale/);
  assert.match(stratBuilder, /const minimumMapZoom = calibratedView\.minimumZoom/);
  assert.match(stratBuilder, /getCalibratedMapView\(mapSlug, canvasSize\.width, canvasSize\.height/);
  assert.match(stratBuilder, /transform: `scale\(\$\{marker\.size \* mapMarkerScale \* getMapModificationIconScale\(marker\.type\)\}\)`/);
  assert.match(stratBuilder, /typeof ResizeObserver === "undefined"/);
  assert.match(stratBuilder, /new ResizeObserver\(updateCoverZoom\)/);
  assert.match(stratBuilder, /setCanvasAspectRatio\(Number\(\(rect\.width \/ rect\.height\)\.toFixed\(4\)\)\)/);
  assert.match(stratBuilder, /const markerScale = Number\(\(1 \/ mapZoom\)\.toFixed\(4\)\)/);
  assert.doesNotMatch(stratBuilder, /mapModScreenScale/);
  assert.match(stratBuilder, /mapPan/);
  assert.match(stratBuilder, /function handleCanvasWheel/);
  assert.match(stratBuilder, /addEventListener\("wheel", handleCanvasWheel, \{ passive: false \}\)/);
  assert.match(stratBuilder, /event\.stopPropagation\(\)/);
  assert.match(stratBuilder, /clamp\(current \+ direction \* 0\.15, minimumMapZoom, maximumMapZoom\)/);
  assert.match(stratBuilder, /function startCanvasPan/);
  assert.match(stratBuilder, /function moveCanvasPan/);
  assert.match(stratBuilder, /event\.preventDefault\(\)/);
  assert.match(stratBuilder, /showCallouts=\{showCalloutsOverlay\}/);
  assert.match(stratBuilder, /showMapMods=\{showMapModsOverlay\}/);
  assert.match(stratBuilder, /showBombsites=\{showBombsitesOverlay\}/);
  assert.match(stratBuilder, /className="map-overlay-toggles"/);
  assert.match(stratBuilder, /Toggle map callouts/);
  assert.match(stratBuilder, /Toggle map modifications overlay/);
  assert.match(stratBuilder, /Toggle bomb site icons/);
  assert.match(stratBuilder, /\/icons\/r6-callout-icon\.png/);
  assert.match(stratBuilder, /\/icons\/r6-modifications-icon\.png/);
  assert.match(stratBuilder, /\/icons\/r6-locations-icon\.png/);
  assert.match(stratViewer, /showCallouts=\{showCalloutsOverlay\}/);
  assert.match(stratViewer, /showMapMods=\{showMapModsOverlay\}/);
  assert.match(stratViewer, /showBombsites=\{showBombsitesOverlay\}/);
  assert.match(stratViewer, /className="map-overlay-toggles"/);
  assert.match(mapLayoutImage, /layout\.baseImage/);
  assert.match(mapLayoutImage, /className="map-layer-stack"/);
  assert.match(mapLayoutImage, /className="map-layer-floor"/);
  assert.match(mapLayoutImage, /showCallouts/);
  assert.match(mapLayoutImage, /layout\.calloutImage/);
  assert.match(mapLayoutImage, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(mapLayoutImage, /showMapMods/);
  assert.match(mapLayoutImage, /layout\.mapModsImage/);
  assert.match(mapLayoutImage, /showBombsites/);
  assert.match(mapLayoutImage, /layout\.bombsiteImage/);
  assert.match(mapLayoutImage, /draggable=\{false\}/);
  assert.doesNotMatch(stratBuilder, /onWheel=\{handleCanvasWheel\}/);
  assert.match(stratBuilder, /onPointerMove=\{moveCanvasPan\}/);
  assert.doesNotMatch(stratBuilder, /canvas-hint|Click to mark Slot|Wheel zoom|Drag to pan/);
  assert.match(stratBuilder, /setPlayerCount\(3\)/);
  assert.match(stratBuilder, /setSlots\(createSlots\(3\)\)/);
  assert.match(stratBuilder, /setMapModifications\(""\)/);
  assert.match(stratBuilder, /setMapModificationMarkers\(\[\]\)/);
  assert.match(stratBuilder, /setDrawingStrokes\(\[\]\)/);
  assert.match(stratBuilder, /setIsDrawingMode\(false\)/);
  assert.match(stratBuilder, /setEditorPanel\("slots"\)/);
  assert.match(stratBuilder, /function slotHasChanges/);
  assert.match(stratBuilder, /function resetSlot/);
  assert.match(stratBuilder, /className="slot-tab-item"/);
  assert.match(stratBuilder, /className=\{editorPanel === "slots" && index === activeSlot \? "slot-tab-button active" : "slot-tab-button"\}/);
  assert.match(stratBuilder, /aria-label=\{`Reset Slot \$\{index \+ 1\}`\}/);
  assert.match(stratBuilder, /resetSlot\(index\)/);
  assert.match(stratBuilder, /operators: \[\]/);
  assert.match(stratBuilder, /gadget: ""/);
  assert.match(stratBuilder, /gadgets: \[\]/);
  assert.match(stratBuilder, /imageUrls: \[\]/);
  assert.match(stratBuilder, /description: ""/);
  assert.match(stratBuilder, /iconUrl: gadget\.imageUrls\[0\] \?\? ""/);
  assert.match(stratBuilder, /imageUrls: gadget\.imageUrls\.filter/);
  assert.match(stratBuilder, /description: gadget\.description/);
  assert.match(stratBuilder, /const maxSlotGadgets = 7/);
  assert.match(stratBuilder, /pendingGadgetSlotIndex/);
  assert.match(stratBuilder, /activeSlotGadgetMarkerId/);
  assert.match(stratBuilder, /expandedSlotGadgetMarkerId/);
  assert.match(stratBuilder, /setExpandedSlotGadgetMarkerId\(id\)/);
  assert.match(stratBuilder, /type SlotGadgetDragState/);
  assert.match(stratBuilder, /function addSlotGadgetMarker/);
  assert.match(stratBuilder, /function updateSlotGadgetMarker/);
  assert.match(stratBuilder, /function resizeSlotGadgetMarker/);
  assert.match(stratBuilder, /function updateSlotGadgetImageUrl/);
  assert.match(stratBuilder, /function removeSlotGadgetMarker/);
  assert.match(stratBuilder, /function startSlotGadgetDrag/);
  assert.match(stratBuilder, /function moveSlotGadgetDrag/);
  assert.match(stratBuilder, /function endSlotGadgetDrag/);
  assert.match(stratBuilder, /gadgets: slot\.gadgets\.map/);
  assert.match(stratBuilder, /className=\{`slot-gadget-marker marker-\$\{slotIndex \+ 1\}\$\{playerGadget \? " has-player-gadget" : ""\}\$\{gadgetIcon \? " has-ability-icon" : ""\}\$\{isActiveGadgetMarker \? " active" : ""\}\$\{isOffFloorGadgetMarker \? " is-off-floor" : ""\}`\}/);
  assert.match(stratBuilder, /onPointerDown=\{\(event\) => startSlotGadgetDrag\(event, slotIndex, gadget\.id\)\}/);
  assert.match(stratBuilder, /className="slot-gadget-list"/);
  assert.match(stratBuilder, /className=\{`slot-gadget-item\$\{isActiveGadget \? " active" : ""\}\$\{isOffFloorGadget \? " is-off-floor" : ""\}\$\{isExpandedGadget \? " expanded" : ""\}\$\{slotGadgetDropTargetId === gadget\.id \? " is-drop-target" : ""\}`\}/);
  assert.match(stratBuilder, /className="slot-gadget-summary"/);
  assert.match(stratBuilder, /className=\{isExpandedGadget \? "slot-gadget-expand open" : "slot-gadget-expand"\}/);
  assert.match(stratBuilder, /className="slot-gadget-remove"/);
  assert.match(stratBuilder, /aria-label=\{`Remove \$\{placementLabel\}`\}/);
  assert.match(stratBuilder, /const gadgetIcon = playerGadget \? undefined : gadgetOperator\?\.gadgetIcon/);
  assert.match(stratBuilder, /className="slot-gadget-ability-icon"/);
  assert.match(stratBuilder, /transform: `scale\(\$\{gadget\.size \* mapMarkerScale \* \(playerGadget \? getMapModificationIconScale\(playerGadget\.type\) : 1\)\}\)`/);
  assert.doesNotMatch(stratBuilder, /slot-gadget-marker[\s\S]{0,900}transform: `scale\(\$\{markerScale\}\)`/);
  assert.doesNotMatch(stratBuilder, /className="slot-gadget-icon"/);
  assert.match(stratBuilder, /type="url"/);
  assert.match(stratBuilder, /placeholder=\{`PNG image URL \$\{imageIndex \+ 1\}\.\.\.`\}/);
  assert.match(stratBuilder, /placeholder="Describe this ability or gadget\.\.\."/);
  assert.match(stratBuilder, /className="slot-gadget-size-controls"/);
  assert.match(stratBuilder, /resizeSlotGadgetMarker\(activeSlot, gadget\.id, 1\)/);
  assert.match(stratBuilder, /resizeSlotGadgetMarker\(activeSlot, gadget\.id, -1\)/);
  assert.match(stratBuilder, /aria-label=\{`Add \$\{activeAbilityName \?\? "ability"\} to Slot \$\{activeSlot \+ 1\}`\}/);
  assert.match(stratBuilder, /aria-label=\{`Add gadget to Slot \$\{activeSlot \+ 1\}`\}/);
  assert.match(stratBuilder, /notes: ""/);
  assert.match(stratBuilder, /aria-label=\{`Remove \$\{operator\.name\}`\}/);
  assert.doesNotMatch(stratBuilder, /operator-limit|1 to 3 operators per slot/);
  assert.match(stratBuilder, /className="remove-operator">X/);
  assert.match(stratBuilder, /const markerOperator = slot\.operators\[0\]/);
  assert.match(stratBuilder, /className=\{`position-marker marker-\$\{index \+ 1\}\$\{markerOperator \? " has-operator" : ""\}\$\{isOffFloorSlotMarker \? " is-off-floor" : ""\}`\}/);
  assert.match(stratBuilder, /key=\{`slot-marker-\$\{index\}`\}/);
  assert.match(stratBuilder, /onPointerLostCapture=\{endSlotMarkerDrag\}/);
  assert.doesNotMatch(stratBuilder, /key=\{`\$\{index\}-\$\{slot\.marker\.x\}-\$\{slot\.marker\.y\}/);
  assert.match(stratBuilder, /onPointerDown=\{\(event\) => startSlotMarkerDrag\(event, index\)\}/);
  assert.match(stratBuilder, /onPointerMove=\{moveSlotMarkerDrag\}/);
  assert.match(stratBuilder, /transform: `scale\(\$\{markerScale\}\)`/);
  assert.match(stratBuilder, /if \(slots\[activeSlot\]\?\.marker\) \{\s*return;\s*\}/);
  assert.match(stratBuilder, /import \{ OperatorIcon \} from "\.\/OperatorIcon"/);
  assert.match(stratBuilder, /<OperatorIcon alt=\{`\$\{markerOperator\.name\} marker`\} operator=\{markerOperator\} size=\{28\} detailed \/>/);
  assert.match(stratBuilder, /<OperatorIcon operator=\{operator\} size=\{18\} \/>/);
  assert.match(stratBuilder, /<OperatorIcon operator=\{operator\} size=\{34\} \/>/);
  assert.match(stratBuilder, /className="operator-name"/);
  assert.doesNotMatch(stratBuilder, /eagerOperatorIconCount|loading=\{index < eagerOperatorIconCount/);
  assert.match(stratBuilder, /role: ""/);
  assert.match(stratBuilder, /placeholder="Set a role\.\.\."/);
  assert.match(stratBuilder, /className="slot-form-title"/);
  assert.match(stratBuilder, /Slot \{activeSlot \+ 1\}/);
  assert.doesNotMatch(stratBuilder, /placeholder="Placement, reason, lineups\.\.\."/);
  assert.match(stratBuilder, /placeholder="Overall function of this player\.\.\."/);
  assert.match(stratBuilder, /notes: slot\.notes/);
  assert.match(stratBuilder, /markers: mapModificationMarkers\.map/);
  assert.match(stratBuilder, /viewport: \{\s*aspectRatio: mapCoordinateAspectRatio,\s*\}/);
  assert.match(stratBuilder, /layoutId: selectedLayout\?\.id/);
  assert.match(stratBuilder, /layoutId: slot\.marker\?\.layoutId/);
  assert.match(stratBuilder, /drawings: drawingStrokes\.map/);
  assert.match(stratBuilder, /phases: phases\.map/);
  assert.match(stratBuilder, /const \[stratName, setStratName\]/);
  assert.match(stratBuilder, /const \[pendingJsonAction, setPendingJsonAction\]/);
  assert.match(stratBuilder, /name: stratName\.trim\(\)/);
  assert.match(stratBuilder, /setStratName\(typeof parsed\.name === "string" \? parsed\.name : ""\)/);
  assert.match(stratBuilder, /function requestNamedJsonAction/);
  assert.match(stratBuilder, /function confirmStratNameDialog/);
  assert.match(stratBuilder, /function copyStratJson/);
  assert.match(stratBuilder, /navigator\.clipboard\.writeText/);
  assert.match(stratBuilder, /const \[copyToastStatus, setCopyToastStatus\]/);
  assert.match(stratBuilder, /window\.setTimeout\(\(\) => setCopyToastStatus\(""\), 3000\)/);
  assert.match(stratBuilder, /setCopyToastStatus\("Copied"\)/);
  assert.match(stratBuilder, /className="layout-copy-toast"/);
  assert.match(stratBuilder, /async function exportStratJsonFile/);
  assert.match(stratBuilder, /showSaveFilePicker/);
  assert.match(stratBuilder, /URL\.createObjectURL\(blob\)/);
  assert.match(stratBuilder, /-R6StratShare\.txt/);
  assert.match(stratBuilder, /function importStratJson/);
  assert.match(stratBuilder, /const \[isJsonLoadOpen, setIsJsonLoadOpen\]/);
  assert.doesNotMatch(stratBuilder, /setJsonStatus\("Strat JSON copied\."\)/);
  assert.match(stratBuilder, /Paste strat JSON to continue editing/);
  assert.match(stratBuilder, /Continue editing a saved strat/);
  assert.match(stratBuilder, /className="json-load-backdrop"/);
  assert.match(stratBuilder, /className="json-load-dialog"/);
  assert.match(stratBuilder, /className="json-load-dialog strat-name-dialog"/);
  assert.match(stratBuilder, /className="strat-name-input"/);
  assert.match(stratBuilder, /This name is saved into the JSON and will be shown in View Strat\./);
  assert.match(stratBuilder, /className="json-quick-actions"/);
  assert.match(stratBuilder, /className="json-copy-button"/);
  assert.match(stratBuilder, /className="json-load-button"/);
  assert.match(stratBuilder, /className="json-save-button"/);
  assert.match(stratBuilder, /className="json-copy-button" onClick=\{\(\) => requestNamedJsonAction\("save"\)\}/);
  assert.match(stratBuilder, /className="json-save-button" onClick=\{\(\) => requestNamedJsonAction\("export"\)\}/);
  assert.match(stratBuilder, /setIsJsonLoadOpen\(false\)/);
  assert.doesNotMatch(stratBuilder, /<details id="export" className="json-export">/);
  assert.doesNotMatch(stratBuilder, /<summary>JSON<\/summary>/);
  assert.doesNotMatch(stratBuilder, /className="json-workspace"/);
  assert.doesNotMatch(stratBuilder, /className="json-column-head"/);
  assert.doesNotMatch(stratBuilder, /Current strat/);
  assert.doesNotMatch(stratBuilder, /Continue editing<\/span>/);
  assert.doesNotMatch(stratBuilder, /Load JSON into editor/);
  assert.match(stratBuilder, /function createSnapshotFromJsonPhase/);
  assert.match(stratBuilder, /phase\.id === activePhaseId \? createCurrentPhaseSnapshot\(\) : phase\.snapshot/);
  assert.match(stratBuilder, /startsAt: phase\.startsAt/);
  assert.match(stratBuilder, /new Set\(\s*\[\.\.\.\(Array\.isArray\(gadget\.imageUrls\)/);
  assert.match(stratViewer, /Load Strat/);
  assert.match(stratViewer, /name\?: string/);
  assert.match(stratViewer, /const loadedStratName = loadedStrat\?\.name\?\.trim\(\)/);
  assert.match(stratViewer, /\{loadedStratName \|\| selectedMap\.name\}/);
  assert.match(stratViewer, /\{loadedStratName \|\| loadedStrat\.map \|\| selectedMap\.name\}/);
  assert.match(stratViewer, /Paste strat JSON here/);
  assert.match(stratViewer, /function loadJson/);
  assert.match(stratViewer, /const \[mapZoom, setMapZoom\]/);
  assert.match(stratViewer, /const \[canvasCoverZoom, setCanvasCoverZoom\]/);
  assert.match(stratViewer, /const \[canvasAspectRatio, setCanvasAspectRatio\] = useState\(mapArtworkAspectRatio\)/);
  assert.match(stratViewer, /function getCoverZoom/);
  assert.match(stratViewer, /function getPointProjectionScale/);
  assert.match(stratViewer, /function projectViewPoint/);
  assert.match(stratViewer, /const baseMinimumMapZoom = selectedLayout\?\.imageTransform\?\.scale/);
  assert.match(stratViewer, /const minimumMapZoom = Math\.min\(calibratedView\.minimumZoom, defaultMapZoom\)/);
  assert.match(stratViewer, /getCalibratedMapView\(selectedMap\?\.slug/);
  assert.match(stratViewer, /transform: `scale\(\$\{\(marker\.size \?\? 1\) \* mapMarkerScale \* getMapModificationIconScale\(typeClass\)\}\)`/);
  assert.match(stratViewer, /getValidAspectRatio\(activePhase\?\.viewport\?\.aspectRatio \?\? loadedStrat\?\.viewport\?\.aspectRatio\)/);
  assert.match(stratViewer, /typeof ResizeObserver === "undefined"/);
  assert.match(stratViewer, /new ResizeObserver\(updateCoverZoom\)/);
  assert.match(stratViewer, /setCanvasAspectRatio\(Number\(\(rect\.width \/ rect\.height\)\.toFixed\(4\)\)\)/);
  assert.match(stratViewer, /const markerScale = Number\(\(1 \/ mapZoom\)\.toFixed\(4\)\)/);
  assert.match(stratViewer, /const \[mapPan, setMapPan\]/);
  assert.match(stratViewer, /const \[viewedLayoutId, setViewedLayoutId\]/);
  assert.match(stratViewer, /const \[isFloorMenuOpen, setIsFloorMenuOpen\]/);
  assert.match(stratViewer, /selectedMap\.layouts\.find\(\(layout\) => layout\.id === viewedLayoutId\) \?\? phaseLayout/);
  assert.match(stratViewer, /function handleCanvasWheel/);
  assert.match(stratViewer, /clamp\(current \+ direction \* 0\.15, minimumMapZoom, maximumMapZoom\)/);
  assert.match(stratViewer, /function startCanvasPan/);
  assert.match(stratViewer, /function moveCanvasPan/);
  assert.match(stratViewer, /function endCanvasPan/);
  assert.match(stratViewer, /event\.preventDefault\(\)/);
  assert.match(stratViewer, /event\.target !== event\.currentTarget/);
  assert.match(stratViewer, /isImportOpen/);
  assert.match(stratViewer, /setIsImportOpen\(false\)/);
  assert.match(stratViewer, /className="json-export viewer-import"/);
  assert.match(stratViewer, /<summary>JSON<\/summary>/);
  assert.match(stratViewer, /className="json-workspace viewer-json-workspace"/);
  assert.match(stratViewer, /className="json-column json-import"/);
  assert.doesNotMatch(stratViewer, /Load strat/);
  assert.doesNotMatch(stratViewer, /Paste saved JSON/);
  assert.match(stratViewer, /selectedViewSlotIndex/);
  assert.match(stratViewer, /baseDrawingColors/);
  assert.match(stratViewer, /normalizeColorValue/);
  assert.match(stratViewer, /stroke\.isEraser/);
  assert.match(stratViewer, /slotDetailViewSettings\?: SlotDetailViewSettings/);
  assert.match(stratViewer, /slotDetailViewSettings\.showOtherLines/);
  assert.match(stratViewer, /slotDetailViewSettings\.showOtherOperators/);
  assert.match(stratViewer, /slotDetailViewSettings\.showOtherGadgets/);
  assert.match(stratViewer, /baseDrawingColors\.has\(strokeColor\) \|\| strokeColor === selectedSlotColor/);
  assert.match(stratViewer, /const projectedDrawings = drawings\.map/);
  assert.match(stratViewer, /\(stroke\.points \?\? \[\]\)\.map\(\(point\) => projectViewPoint\(point, markerProjectionScale\)\)/);
  assert.match(stratViewer, /!slotDetailViewSettings\.showOtherOperators/);
  assert.match(stratViewer, /!slotDetailViewSettings\.showOtherGadgets/);
  assert.match(stratViewer, /if \(selectedViewSlot\) \{\s*return false;\s*\}/);
  assert.match(stratViewer, /selectedViewSlot \? "viewer-strat-head is-slot-focus" : "viewer-strat-head"/);
  assert.match(stratViewer, /<h1>\{loadedStratName \|\| selectedMap\.name\}<\/h1>/);
  assert.doesNotMatch(stratViewer, /selectedViewSlot \? null : \(\s*<div className="viewer-meta"/);
  assert.match(stratViewer, /className="viewer-phase-tabs"/);
  assert.doesNotMatch(stratViewer, /setActivePhaseIndex\(index\);\s*setSelectedGadgetKey\(null\);\s*setSelectedViewSlotIndex\(null\);/);
  assert.match(stratViewer, /className="viewer-layout-grid"[\s\S]*className="viewer-map-panel"[\s\S]*className=\{`layout-canvas viewer-canvas/);
  assert.match(stratViewer, /onWheel=\{handleCanvasWheel\}/);
  assert.match(stratViewer, /onPointerDown=\{startCanvasPan\}/);
  assert.match(stratViewer, /className="viewer-floor-picker"/);
  assert.match(stratViewer, /className="viewer-floor-trigger"/);
  assert.match(stratViewer, /aria-label="View floor options"/);
  assert.match(stratViewer, /selectedMap\.layouts\.map\(\(layout\) =>/);
  assert.match(stratViewer, /setViewedLayoutId\(layout\.id\)/);
  assert.match(stratViewer, /style=\{\{ transform: `translate\(\$\{mapPan\.x\}px, \$\{mapPan\.y\}px\)` \}\}/);
  assert.match(stratViewer, /style=\{\{ transform: `scale\(\$\{mapZoom\}\)` \}\}/);
  assert.match(stratViewer, /className=\{`layout-canvas viewer-canvas[\s\S]*<aside className=\{selectedViewSlot \? "viewer-details is-slot-expanded" : "viewer-details"\}/);
  assert.doesNotMatch(stratViewer, /className="panel-head viewer-head"/);
  assert.doesNotMatch(stratViewer, /Load a saved JSON strat/);
  assert.match(stratViewer, /operatorValueAliases/);
  assert.match(stratViewer, /capitao: "capito"/);
  assert.match(stratViewer, /jager: "jger"/);
  assert.match(stratViewer, /nokk: "nkk"/);
  assert.match(stratViewer, /skopos: "skops"/);
  assert.match(stratViewer, /tubarao: "tubaro"/);
  assert.match(stratViewer, /\.normalize\("NFD"\)/);
  assert.match(stratViewer, /function normalizeOperatorValue/);
  assert.match(stratViewer, /Readonly strat layout/);
  assert.match(stratViewer, /slot\.position \? projectViewPoint\(slot\.position, markerProjectionScale\) : null/);
  assert.match(stratViewer, /gadget\.position \? projectViewPoint\(gadget\.position, markerProjectionScale\) : null/);
  assert.match(stratViewer, /marker\.position \? projectViewPoint\(marker\.position, markerProjectionScale\) : null/);
  assert.match(stratViewer, /operatorSlugs/);
  assert.match(stratViewer, /className="viewer-operator-pill"/);
  assert.match(stratViewer, /className="viewer-slot-title"/);
  assert.match(stratViewer, /className="viewer-slot-name"/);
  assert.match(stratViewer, /className="viewer-slot-role"/);
  assert.match(stratViewer, /setSelectedViewSlotIndex\(index\)/);
  assert.match(stratViewer, /className="viewer-slot-action"/);
  assert.match(stratViewer, /className="viewer-slot-expanded-card"/);
  assert.match(stratViewer, /className="viewer-slot-close"/);
  assert.match(stratViewer, /setSelectedViewSlotIndex\(null\)/);
  assert.match(stratViewer, /selectedViewPrimaryOperator/);
  assert.match(stratViewer, /selectedViewSecondaryOperators/);
  assert.match(stratViewer, /selectedViewSlotOperators\.slice\(1, 3\)\.map/);
  assert.match(stratViewer, /className="viewer-slot-expanded-operator-row"/);
  assert.match(stratViewer, /className="viewer-slot-expanded-operator primary"/);
  assert.match(stratViewer, /className="viewer-slot-expanded-operator secondary"/);
  assert.match(stratViewer, /<OperatorIcon operator=\{selectedViewPrimaryOperator\} size=\{40\} \/>/);
  assert.match(stratViewer, /<OperatorIcon operator=\{operator\} size=\{22\} \/>/);
  assert.match(stratViewer, /selectedViewSlotGadgets\.map/);
  assert.match(stratViewer, /const gadgetKey = `\$\{selectedViewSlotIndex\}:\$\{gadget\.id \?\? gadgetIndex\}`/);
  assert.match(stratViewer, /const isSelectedGadget = selectedGadgetKey === gadgetKey/);
  assert.match(stratViewer, /const hasGadgetDescription = Boolean\(gadget\.description\)/);
  assert.match(stratViewer, /className=\{`viewer-expanded-gadget-card\$\{isSelectedGadget \? " active" : ""\}\$\{hasGadgetDescription \? "" : " is-compact"\}`\}/);
  assert.match(stratViewer, /\{hasGadgetDescription \? \(\s*<p>\{gadget\.description\}<\/p>\s*\) : null\}/);
  assert.doesNotMatch(stratViewer, /No gadget description set\./);
  assert.match(stratViewer, /onClick=\{\(\) => setSelectedGadgetKey\(gadgetKey\)\}/);
  assert.match(stratViewer, /role="button"/);
  assert.match(stratViewer, /tabIndex=\{0\}/);
  assert.match(stratViewer, /className="viewer-gadget-images viewer-expanded-gadget-images"/);
  assert.doesNotMatch(stratViewer, /<strong>\{slot\.role \|\| "No role set"\}<\/strong>/);
  assert.match(stratViewer, /imageUrls\?: string\[\]/);
  assert.match(stratViewer, /size\?: number/);
  assert.match(stratViewer, /function getViewGadgetImageUrls/);
  assert.match(stratViewer, /new Set\(\s*\[\.\.\.\(Array\.isArray\(gadget\.imageUrls\)/);
  assert.match(stratViewer, /selectedGadgetKey/);
  assert.match(stratViewer, /setSelectedGadgetKey\(gadgetKey\);\s*setSelectedViewSlotIndex\(slotIndex\);/);
  assert.match(stratViewer, /const gadgetIcon = playerGadget \? undefined : gadgetOperator\?\.gadgetIcon/);
  assert.match(stratViewer, /className=\{`slot-gadget-marker marker-\$\{slotIndex \+ 1\}\$\{playerGadget \? " has-player-gadget" : ""\}\$\{gadgetIcon \? " has-ability-icon" : ""\}\$\{isSelectedGadget \? " active" : ""\}\$\{isOffFloorGadgetMarker \? " is-off-floor" : ""\}`\}/);
  assert.match(stratViewer, /transform: `scale\(\$\{\(gadget\.size \?\? 1\) \* mapMarkerScale \* \(playerGadget \? getMapModificationIconScale\(playerGadget\.type\) : 1\)\}\)`/);
  assert.doesNotMatch(stratViewer, /className="viewer-gadget-card"/);
  assert.match(stratViewer, /className="viewer-gadget-images viewer-expanded-gadget-images"/);
  assert.match(stratViewer, /import \{ OperatorIcon \} from "\.\/OperatorIcon"/);
  assert.match(stratViewer, /<OperatorIcon alt=\{`\$\{operator\.name\} marker`\} operator=\{operator\} size=\{28\} detailed \/>/);
  assert.match(stratViewer, /transform: `scale\(\$\{markerScale\}\)`/);
  assert.match(stratViewer, /<OperatorIcon operator=\{operator\} size=\{24\} \/>/);
  assert.match(operatorIcon, /operatorIconSheet/);
  assert.match(operatorIcon, /backgroundPosition/);
  assert.match(operatorIcon, /className=\{className \? `operator-sprite \$\{className\}` : "operator-sprite"\}/);
  assert.match(stratBuilder, /className="layout-settings-rail"/);
  assert.match(stratBuilder, /aria-label="Layout settings"/);
  assert.match(stratBuilder, /const \[setupSide, setSetupSide\] = useState<OperatorSide>\("Defense"\)/);
  assert.match(stratBuilder, /const \[isEditorSetupComplete, setIsEditorSetupComplete\]/);
  assert.match(stratBuilder, /const activePhaseTriggerLabel = activePhase\?\.label\.replace/);
  assert.match(stratBuilder, /\{activePhaseTriggerLabel\}/);
  assert.match(stratBuilder, /function startEditorFromSetup/);
  assert.match(stratBuilder, /className="editor-setup-panel"/);
  assert.match(stratBuilder, /Start a new strat/);
  assert.match(stratBuilder, /className="editor-setup-map-preview"/);
  assert.match(stratBuilder, /map-preview-sheet\.webp/);
  assert.match(stratBuilder, /hasOpenedSetupSelection/);
  assert.match(stratBuilder, /id === "setup-map" \|\| id === "setup-side"/);
  assert.match(stratBuilder, /Select the map and side before opening the editor\./);
  assert.match(stratBuilder, /"setup-side"/);
  assert.match(stratBuilder, /setSide\(setupSide\)/);
  assert.doesNotMatch(stratBuilder, /<span>Map \/ Side<\/span>/);
  assert.match(stratBuilder, /<span className="layout-settings-kicker">Setup<\/span>/);
  assert.match(stratBuilder, /className="layout-settings-controls"/);
  assert.doesNotMatch(stratBuilder, /className="layout-locked-summary layout-setting-wide"/);
  assert.match(stratBuilder, /className="phase-controls"/);
  assert.doesNotMatch(stratBuilder, /className="builder-controls"/);
  assert.doesNotMatch(stratBuilder, /className="phase-start-field"/);
  assert.doesNotMatch(stratBuilder, /className="panel-head creator-head"/);
  assert.doesNotMatch(stratBuilder, /<span>Creator<\/span>/);
  assert.match(stratBuilder, /Phase options/);
  assert.match(stratBuilder, /className="phase-option-row"/);
  assert.match(stratBuilder, /className="phase-start-input"/);
  assert.match(stratBuilder, /aria-label=\{`\$\{option\.label\} starts at`\}/);
  assert.match(stratBuilder, /onChange=\{\(event\) => updatePhaseStart\(option\.value, event\.target\.value\)\}/);
  assert.match(stratBuilder, /className="remove-phase"/);
  assert.match(stratBuilder, /Delete \$\{option\.label\}/);
  assert.match(stratBuilder, /removePhase\(option\.value\)/);
  assert.match(stratBuilder, /disabled=\{phases\.length >= maxPhaseCount\}/);
  assert.match(stratBuilder, /Phase limit reached/);
  assert.match(stratBuilder, /Add Phase/);
  assert.match(stratBuilder, /editingPhaseId === option\.value/);
  assert.match(stratBuilder, /className="phase-name-input"/);
  assert.match(stratBuilder, /if \(option\.value === activePhaseId\) \{/);
  assert.match(stratBuilder, /setEditingPhaseId\(option\.value\)/);
  assert.match(stratBuilder, /title=\{option\.value === activePhaseId \? "Click to rename" : "Click to select"\}/);
  assert.match(stratBuilder, /updatePhaseLabel\(option\.value, event\.target\.value\)/);
  assert.doesNotMatch(stratBuilder, /Double-click to rename/);
  assert.doesNotMatch(stratBuilder, /className="phase-name-field"/);
  assert.match(stratBuilder, /placeholder="0:00"/);
  assert.match(stratBuilder, /layoutId: marker\.layoutId/);
  assert.match(stratBuilder, /rotation: marker\.rotation/);
  assert.match(stratBuilder, /size: marker\.size/);
  assert.match(stratBuilder, /transform: `scale\(\$\{marker\.size \* mapMarkerScale \* getMapModificationIconScale\(marker\.type\)\}\)`/);
  assert.match(stratBuilder, /defaultMapModSize/);
  assert.match(stratBuilder, /minMapModSize/);
  assert.match(stratBuilder, /maxMapModSize/);
  assert.match(stratBuilder, /mapModSizeStep/);
  assert.match(styles, /\.builder-canvas-grid\s*\{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto/s);
  assert.match(styles, /\.builder-canvas-grid\s*\{[^}]*align-items: stretch/s);
  assert.match(styles, /\.layout-settings-rail\s*\{[^}]*grid-column: 2/s);
  assert.match(styles, /\.layout-settings-rail\s*\{[^}]*grid-row: 1/s);
  assert.match(styles, /\.layout-settings-controls/);
  assert.match(styles, /\.layout-settings-controls\s*\{[^}]*grid-template-columns: minmax\(66px, 0\.8fr\) minmax\(136px, 1\.45fr\) minmax\(68px, 0\.8fr\)/s);
  assert.match(styles, /\.layout-settings-controls \.custom-select-trigger\s*\{[^}]*padding-right: 28px/s);
  assert.doesNotMatch(styles, /\.layout-settings-controls \.phase-controls,/);
  assert.doesNotMatch(styles, /\.layout-setting-wide/);
  assert.match(styles, /\.editor-setup-panel/);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*align-self: start/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*justify-self: center/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*grid-template-rows: auto auto auto auto/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*width: min\(100%, 410px\)/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*height: auto/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*align-content: stretch/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*max-width: 410px/s);
  assert.match(styles, /\.editor-setup-panel\s*\{[^}]*border-radius: 8px/s);
  assert.match(styles, /\.editor-setup-copy\s*\{[^}]*align-self: start/s);
  assert.match(styles, /\.editor-setup-controls\s*\{[^}]*align-self: center/s);
  assert.match(styles, /\.editor-setup-controls\s*\{[^}]*margin-top: 0/s);
  assert.match(styles, /\.editor-setup-controls\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 108px/s);
  assert.match(styles, /\.editor-setup-controls \.custom-select-trigger\s*\{[^}]*min-height: 38px/s);
  assert.match(styles, /\.editor-setup-controls \.custom-select-menu/);
  assert.match(styles, /\.editor-setup-map-preview\s*\{[^}]*justify-self: center/s);
  assert.match(styles, /\.editor-setup-map-preview\s*\{[^}]*width: min\(100%, 286px\)/s);
  assert.match(styles, /\.editor-setup-map-preview\s*\{[^}]*aspect-ratio: 4 \/ 3/s);
  assert.match(styles, /\.editor-setup-map-preview\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /\.editor-setup-actions/);
  assert.match(styles, /\.editor-setup-actions\s*\{[^}]*align-self: end/s);
  assert.match(styles, /\.editor-setup-actions button\s*\{[^}]*min-height: 36px/s);
  assert.match(styles, /\.editor-setup-actions button\s*\{[^}]*min-width: 82px/s);
  assert.match(styles, /\.editor-setup-actions button\s*\{[^}]*font-family: var\(--font-geist-sans\), Arial, Helvetica, sans-serif/s);
  assert.match(styles, /\.editor-setup-actions button\s*\{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.editor-setup-actions \.json-save-button\s*\{[^}]*min-width: 106px/s);
  assert.match(styles, /\.editor-setup-actions \.json-load-button:hover/);
  assert.doesNotMatch(styles, /\.layout-locked-summary/);
  assert.match(styles, /\.strat-builder\s*\{[^}]*height: calc\(100vh - 44px\)/s);
  assert.match(styles, /\.strat-builder\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /\.builder-canvas-grid\s*\{[^}]*height: 100%/s);
  assert.match(styles, /\.builder-canvas-grid\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /\.map-workbench\s*\{[^}]*grid-row: 1 \/ span 3/s);
  assert.match(styles, /\.map-workbench\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /\.map-workbench\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /\.layout-canvas\s*\{[^}]*height: 100%/s);
  assert.match(styles, /\.layout-copy-toast\s*\{[^}]*right: 14px/s);
  assert.match(styles, /\.layout-copy-toast\s*\{[^}]*bottom: 14px/s);
  assert.match(styles, /\.layout-copy-toast\s*\{[^}]*background: rgba\(7, 12, 15, 0\.68\)/s);
  assert.match(styles, /\.layout-copy-toast\s*\{[^}]*font-weight: 800/s);
  assert.match(styles, /\.layout-copy-toast\s*\{[^}]*pointer-events: none/s);
  assert.match(styles, /\.slot-editor\s*\{[^}]*overflow-y: auto/s);
  assert.match(styles, /@media \(max-height: 760px\)/);
  assert.match(styles, /\.phase-controls/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.editor-setup-controls\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.strat-builder\s*\{[^}]*height: auto/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.builder-canvas-grid\s*\{[^}]*height: auto/s);
  assert.match(styles, /\.custom-select-field,[\s\S]*\.slot-form label\s*\{[^}]*min-width: 0/s);
  assert.match(styles, /\.custom-select\s*\{[^}]*min-width: 0/s);
  assert.match(styles, /\.phase-name-input/);
  assert.match(styles, /\.phase-start-input/);
  assert.doesNotMatch(styles, /\.phase-start-field input/);
  assert.match(styles, /\.phase-select-field \.custom-select-trigger/);
  assert.match(styles, /\.phase-option-row/);
  assert.match(styles, /\.phase-option-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 42px/s);
  assert.match(styles, /\.phase-option-row \.remove-phase/);
  assert.match(styles, /\.phase-option-row:hover \.remove-phase/);
  assert.match(styles, /overflow-x: hidden/);
  assert.match(styles, /text-overflow: ellipsis/);
  assert.match(styles, /padding-right: 4px/);
  assert.match(styles, /width: calc\(100% - 12px\)/);
  assert.match(styles, /margin-left: -18px/);
  assert.match(styles, /border-color: transparent/);
  assert.match(styles, /background: transparent/);
  assert.match(styles, /padding: 6px 4px 6px 0/);
  assert.match(styles, /top: -4px/);
  assert.match(styles, /right: -2px/);
  assert.doesNotMatch(styles, /transform: translateY\(-50%\)/);
  assert.match(styles, /\.custom-select-menu \.add-phase-option:disabled/);
  assert.match(styles, /\.custom-select-menu \.add-phase-option/);
  assert.match(styles, /\.editor-panel-tabs/);
  assert.match(styles, /\.editor-panel-tabs\.slots-only/);
  assert.match(styles, /\.slot-editor\s*\{[^}]*align-content: start/s);
  assert.match(styles, /\.editor-panel-tabs\s*\{[^}]*align-items: stretch/s);
  assert.match(styles, /\.slot-tabs\s*\{[^}]*align-self: start/s);
  assert.match(styles, /\.slot-tabs\s*\{[^}]*align-content: start/s);
  assert.match(styles, /\.map-mod-tab\s*\{[^}]*align-self: stretch/s);
  assert.match(styles, /repeat\(auto-fit, minmax\(70px, 1fr\)\)/);
  assert.match(styles, /\.editor-panel-tabs\.slots-only \.slot-tabs/);
  assert.match(styles, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.slot-tab-item\s*\{[^}]*position: relative/s);
  assert.match(styles, /\.slot-tab-button\s*\{[^}]*justify-items: center/s);
  assert.match(styles, /\.slot-tab-button\s*\{[^}]*grid-template-rows: 0\.55fr auto 1fr/s);
  assert.match(styles, /\.slot-tab-button::before\s*\{[^}]*content: ""/s);
  assert.match(styles, /\.slot-tab-button small\s*\{[^}]*font-size: 0\.63rem/s);
  assert.match(styles, /\.slot-tab-button small\s*\{[^}]*rgba\(143, 164, 161, 0\.68\)/s);
  assert.doesNotMatch(styles, /\.map-mod-tab::before|\.map-mod-tab::after/);
  assert.match(styles, /\.map-mod-tab\s*\{[^}]*border-radius: 7px/s);
  assert.match(styles, /\.map-mod-tab\s*\{[^}]*rgba\(155, 238, 219, 0\.18\)/s);
  assert.match(styles, /\.reset-slot\s*\{[^}]*position: absolute/s);
  assert.match(styles, /\.slot-tab-item:hover \.reset-slot/);
  assert.match(styles, /\.map-mod-tab\.active/);
  assert.match(styles, /\.map-modifications-panel textarea/);
  assert.match(styles, /\.slot-form-title/);
  assert.match(styles, /position: absolute/);
  assert.match(styles, /top: 14px/);
  assert.match(styles, /right: 12px/);
  assert.match(styles, /\.map-modifications-panel\s*\{[^}]*padding: 12px/s);
  assert.match(styles, /\.layout-canvas\.is-drawing/);
  assert.match(styles, /\.drawing-layer/);
  assert.match(styles, /\.drawing-toggle/);
  assert.match(styles, /\.drawing-toggle\.active/);
  assert.match(styles, /\.drawing-panel/);
  assert.match(styles, /width: min\(286px, calc\(100% - 68px\)\)/);
  assert.match(styles, /grid-template-columns: 50px minmax\(0, 1fr\)/);
  assert.match(styles, /\.drawing-actions/);
  assert.match(styles, /grid-template-columns: 32px 34px/);
  assert.match(styles, /\.drawing-actions \.undo-drawing/);
  assert.match(styles, /\.drawing-actions button img/);
  assert.match(styles, /grid-column: 1 \/ -1/);
  assert.match(styles, /\.drawing-color-section/);
  assert.match(styles, /\.drawing-colors/);
  assert.match(styles, /\.drawing-slot-colors/);
  assert.match(styles, /border-top: 1px solid rgba\(143, 164, 161, 0\.18\)/);
  assert.match(styles, /\.json-actions/);
  assert.match(styles, /\.json-workspace/);
  assert.match(styles, /\.json-workspace\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(styles, /\.json-column/);
  assert.match(styles, /\.json-column-head/);
  assert.match(styles, /max-height: 230px/);
  assert.match(styles, /font-size: 0\.68rem/);
  assert.match(styles, /\.json-export pre::-webkit-scrollbar/);
  assert.match(styles, /\.json-export pre::-webkit-scrollbar-thumb/);
  assert.match(styles, /scrollbar-color: rgba\(34, 230, 194, 0\.72\) rgba\(8, 13, 16, 0\.62\)/);
  assert.match(styles, /\.json-import/);
  assert.match(styles, /\.json-footer-actions/);
  assert.match(styles, /\.json-footer-actions \.json-save-button/);
  assert.match(styles, /\.json-quick-actions/);
  assert.match(styles, /\.json-quick-actions \.json-copy-button:hover/);
  assert.match(styles, /\.json-quick-actions \.json-save-button/);
  assert.match(styles, /\.json-load-backdrop/);
  assert.match(styles, /\.json-load-dialog/);
  assert.match(styles, /\.json-load-dialog textarea/);
  assert.match(styles, /\.strat-name-input/);
  assert.match(styles, /\.strat-name-input:focus/);
  assert.match(styles, /\.strat-viewer/);
  assert.match(styles, /#strat-editor > \.blueprint-panel,\s*#view-strat > \.blueprint-panel,\s*#settings > \.blueprint-panel/);
  assert.match(styles, /#strat-editor > \.blueprint-panel,[\s\S]*#settings > \.blueprint-panel\s*\{[^}]*background: transparent/s);
  assert.match(styles, /#strat-editor > \.blueprint-panel,[\s\S]*#settings > \.blueprint-panel\s*\{[^}]*box-shadow: none/s);
  assert.match(styles, /\.settings-panel/);
  assert.match(styles, /\.settings-shell/);
  assert.match(styles, /\.settings-tabs/);
  assert.match(styles, /\.settings-tabs button\.active/);
  assert.match(styles, /\.settings-group/);
  assert.match(styles, /\.settings-option/);
  assert.match(styles, /\.settings-toggle/);
  assert.match(styles, /\.settings-placeholder/);
  assert.match(styles, /\.strat-viewer\s*\{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\)/s);
  assert.match(styles, /\.strat-viewer\s*\{[^}]*gap: 8px/s);
  assert.match(styles, /\.strat-viewer\s*\{[^}]*height: calc\(100vh - 44px\)/s);
  assert.match(styles, /\.strat-viewer\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /\.viewer-import/);
  assert.match(styles, /\.viewer-strat-head/);
  assert.match(styles, /\.viewer-strat-head\s*\{[^}]*align-items: center/s);
  assert.match(styles, /\.viewer-strat-head\s*\{[^}]*justify-content: space-between/s);
  assert.match(styles, /\.viewer-json-workspace/);
  assert.match(styles, /\.viewer-json-workspace \.json-column\s*\{[^}]*border: 0/s);
  assert.match(styles, /\.viewer-json-workspace \.json-column\s*\{[^}]*background: transparent/s);
  assert.doesNotMatch(styles, /\.viewer-import summary/);
  assert.doesNotMatch(styles, /\.viewer-import\[open\] summary::before/);
  assert.match(styles, /\.viewer-operator-pill,/);
  assert.doesNotMatch(styles, /\.viewer-operator-row span,/);
  assert.match(styles, /\.viewer-operator-pill \.operator-sprite/);
  assert.match(styles, /\.viewer-layout-grid/);
  assert.match(styles, /\.viewer-layout-grid\s*\{[^}]*align-items: stretch/s);
  assert.match(styles, /\.viewer-layout-grid\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /\.viewer-layout-grid\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /\.viewer-map-panel\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /\.viewer-map-panel\s*\{[^}]*overflow: hidden/s);
  assert.doesNotMatch(styles, /\.viewer-map-panel\s*\{[^}]*min-height: clamp\(620px, calc\(100vh - 138px\), 1100px\)/s);
  assert.match(styles, /\.map-layer-stack/);
  assert.match(styles, /\.map-layer-floor/);
  assert.match(styles, /\.map-layer-overlay/);
  assert.match(styles, /\.map-layer-inline-svg svg/);
  assert.match(styles, /\.layout-zoom-layer img\s*\{[^}]*object-fit: cover/s);
  assert.match(styles, /\.drawing-layer\s*\{[^}]*z-index: 4/s);
  assert.match(styles, /\.map-overlay-toggles/);
  assert.match(styles, /\.map-overlay-toggle\.active/);
  assert.match(styles, /\.map-overlay-toggle img/);
  assert.match(styles, /\.viewer-floor-picker/);
  assert.match(styles, /\.viewer-floor-trigger/);
  assert.match(styles, /\.viewer-floor-trigger\s*\{[^}]*font-weight: 650/s);
  assert.match(styles, /\.viewer-floor-trigger\s*\{[^}]*rgba\(231, 245, 240, 0\.78\)/s);
  assert.match(styles, /\.viewer-floor-menu/);
  assert.match(styles, /\.viewer-floor-menu\s*\{[^}]*background: rgba\(8, 13, 16, 0\.48\)/s);
  assert.match(styles, /\.viewer-floor-menu\s*\{[^}]*-webkit-backdrop-filter: blur\(18px\)/s);
  assert.match(styles, /\.viewer-floor-menu\s*\{[^}]*backdrop-filter: blur\(18px\)/s);
  assert.match(styles, /\.viewer-floor-menu button\.selected/);
  assert.match(styles, /\.viewer-canvas \.slot-gadget-marker/);
  assert.match(styles, /\.viewer-gadget-card/);
  assert.match(styles, /\.viewer-expanded-gadget-list\s*\{[^}]*font-family: "Segoe UI Variable", "Segoe UI"/s);
  assert.match(styles, /\.viewer-expanded-gadget-card strong\s*\{[^}]*font-weight: 760/s);
  assert.match(styles, /\.viewer-expanded-gadget-card\.active/);
  assert.match(styles, /\.viewer-expanded-gadget-card\.is-compact/);
  assert.match(styles, /\.viewer-expanded-gadget-card:focus-visible/);
  assert.match(styles, /\.viewer-gadget-images img/);
  assert.match(styles, /\.viewer-expanded-gadget-images\s*\{[^}]*display: flex/s);
  assert.match(styles, /\.viewer-expanded-gadget-images\s*\{[^}]*justify-content: flex-end/s);
  assert.match(styles, /\.viewer-expanded-gadget-images\s*\{[^}]*justify-self: end/s);
  assert.match(styles, /\.viewer-expanded-gadget-images img\s*\{[^}]*width: auto/s);
  assert.match(styles, /\.viewer-expanded-gadget-images img\s*\{[^}]*height: auto/s);
  assert.match(styles, /max-height: 180px/);
  assert.match(styles, /object-fit: contain/);
  assert.match(styles, /\.viewer-slot-card/);
  assert.match(styles, /\.viewer-slot-expanded-operator-row/);
  assert.match(styles, /\.viewer-slot-expanded-operator-row\s*\{[^}]*align-items: center/s);
  assert.match(styles, /\.viewer-slot-expanded-operator-row\s*\{[^}]*background: rgba\(8, 13, 16, 0\.46\)/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\.primary/);
  assert.match(styles, /\.viewer-slot-expanded-operator\.secondary/);
  assert.match(styles, /\.viewer-slot-expanded-operator\.secondary\s*\{[^}]*align-items: center/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\.secondary\s*\{[^}]*font-size: 0\.68rem/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\.secondary\s*\{[^}]*transform: translateY\(3px\)/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\.primary \.operator-sprite\s*\{[^}]*width: 40px/s);
  assert.match(styles, /\.viewer-slot-expanded-operator\.secondary \.operator-sprite\s*\{[^}]*width: 22px/s);
  assert.match(styles, /\.viewer-slot-title/);
  assert.match(styles, /\.viewer-slot-name/);
  assert.match(styles, /\.viewer-slot-role/);
  assert.match(styles, /\.viewer-slot-action/);
  assert.match(styles, /\.viewer-slot-action:hover/);
  assert.match(styles, /\.viewer-operator-row\s*\{[^}]*align-items: center/s);
  assert.match(styles, /\.viewer-operator-row\s*\{[^}]*min-height: 32px/s);
  assert.match(styles, /\.viewer-slot-card b\s*\{[^}]*color: inherit/s);
  assert.match(styles, /\.viewer-slot-card header\s*\{[^}]*justify-content: space-between/s);
  assert.doesNotMatch(styles, /\.viewer-slot-card header strong/);
  assert.match(styles, /\.map-modification-marker/);
  assert.match(styles, /\.map-modification-marker\s*\{[^}]*z-index: 6/s);
  assert.match(styles, /\.map-modification-marker\s*\{[^}]*width: 14px/s);
  assert.match(styles, /\.map-modification-marker\s*\{[^}]*height: 14px/s);
  assert.match(styles, /cursor: grab/);
  assert.match(styles, /pointer-events: auto/);
  assert.match(styles, /touch-action: none/);
  assert.match(styles, /\.map-modification-marker:active/);
  assert.match(styles, /\.map-modification-marker\.active/);
  assert.match(styles, /\.map-modification-marker\.active\s*\{[^}]*outline-offset: 1px/s);
  assert.match(styles, /\.map-modification-marker\.has-icon/);
  assert.match(styles, /\.map-modification-marker\.has-icon\.active/);
  assert.match(styles, /\.map-modification-marker\.has-icon\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.map-modification-marker\.has-icon\s*\{[^}]*box-shadow: none/s);
  assert.match(styles, /\.map-modification-marker\.has-icon\.active\s*\{[^}]*background: rgba\(34, 230, 194, 0\.16\)/s);
  assert.match(styles, /\.map-modification-marker\.has-icon\.active\s*\{[^}]*box-shadow: 0 0 0 1px rgba\(34, 230, 194, 0\.16\)/s);
  assert.match(styles, /\.map-modification-marker \.mod-layout-icon/);
  assert.match(styles, /\.map-modification-marker \.mod-layout-icon\s*\{[^}]*width: 12px/s);
  assert.match(styles, /\.map-modification-marker \.mod-layout-icon\s*\{[^}]*height: 12px/s);
  assert.match(styles, /\.map-modification-marker\.has-icon\.active \.mod-layout-icon/);
  assert.match(styles, /\.map-modification-marker\.is-off-floor/);
  assert.match(styles, /\.mod-marker-item\.is-off-floor/);
  assert.match(styles, /\.mod-tool-grid/);
  assert.match(styles, /\.mod-tool-spacer\s*\{[^}]*min-height: 0/s);
  assert.match(styles, /background-image: url\("\/map-mod-icons\/map-mods-sheet\.png"\)/);
  assert.match(styles, /background-size: 300% 400%/);
  assert.match(styles, /\.mod-tool-icon/);
  assert.match(styles, /\.mod-list-icon/);
  assert.match(styles, /\.mod-marker-item/);
  assert.match(styles, /\.mod-marker-item\.active/);
  assert.match(styles, /\.mod-marker-count/);
  assert.match(styles, /grid-template-columns: 22px 16px minmax\(12px, 1fr\) 45px 45px minmax\(14px, 0\.8fr\) 32px 32px/);
  assert.match(styles, /\.mod-marker-item button\s*\{[^}]*white-space: nowrap/s);
  assert.match(styles, /\.mod-tool,\s*\.mod-marker-item button\s*\{[^}]*line-height: 1\.08/s);
  assert.match(styles, /\.mod-marker-item \.mod-marker-rotate\s*\{[^}]*width: 45px/s);
  assert.match(styles, /\.mod-marker-item \.mod-marker-size\s*\{[^}]*width: 32px/s);
  assert.match(styles, /\.mod-marker-item button:nth-of-type\(1\)\s*\{[^}]*transform: translateX\(30px\)/s);
  assert.match(styles, /\.mod-marker-item button:nth-of-type\(2\)\s*\{[^}]*transform: translateX\(57px\)/s);
  assert.match(styles, /\.mod-marker-item button:nth-of-type\(3\)\s*\{[^}]*transform: translateX\(71px\)/s);
  assert.match(styles, /\.mod-marker-item button:nth-of-type\(4\)\s*\{[^}]*transform: translateX\(57px\)/s);
  assert.match(styles, /\.mod-marker-item \.remove-map-mod/);
  assert.match(styles, /\.mod-marker-item:hover \.remove-map-mod/);
  assert.match(styles, /\.mod-tool\.active/);
  assert.match(styles, /\.mod-marker-list/);
  assert.match(styles, /\.map-modifications-panel textarea\s*\{[^}]*min-height: 54px/s);
  assert.match(styles, /\.mod-marker-list\s*\{[^}]*max-height: 140px/s);
  assert.match(styles, /\.mod-marker-list\s*\{[^}]*padding-right: 14px/s);
  assert.match(styles, /\.mod-marker-list\s*\{[^}]*overflow-y: auto/s);
  assert.match(styles, /\.mod-marker-item \.remove-map-mod\s*\{[^}]*right: -5px/s);
  assert.match(styles, /\.mod-marker-list::-webkit-scrollbar-thumb/);
  assert.match(styles, /\.mod-standing-rotation/);
  assert.match(styles, /\.mod-reinforcement/);
  assert.match(styles, /\.mod-shield/);
  assert.match(styles, /\.mod-barbed-wire/);
  assert.match(styles, /\.mod-proximity-alarm/);
  assert.match(styles, /\.mod-bulletproof-camera/);
  assert.match(styles, /\.mod-observation-blocker/);
  assert.match(styles, /\.custom-select-trigger/);
  assert.match(styles, /\.custom-select-menu/);
  assert.match(styles, /\.custom-select-menu button\.selected/);
  assert.match(styles, /width: 34px/);
  assert.match(styles, /height: 34px/);
  assert.match(styles, /\.map-change-dialog/);
  assert.match(styles, /max-height: 130px/);
  assert.match(styles, /min-height: 38px/);
  assert.match(styles, /\.slot-form textarea\s*\{[^}]*min-height: 42px/s);
  assert.match(styles, /\.slot-form textarea\s*\{[^}]*resize: none/s);
  assert.match(styles, /padding: 2px/);
  assert.match(styles, /\.selected-operator:hover \.remove-operator/);
  assert.match(styles, /\.empty-selection\s*\{[^}]*border-color: transparent/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*border-width: 0/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*width: fit-content/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*justify-self: start/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*rgba\(143, 164, 161, 0\.055\)/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*font-family: var\(--font-geist-sans\)/s);
  assert.match(styles, /\.empty-selection\s*\{[^}]*border-radius: 7px/s);
  assert.match(styles, /top: -7px/);
  assert.match(styles, /right: -7px/);
  assert.match(styles, /background: rgba\(3, 10, 13, 0\.9\)/);
  assert.match(styles, /\.position-marker\.has-operator/);
  assert.match(styles, /\.position-marker\s*\{[^}]*z-index: 6/s);
  assert.match(styles, /\.position-marker\s*\{[^}]*cursor: grab/s);
  assert.match(styles, /\.position-marker\s*\{[^}]*pointer-events: auto/s);
  assert.match(styles, /\.position-marker:active/);
  assert.match(styles, /\.position-marker\.is-off-floor/);
  assert.match(styles, /\.gadget-plan-head button/);
  assert.match(styles, /\.gadget-plan-head\s*\{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.slot-gadget-marker/);
  assert.match(styles, /\.slot-gadget-marker\s*\{[^}]*z-index: 6/s);
  assert.match(styles, /\.slot-gadget-marker\.active/);
  assert.match(styles, /\.slot-gadget-marker\.has-ability-icon/);
  assert.match(styles, /\.slot-gadget-marker\.has-ability-icon\.active/);
  assert.match(styles, /\.slot-gadget-marker\.has-ability-icon\.active\s*\{[^}]*border-color: rgba\(34, 230, 194, 0\.88\)/s);
  assert.match(styles, /\.slot-gadget-ability-icon/);
  assert.match(styles, /\.slot-gadget-marker\.is-off-floor/);
  assert.match(styles, /\.slot-gadget-size-controls/);
  assert.match(styles, /\.slot-gadget-size-controls button:hover/);
  assert.match(styles, /\.slot-gadget-item/);
  assert.match(styles, /\.slot-gadget-item\.active/);
  assert.match(styles, /\.slot-gadget-dot/);
  assert.doesNotMatch(styles, /\.slot-gadget-icon/);
  assert.match(styles, /\.slot-gadget-summary,/);
  assert.match(styles, /\.slot-gadget-expand/);
  assert.match(styles, /\.slot-gadget-expand\.open span/);
  assert.match(styles, /\.slot-gadget-remove/);
  assert.match(styles, /\.slot-gadget-item:hover \.slot-gadget-remove/);
  assert.match(styles, /\.slot-gadget-fields input/);
  assert.match(styles, /\.slot-gadget-fields textarea/);
  assert.doesNotMatch(styles, /\.position-marker\.has-operator\s*\{[^}]*background:/s);
  assert.match(styles, /\.operator-sprite/);
  assert.match(styles, /background-size: 700% 1100%/);
  assert.match(styles, /\.position-marker \.operator-sprite/);
  assert.match(styles, /width: 28px/);
  assert.match(styles, /height: 28px/);
  assert.match(styles, /\.operator-picker button \.operator-name/);
  assert.match(styles, /opacity: 0/);
  assert.doesNotMatch(stratBuilder, /roleDefaults|\["Anchor", "Flex"/);
  assert.doesNotMatch(stratBuilder, /operatorDefaults|\["smoke", "mute"\]/);
  assert.doesNotMatch(page, /asset-panel|operator-roster|Operator Pool/);
  assert.match(operatorData, /operatorIconSheet = '\/operators\/operator-icons-sheet\.png'/);
  assert.match(operatorData, /gadgetIcon\?: string/);
  assert.match(operatorData, /operatorGadgetIcons/);
  assert.match(operatorData, /ace: '\/operator-gadgets\/ace\.png'/);
  assert.match(operatorData, /blackbeard: '\/operator-gadgets\/blackbeard\.webp'/);
  assert.match(operatorData, /'solid-snake': '\/operator-gadgets\/solid-snake\.webp'/);
  assert.match(operatorData, /thatcher: '\/operator-gadgets\/thatcher\.webp'/);
  assert.match(operatorData, /slug: 'solid-snake', name: 'Solid Snake', side: 'Attack'/);
  assert.match(operatorData, /operatorSheetSlugs/);
  assert.match(operatorData, /capitao: 'capito'/);
  assert.match(operatorData, /\/operators\/portraits\/smoke\.png/);
  assert.match(mapData, /bank-1', label: 'Basement'/);
  assert.match(mapData, /baseImage\?: string/);
  assert.match(mapData, /floorImage\?: string/);
  assert.match(mapData, /calloutImage\?: string/);
  assert.match(mapData, /mapModsImage\?: string/);
  assert.match(mapData, /bombsiteImage\?: string/);
  assert.match(mapData, /baseImage: '\/maps-layered-webp\/bank\/original-cache-svg\.webp'/);
  assert.match(mapData, /floorImage: '\/maps-layered-webp\/bank\/floors\/bank_floor_0\.webp'/);
  assert.match(mapData, /calloutImage: '\/maps-layered-webp\/bank\/overlays_map-location-callouts\/bank_floor_0_overlays-mlc\.svg'/);
  assert.match(mapData, /mapModsImage: '\/maps-layered-webp\/bank\/overlays_map-modifications\/bank_floor_0_overlays-mm\.svg'/);
  assert.match(mapData, /bombsiteImage: '\/maps-layered-webp\/bank\/overlays_icons\/bank_floor_0_icons\.svg'/);
  assert.doesNotMatch(mapData, /\/maps-layered\//);
  assert.match(mapData, /bank-3', label: '2nd Floor'/);
  assert.match(mapData, /bank-3[\s\S]*floorOffset: \{ x: -3\.5, y: -3 \}/);
  assert.match(mapData, /imageTransform\?: \{ scale\?: number; x\?: number; y\?: number \}/);
  assert.match(mapData, /nighthavenlabs-1[\s\S]*imageTransform: \{ scale: 1\.21, x: 8, y: 4 \}/);
  assert.match(mapData, /chalet-1[\s\S]*imageTransform: \{ scale: 1\.45 \}/);
  assert.match(mapData, /emeraldplains-1[\s\S]*imageTransform: \{ scale: 1\.45 \}/);
  assert.match(mapData, /stadiuma-floor-0[\s\S]*imageTransform: \{ scale: 1\.45 \}/);
  assert.match(mapData, /themepark-1[\s\S]*floorImage: '\/maps-layered-webp\/themepark\/floors\/themepark_floor_1\.webp'[\s\S]*imageTransform: \{ scale: 1\.45 \}/);
  assert.match(mapData, /border-3', label: 'Roof'/);
  assert.match(mapData, /chalet-1', label: 'Basement'/);
  assert.match(mapData, /closequarter-2', label: 'Roof'/);
  assert.match(mapData, /clubhouse-4', label: 'Roof'/);
  assert.match(mapData, /coastline-3', label: 'Roof'/);
  assert.match(mapData, /bank-4', label: 'Roof'/);
  assert.doesNotMatch(mapData, /label: 'Layout/);
  assert.match(layout, /metadataBase/);
  assert.match(layout, /\/og\.png/);
  assert.match(packageJson, /"name": "r6-stratshare"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await Promise.all([
    access(new URL("../public/map-mod-icons/map-mods-sheet.png", import.meta.url)),
    access(new URL("../public/maps-layered-webp/bank/original-cache-svg.webp", import.meta.url)),
    access(new URL("../public/maps-layered-webp/bank/floors/bank_floor_0.webp", import.meta.url)),
    access(new URL("../public/maps-layered-webp/bank/overlays_map-location-callouts/bank_floor_0_overlays-mlc.svg", import.meta.url)),
    access(new URL("../public/maps-layered-webp/bank/overlays_map-modifications/bank_floor_0_overlays-mm.svg", import.meta.url)),
    access(new URL("../public/maps-layered-webp/bank/overlays_icons/bank_floor_0_icons.svg", import.meta.url)),
    access(new URL("../public/operators/operator-icons-sheet.png", import.meta.url)),
    access(new URL("../public/icons/eraser-streamline-solar.svg", import.meta.url)),
    access(new URL("../public/icons/r6-callout-icon.png", import.meta.url)),
    access(new URL("../public/icons/r6-locations-icon.png", import.meta.url)),
    access(new URL("../public/icons/r6-modifications-icon.png", import.meta.url)),
    access(new URL("../public/operator-gadgets/ace.png", import.meta.url)),
    access(new URL("../public/operator-gadgets/blackbeard.webp", import.meta.url)),
    access(new URL("../public/operator-gadgets/solid-snake.webp", import.meta.url)),
    access(new URL("../public/operator-gadgets/thatcher.webp", import.meta.url)),
  ]);
});
