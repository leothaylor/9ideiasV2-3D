import * as THREE from 'three';
import ForceGraph3D from '3d-force-graph';
import { parseMarkdownImport } from './io.js';

const R = 108, STORAGE = 'mapa-knowledge-sphere-v1';
const CATS = {
  bjj: ['Jiu-jitsu','#c77e6d'], financeiro: ['Financeiro','#628bbf'],
  negocio: ['Negócios','#c79b57'], organizacao: ['Organização','#5d9e88'],
  ferramenta: ['Ferramentas','#897cbf'], outra: ['Outros','#858f9c']
};
const STATUS = { pending:'Pendente', progress:'Em andamento', done:'Concluído' };
const $ = id => document.getElementById(id);
const host = $('graph');
let records = {nodes:[],links:[]}, graph, shell, linksGroup, realLinks=[];
let active=null, hovered=null, filter=null, query='', editing=null, density=2, fadeStrength=.7, rotate=true, saveTimer;
const candidates=Array.from({length:300},(_,i)=>fibonacci(300,i));
const temp=new THREE.Vector3();
const look=new THREE.Vector3();

function fibonacci(n,i) {
  const y=1-2*(i+.5)/n, r=Math.sqrt(Math.max(0,1-y*y)), a=i*Math.PI*(3-Math.sqrt(5));
  return new THREE.Vector3(Math.cos(a)*r*R,y*R,Math.sin(a)*r*R);
}
function placeNodes() {
  const assigned=[];
  records.nodes.forEach((node,i)=>{
    let v=new THREE.Vector3(node.x||0,node.y||0,node.z||0);
    if(v.length()>R*.8 && v.length()<R*1.2) v.normalize().multiplyScalar(R);
    else {
      let best=candidates[0],bestScore=-Infinity;
      for(const c of candidates) {
        const score=assigned.length ? Math.min(...assigned.map(p=>p.distanceToSquared(c))) : c.z+i;
        if(score>bestScore){bestScore=score;best=c;}
      }
      v=best.clone();
    }
    [node.x,node.y,node.z]=v.toArray();assigned.push(v);
  });
}
function normalize(raw) {
  if(!raw||!Array.isArray(raw.nodes))throw Error('JSON sem lista de conceitos');
  if(raw.nodes.length>1200)throw Error('Máximo de 1.200 conceitos');
  const nodes=raw.nodes.map((n,i)=>({
    id:String(n.id??'n'+i),label:String(n.label||n.title||'Sem título').slice(0,100),
    text:String(n.text||n.description||''),category:CATS[n.category]?n.category:'outra',
    status:STATUS[n.status]?n.status:'pending',tags:Array.isArray(n.tags)?n.tags.map(String):[],
    x:Number.isFinite(Number(n.x))&&n.x!=null?Number(n.x):null,
    y:Number.isFinite(Number(n.y))&&n.y!=null?Number(n.y):null,
    z:Number.isFinite(Number(n.z))&&n.z!=null?Number(n.z):null
  }));
  const ids=new Set(nodes.map(n=>n.id));
  if(ids.size!==nodes.length)throw Error('IDs duplicados');
  const seen=new Set(),links=[];
  for(const l of raw.links||raw.edges||[]){
    const a=String(typeof l.source==='object'?l.source.id:l.source);
    const b=String(typeof l.target==='object'?l.target.id:l.target);
    const key=[a,b].sort().join('|');
    if(ids.has(a)&&ids.has(b)&&a!==b&&!seen.has(key)){seen.add(key);links.push({source:a,target:b});}
  }
  return {nodes,links};
}
function snapshot() {
  return {nodes:records.nodes.map(n=>({...n,tags:[...n.tags]})),links:records.links.map(l=>({...l}))};
}
function save() {
  try {localStorage.setItem(STORAGE,JSON.stringify(snapshot()));$('save-status').textContent='Salvo neste navegador';}
  catch(e){$('save-status').textContent='Sem salvamento local — exporte JSON';console.warn(e);}
}
function scheduleSave() {$('save-status').textContent='Salvando…';clearTimeout(saveTimer);saveTimer=setTimeout(save,380);}
function shaderLines(color,alpha) {
  const declarations=['uniform float uFade;','varying float vFront;'].join('\n');
  return new THREE.ShaderMaterial({
    uniforms:{uFade:{value:1},uColor:{value:new THREE.Color(color)},uOpacity:{value:alpha}},
    vertexShader:declarations+['void main(){',
      'vec4 w=modelMatrix*vec4(position,1.0);',
      'vFront=smoothstep(-0.9,0.88,dot(normalize(w.xyz),normalize(cameraPosition-w.xyz)));',
      'gl_Position=projectionMatrix*viewMatrix*w;','}'].join('\n'),
    fragmentShader:declarations+['uniform vec3 uColor;','uniform float uOpacity;','void main(){',
      'gl_FragColor=vec4(uColor,(0.10+0.90*vFront)*uOpacity*uFade);','}'].join('\n'),
    transparent:true,depthWrite:false,side:THREE.DoubleSide
  });
}
function dispose(group) {
  if(!group)return;
  graph.scene().remove(group);
  group.traverse(obj=>{
    obj.geometry?.dispose();
    if(obj.material)(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());
  });
}
function buildShell() {
  dispose(shell);
  const count=[0,115,205,300][density];
  const points=Array.from({length:count},(_,i)=>fibonacci(count,i).multiplyScalar(1+.024*Math.sin(i*7.13)));
  shell=new THREE.Group();
  const dotGeo=new THREE.BufferGeometry();
  dotGeo.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));
  const pointDeclarations=['uniform float uFade;','varying float vFront;'].join('\n');
  const dotMaterial=new THREE.ShaderMaterial({
    uniforms:{uFade:{value:1}},
    vertexShader:pointDeclarations+[
      'void main(){vec4 w=modelMatrix*vec4(position,1.0);',
      'vFront=smoothstep(-0.85,0.90,dot(normalize(w.xyz),normalize(cameraPosition-w.xyz)));',
      'vec4 mv=viewMatrix*w;gl_Position=projectionMatrix*mv;',
      'gl_PointSize=clamp(1000.0/max(1.0,-mv.z),1.4,5.5);}'
    ].join('\n'),
    fragmentShader:pointDeclarations+[
      'void main(){float d=length(gl_PointCoord-vec2(.5));if(d>.5)discard;',
      'float soft=1.0-smoothstep(.38,.5,d);',
      'gl_FragColor=vec4(.16,.19,.24,uFade*(.25+.75*vFront)*soft);}'
    ].join('\n'),
    transparent:true,depthWrite:false
  });
  const dots=new THREE.Points(dotGeo,dotMaterial);shell.add(dots);
  const segments=[],seen=new Set(),neighborCount=density===1?2:3;
  for(let i=0;i<count;i++){
    const near=[];
    for(let j=0;j<count;j++)if(i!==j)near.push([j,points[i].distanceToSquared(points[j])]);
    near.sort((a,b)=>a[1]-b[1]);
    for(let k=0;k<neighborCount;k++){
      const j=near[k][0],key=Math.min(i,j)+':'+Math.max(i,j);
      if(seen.has(key))continue;
      seen.add(key);segments.push(...points[i].toArray(),...points[j].toArray());
    }
  }
  const lineGeo=new THREE.BufferGeometry();
  lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
  const web=new THREE.LineSegments(lineGeo,shaderLines('#505b6b',.34));
  shell.add(web);shell.userData={dots,web};
  graph.scene().add(shell);
}
function makeNode(n){
  const obj=new THREE.Group(),color=CATS[n.category][1];
  const aura=new THREE.Mesh(new THREE.SphereGeometry(5.6,16,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.12,depthWrite:false}));
  const dot=new THREE.Mesh(new THREE.SphereGeometry(3.1,20,16),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1,depthWrite:false}));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(4.25,.26,8,26),
    new THREE.MeshBasicMaterial({color:n.status==='done'?'#7baa9a':n.status==='progress'?'#8f8abf':'#d3b581',transparent:true,opacity:.86,depthWrite:false}));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(n.x,n.y,n.z).normalize());
  obj.add(aura,dot,ring);obj.userData={aura,dot,ring,dim:false};return obj;
}
function sphericalArc(a,b){
  const A=new THREE.Vector3(a.x,a.y,a.z).normalize();
  const B=new THREE.Vector3(b.x,b.y,b.z).normalize();
  if(A.dot(B)<-.9995)B.add(new THREE.Vector3(.02,0,.01)).normalize();
  const theta=A.angleTo(B),denom=Math.sin(theta)||1,points=[];
  for(let i=0;i<=28;i++){
    const t=i/28;
    points.push(A.clone().multiplyScalar(Math.sin((1-t)*theta)/denom)
      .addScaledVector(B,Math.sin(t*theta)/denom).normalize().multiplyScalar(R*1.025));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}
function buildTrueLinks(){
  dispose(linksGroup);linksGroup=new THREE.Group();realLinks=[];
  const by=new Map(records.nodes.map(n=>[n.id,n]));
  for(const l of records.links){
    const a=by.get(l.source),b=by.get(l.target);if(!a||!b)continue;
    const line=new THREE.Line(sphericalArc(a,b),shaderLines('#7469ac',.85));
    line.userData={a:l.source,b:l.target};linksGroup.add(line);realLinks.push(line);
  }
  graph.scene().add(linksGroup);$('edge-count').textContent=records.links.length;
}
function related(id) {
  const result=new Set();
  records.links.forEach(l=>{if(l.source===id)result.add(l.target);if(l.target===id)result.add(l.source);});
  return result;
}
function highlight(){
  const adjacent=active?related(active):new Set();
  graph.graphData().nodes.forEach(n=>{
    const obj=n.__threeObj;if(!obj)return;
    const text=(n.label+' '+n.text+' '+n.tags.join(' ')).toLowerCase();
    obj.userData.dim=Boolean((filter&&n.category!==filter)||(query&&!text.includes(query))||(active&&n.id!==active&&!adjacent.has(n.id)));
    obj.scale.setScalar(n.id===active?1.45:n.id===hovered?1.25:1);
  });
  realLinks.forEach(line=>{
    line.userData.active=!!active&&(line.userData.a===active||line.userData.b===active);
    line.userData.dim=!!active&&!line.userData.active;
  });
}
function updateFade(){
  const cam=graph.camera(),distance=cam.position.length();
  const zoomFactor=THREE.MathUtils.smoothstep(distance,390,1090);
  const f=1-fadeStrength*zoomFactor;
  if(shell){shell.userData.dots.material.uniforms.uFade.value=f;shell.userData.web.material.uniforms.uFade.value=f;}
  realLinks.forEach(l=>{
    l.material.uniforms.uFade.value=f*(l.userData.dim?.22:1);
    l.material.uniforms.uOpacity.value=l.userData.active?1:.85;
  });
  const view=look.copy(cam.position).normalize();
  graph.graphData().nodes.forEach(n=>{
    const obj=n.__threeObj;if(!obj)return;
    const facing=temp.set(n.x,n.y,n.z).normalize().dot(view);
    const depth=.29+.71*THREE.MathUtils.smoothstep(facing,-.75,.8);
    const a=(n.id===active?1:depth)*f*(obj.userData.dim?.15:1);
    obj.userData.dot.material.opacity=Math.max(.025,a);
    obj.userData.ring.material.opacity=Math.max(.02,a*.86);
    obj.userData.aura.material.opacity=Math.max(.01,(n.id===active?.25:n.id===hovered?.17:.09)*a);
  });
}
function rebuild(){
  placeNodes();
  graph.graphData({nodes:records.nodes.map(n=>({...n,fx:n.x,fy:n.y,fz:n.z})),links:[]});
  buildTrueLinks();highlight();renderCategories();renderInspector();
  $('node-count').textContent=records.nodes.length;$('empty').hidden=!!records.nodes.length;
  scheduleSave();
}
function get(id){return records.nodes.find(n=>n.id===id);}
function select(id){
  if(!get(id))return;
  active=id;hovered=null;$('hover-label').hidden=true;
  renderInspector();highlight();graph._delayRotate();
}
function clear(){active=null;renderInspector();highlight();}
function renderInspector(){
  const n=get(active);$('inspector').hidden=!n;if(!n)return;
  $('inspect-category').textContent=CATS[n.category][0]+' · '+STATUS[n.status];
  $('inspect-name').textContent=n.label;
  $('inspect-text').textContent=n.text||'Sem descrição registrada.';
  const tags=$('inspect-tags');tags.replaceChildren();n.tags.forEach(t=>{const s=document.createElement('span');s.textContent='#'+t;tags.appendChild(s);});
  const direct=related(n.id),area=$('inspect-links');area.replaceChildren();
  if(!direct.size){const s=document.createElement('small');s.textContent='Nenhuma conexão cadastrada';area.appendChild(s);}
  direct.forEach(id=>{
    const other=get(id);if(!other)return;
    const row=document.createElement('div');row.className='neighbor';
    const b=document.createElement('button');b.type='button';b.textContent=other.label;b.onclick=()=>select(id);
    const del=document.createElement('button');del.type='button';del.textContent='×';del.title='Desconectar';
    del.onclick=()=>{if(!confirm('Remover conexão com "'+other.label+'"?'))return;
      records.links=records.links.filter(l=>!((l.source===n.id&&l.target===id)||(l.source===id&&l.target===n.id)));
      buildTrueLinks();renderInspector();highlight();scheduleSave();};
    row.append(b,del);area.appendChild(row);
  });
  const choose=$('connect-select');choose.replaceChildren();
  const op=document.createElement('option');op.textContent='Escolher conceito…';op.value='';choose.appendChild(op);
  records.nodes.filter(x=>x.id!==n.id&&!direct.has(x.id))
    .sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'))
    .forEach(x=>{const o=document.createElement('option');o.textContent=x.label;o.value=x.id;choose.appendChild(o);});
  $('connect-add').disabled=choose.options.length<2;
}
function renderCategories(){
  const host=$('categories');host.replaceChildren();
  for(const [id,label,color] of [['all','Todas as categorias','#758294'],...Object.entries(CATS).map(([k,v])=>[k,v[0],v[1]])]){
    const b=document.createElement('button');b.type='button';b.className='category'+((filter===id||(!filter&&id==='all'))?' active':'');
    const c=document.createElement('i');c.style.background=color;
    const t=document.createElement('span');t.textContent=label;
    const count=document.createElement('span');count.className='num';count.textContent=id==='all'?records.nodes.length:records.nodes.filter(n=>n.category===id).length;
    b.append(c,t,count);b.onclick=()=>{filter=id==='all'?null:id;renderCategories();highlight();};
    host.appendChild(b);
  }
}
function renderSearch(){
  const host=$('search-list');host.replaceChildren();host.hidden=!query;
  if(!query){highlight();return;}
  const found=records.nodes.filter(n=>(n.label+' '+n.text+' '+n.tags.join(' ')).toLowerCase().includes(query)).slice(0,12);
  if(!found.length){const p=document.createElement('p');p.textContent='Nenhum resultado';host.appendChild(p);}
  found.forEach(n=>{const b=document.createElement('button');b.textContent=n.label;b.onclick=()=>{
    query='';$('search').value='';host.hidden=true;filter=null;renderCategories();select(n.id);
  };host.appendChild(b);});highlight();
}
function uniqueId(){const ids=new Set(records.nodes.map(n=>n.id));let id;do{id='idea-'+Math.random().toString(36).slice(2,10);}while(ids.has(id));return id;}
function modal(id=null){
  editing=id;const n=get(id);$('idea-title').textContent=n?'Editar ideia':'Nova ideia';
  $('idea-name').value=n?.label||'';$('idea-text').value=n?.text||'';
  $('idea-category').value=n?.category||'outra';$('idea-status').value=n?.status||'pending';
  $('idea-tags').value=n?.tags?.join(', ')||'';
  $('idea-dialog').showModal();$('idea-name').focus();
}
function toast(text){const el=$('toast');el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,3300);}
function download(){
  const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
  a.download='mapa-knowledge-esfera-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function chooseImport(count) {
  return new Promise(resolve=>{
    const d=$('import-dialog');$('import-count').textContent=count+' conceitos no arquivo.';
    let ended=false;
    const done=value=>{if(ended)return;ended=true;d.close();resolve(value);};
    const merge=()=>done('merge'),replace=()=>done('replace'),cancel=()=>done(null);
    $('import-merge').addEventListener('click',merge,{once:true});
    $('import-replace').addEventListener('click',replace,{once:true});
    $('import-cancel').addEventListener('click',cancel,{once:true});
    d.addEventListener('close',()=>{
      $('import-merge').removeEventListener('click',merge);
      $('import-replace').removeEventListener('click',replace);
      $('import-cancel').removeEventListener('click',cancel);
      done(null);
    },{once:true});
    d.showModal();
  });
}
async function importFile(e){
  const f=e.target.files?.[0];e.target.value='';if(!f)return;
  try {
    const raw=await f.text();
    const next=normalize(f.name.toLowerCase().endsWith('.json')?JSON.parse(raw):parseMarkdownImport(raw));
    if(!next.nodes.length)throw Error('Nenhuma ideia encontrada');
    const mode=records.nodes.length?await chooseImport(next.nodes.length):'replace';
    if(!mode)return;
    if(mode==='replace')records=next;
    else {
      const map=new Map(records.nodes.map(n=>[n.id,n]));
      next.nodes.forEach(n=>map.set(n.id,n));
      const seen=new Set();
      records={nodes:[...map.values()],links:[...records.links,...next.links].filter(l=>{
        const k=[l.source,l.target].sort().join('|');
        if(seen.has(k))return false;seen.add(k);return true;
      })};
    }
    active=null;filter=null;query='';$('search').value='';$('search-list').hidden=true;
    rebuild();fit();toast('Conceitos importados');
  } catch(error){toast('Importação: '+error.message);}
}
function fit(){
  const w=Math.max(host.clientWidth,360),h=Math.max(host.clientHeight,320);
  const rad=Math.min(w*.34,h*.375),fov=graph.camera().fov*Math.PI/180;
  const d=THREE.MathUtils.clamp((R*h)/(2*Math.tan(fov/2)*rad),245,680);
  graph.cameraPosition({x:0,y:0,z:d},{x:0,y:0,z:0},450);
  graph.controls().target.set(0,0,0);graph.controls().update();
}
function zoom(f){
  const cam=graph.camera(),dist=cam.position.length(),next=THREE.MathUtils.clamp(dist*f,165,1450);
  cam.position.multiplyScalar(next/dist);graph.controls().update();graph._delayRotate();
}
function initGraph(){
  graph=ForceGraph3D({controlType:'orbit'})(host)
    .backgroundColor('#fbfcfe').showNavInfo(false)
    .nodeThreeObject(makeNode).nodeThreeObjectExtend(false)
    .nodeLabel(()=>'').linkVisibility(false).enableNodeDrag(false)
    .onNodeClick(n=>select(n.id))
    .onNodeHover(n=>{hovered=n?.id||null;
      $('hover-label').hidden=!n;
      if(n)$('hover-label').textContent=n.label;
      highlight();
    });
  graph.d3Force('charge')?.strength(0);graph.d3Force('link')?.strength(0);graph.cooldownTicks(1);
  graph.scene().fog=new THREE.FogExp2(0xfbfcfe,.00065);
  const controls=graph.controls();controls.enableDamping=true;controls.dampingFactor=.07;
  controls.autoRotate=true;controls.autoRotateSpeed=.42;controls.enablePan=false;
  controls.minDistance=165;controls.maxDistance=1450;
  let timeout;
  graph._delayRotate=()=>{
    controls.autoRotate=false;clearTimeout(timeout);
    timeout=setTimeout(()=>{controls.autoRotate=rotate;},3400);
  };
  host.addEventListener('pointerdown',graph._delayRotate);
  host.addEventListener('wheel',graph._delayRotate,{passive:true});
  host.addEventListener('pointermove',event=>{
    const rect=$('universe').getBoundingClientRect();
    const x=event.clientX-rect.left,y=event.clientY-rect.top,el=$('hover-label');
    el.style.left=Math.max(8,Math.min(x+15,rect.width-245))+'px';
    el.style.top=Math.max(8,Math.min(y+14,rect.height-50))+'px';
  });
  // Fixed node positions don't need continuous force physics, only rendering.
  graph.pauseAnimation();
  function frame(){
    if(!document.hidden){
      controls.update();updateFade();
      graph.renderer().render(graph.scene(),graph.camera());
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  buildShell();rebuild();fit();
  new ResizeObserver(()=>graph.width(host.clientWidth).height(host.clientHeight)).observe(host);
}
function wire(){
  $('btn-fit').onclick=fit;$('zoom-fit').onclick=fit;
  $('zoom-in').onclick=()=>zoom(.83);$('zoom-out').onclick=()=>zoom(1.22);
  $('btn-rotate').onclick=()=>{rotate=!rotate;graph.controls().autoRotate=rotate;
    $('rotate-state').textContent=rotate?'Ativa':'Pausada';
    $('btn-rotate').setAttribute('aria-pressed',String(rotate));
  };
  $('density').oninput=e=>{density=+e.target.value;buildShell();$('density-value').textContent=['','Leve','Equilibrada','Detalhada'][density];};
  $('fade').oninput=e=>{fadeStrength=+e.target.value/100;$('fade-value').textContent=Math.round(fadeStrength*100)+'%';};
  $('search').oninput=e=>{query=e.target.value.trim().toLowerCase();renderSearch();};
  $('search').onkeydown=e=>{if(e.key==='Enter'&&query){
    const n=records.nodes.find(n=>(n.label+' '+n.text+' '+n.tags.join(' ')).toLowerCase().includes(query));
    if(n){query='';$('search').value='';$('search-list').hidden=true;select(n.id);}
  }};
  $('btn-add').onclick=()=>modal();
  $('idea-x').onclick=()=>$('idea-dialog').close();
  $('idea-cancel').onclick=()=>$('idea-dialog').close();
  $('idea-form').onsubmit=e=>{
    e.preventDefault();const label=$('idea-name').value.trim();if(!label)return;
    const patch={label,text:$('idea-text').value.trim(),category:$('idea-category').value,status:$('idea-status').value,
      tags:$('idea-tags').value.split(',').map(s=>s.trim()).filter(Boolean)};
    if(editing)Object.assign(get(editing),patch);
    else {const n={id:uniqueId(),...patch,x:null,y:null,z:null};records.nodes.push(n);active=n.id;}
    $('idea-dialog').close();rebuild();toast(editing?'Ideia atualizada':'Ideia criada');
  };
  $('inspect-close').onclick=clear;
  $('inspect-edit').onclick=()=>modal(active);
  $('inspect-remove').onclick=()=>{
    const n=get(active);if(!n||!confirm('Excluir "'+n.label+'" e suas conexões?'))return;
    records.nodes=records.nodes.filter(v=>v.id!==active);
    records.links=records.links.filter(l=>l.source!==active&&l.target!==active);
    active=null;rebuild();toast('Ideia excluída');
  };
  $('connect-add').onclick=()=>{
    const target=$('connect-select').value;if(!active||!target)return;
    if(!records.links.some(l=>[l.source,l.target].includes(active)&&[l.source,l.target].includes(target))){
      records.links.push({source:active,target});buildTrueLinks();renderInspector();highlight();scheduleSave();toast('Ligação criada');
    }
  };
  $('btn-export').onclick=download;
  $('btn-import').onclick=()=>$('file-import').click();
  $('file-import').onchange=importFile;
  window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);save();});
}
async function start(){
  try {
    const saved=localStorage.getItem(STORAGE);
    if(saved)records=normalize(JSON.parse(saved));
    else {const resp=await fetch('data/exemplo.json');if(!resp.ok)throw Error('Dados indisponíveis');records=normalize(await resp.json());}
  } catch(e){console.warn(e);records={nodes:[],links:[]};}
  try {wire();initGraph();$('save-status').textContent='Salvo neste navegador';}
  catch(e){console.error(e);$('graph-error').hidden=false;$('graph-error').textContent='Não foi possível iniciar a esfera 3D. Verifique o suporte WebGL.';}
}
start();
