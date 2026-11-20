import {frameAtTime, safePath, validateCatalog} from './timing.js';
import {bodyGeometry} from './landmarks.js';
const $=id=>document.getElementById(id);
const cameras={CAM_UL:'Upper left',CAM_LL:'Lower left',CAM_AV:'Aerial',CAM_UR:'Upper right',CAM_LR:'Lower right'};
const colors={pose:'#e5b963',face:'#a7db8e',hands:'#5fd7e8',objects:'#c4a5f0',gaze:'#f4dc68'};
const handEdges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const panes={}; let catalog, source, active, epoch=0, playing=false, frames={}, selectedPoints={}, urls=[], currentSnapshots={};
for(const [camera,name] of Object.entries(cameras)){
  const view=document.createElement('div');view.className='view';view.dataset.camera=camera;
  view.innerHTML=`<div class="view-heading"><strong>${camera}</strong><span>${name}</span></div><div class="view-stage"><video muted playsinline preload="metadata" aria-label="${name} camera"></video><canvas aria-label="${name} landmarks"></canvas><div class="placeholder">Video + saved landmarks</div></div><div class="view-body-status"></div>`;
  $('views').append(view);panes[camera]={video:view.querySelector('video'),canvas:view.querySelector('canvas'),placeholder:view.querySelector('.placeholder'),bodyStatus:view.querySelector('.view-body-status')};
  panes[camera].canvas.addEventListener('click',e=>inspectPoint(camera,e));
  panes[camera].video.addEventListener('seeked',()=>draw(camera));
  panes[camera].video.addEventListener('error',()=>{if(active){pause();status('A preview could not be decoded. Check that the complete H.264 export is available.');}});
}
function status(text){$('viewer-status').textContent=text;}
function pause(){playing=false;Object.values(panes).forEach(p=>p.video.pause());$('play').textContent='▶ Play';$('play').setAttribute('aria-label','Play');}
function cleanup(){pause();for(const p of Object.values(panes)){p.video.removeAttribute('src');p.video.load();p.canvas.getContext('2d').clearRect(0,0,p.canvas.width,p.canvas.height);p.placeholder.hidden=false;p.bodyStatus.textContent='';}for(const url of urls)URL.revokeObjectURL(url);urls=[];frames={};currentSnapshots={};selectedPoints={};}
function localSource(files){
  const map=new Map();
  for(const file of files){const path=file.webkitRelativePath.split('/').slice(1).join('/');if(safePath(path))map.set(path,file);}
  if(!map.has('catalog.json'))throw Error('Choose the web export folder containing catalog.json. The original HDF5 bundle needs exporting first.');
  return {label:'Local files · stay on this computer',async json(path){if(!safePath(path)||!map.has(path))throw Error('Missing sample file: '+path);const f=map.get(path);if(f.size>4_000_000)throw Error('Oversized JSON chunk');return JSON.parse(await f.text());},video(path){if(!safePath(path)||!map.has(path))throw Error('Missing preview: '+path);const u=URL.createObjectURL(map.get(path));urls.push(u);return u;}};
}
function hostedSource(){return {label:'Public research samples',async json(path){if(!safePath(path))throw Error('Invalid catalog path');const r=await fetch('/samples/v1/'+path,{credentials:'omit'});if(!r.ok)throw Error('The public sample could not be loaded. Please retry, or open a local export.');return r.json();},video(path){if(!safePath(path))throw Error('Invalid preview path');return '/samples/v1/'+path;}};}
async function openSource(next){
  const ticket=++epoch;cleanup();active=null;for(const id of ['samples','play','back','next','timeline','inspect'])$(id).disabled=true;
  status('Loading sample catalog…');
  try{const value=validateCatalog(await next.json('catalog.json'));if(ticket!==epoch)return;catalog=value;source=next;
    $('samples').replaceChildren(...catalog.groups.map((g,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${g.task} ${g.variant} · ${g.subtask} · ${g.participant}`;return o;}));
    $('samples').disabled=false;$('mode-badge').textContent=source.label;await loadGroup(0);
  }catch(e){if(ticket===epoch){cleanup();status(e.message);$('mode-badge').textContent='No sample loaded';}}
}
async function loadGroup(index){
  const ticket=++epoch;cleanup();active=null;const group=catalog.groups[index];
  for(const id of ['play','back','next','timeline','inspect'])$(id).disabled=true;
  status('Loading five camera previews and saved landmarks…');
  try{
    const nextFrames={};
    await Promise.all(Object.entries(group.views).map(async([camera,meta])=>{
      const rows=[];
      // Sequential bounded chunks keep the request burst small and memory predictable.
      for(const chunk of meta.chunks){const data=await source.json(chunk.path);if(ticket!==epoch)return;if(data.start!==chunk.start||data.frames?.length!==chunk.count)throw Error('Landmark chunk differs from catalog');rows.push(...data.frames);}
      if(rows.length!==meta.timestamps_ms.length||rows.some((f,i)=>f.frame_index!==i||f.width!==meta.width||f.height!==meta.height||Math.abs(f.timestamp_ms-meta.timestamps_ms[i])>0.01))throw Error('Landmark identity/timing mismatch');
      nextFrames[camera]=rows;
    }));
    if(ticket!==epoch)return;frames=nextFrames;active=group;
    for(const [camera,meta] of Object.entries(group.views)){
      const p=panes[camera];p.canvas.width=meta.width;p.canvas.height=meta.height;p.video.src=source.video(meta.video);p.video.playbackRate=+$('speed').value;p.video.load();p.placeholder.hidden=true;
    }
    $('sample-meta').textContent=`${group.participant} · ${group.subtask} · five views`;
    $('timeline').max=Math.floor(group.common_preview_end_ms);
    $('timeline').value=0;updateClock(0);
    for(const id of ['play','back','next','timeline','inspect'])$(id).disabled=false;
    status(`${group.task} ${group.variant} / ${group.subtask}. Saved predictions; lower-view actor identity and confidence are unknown. Relative clip timing; no newly estimated camera offsets.`);
    Object.keys(panes).forEach(draw);
  }catch(e){if(ticket===epoch){cleanup();active=null;status('Could not load sample: '+e.message);}}
}
function updateClock(ms){$('clock').textContent=`${(ms/1000).toFixed(2)} / ${((active?.common_preview_end_ms||0)/1000).toFixed(2)} s`;$('timeline').value=ms;}
function seek(ms){if(!active)return;ms=Math.max(0,Math.min(active.common_preview_end_ms,ms));Object.entries(panes).forEach(([camera,p])=>{p.video.currentTime=ms/1000;draw(camera,ms);});updateClock(ms);}
function draw(camera,forcedMs){
  const p=panes[camera],ctx=p.canvas.getContext('2d');ctx.clearRect(0,0,p.canvas.width,p.canvas.height);selectedPoints[camera]=[];
  p.video.style.visibility=$('show-video').checked?'visible':'hidden';
  if(!active||!frames[camera])return;
  const ms=forcedMs??p.video.currentTime*1000, index=frameAtTime(active.views[camera].timestamps_ms,ms);
  if(index===null)return;const f=frames[camera][index];currentSnapshots[camera]=f;
  const unit=p.canvas.width/(p.canvas.clientWidth||p.canvas.width);
  const body=bodyGeometry(f);
  p.bodyStatus.textContent=body.total?`${body.topology}: ${body.nodes.length}/${body.total} valid joints`:'Body pose not supplied for aerial view';
  const enabled=new Set([...document.querySelectorAll('.layers input[value]:checked')].map(x=>x.value));
  function point(xy,color,r=3){if(!xy||xy.length<2||!Number.isFinite(xy[0])||!Number.isFinite(xy[1]))return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(xy[0],xy[1],r,0,Math.PI*2);ctx.fill();}
  function group(value,layer,label){if(!value||!enabled.has(layer))return;(value.xy||[]).forEach((xy,i)=>{if(value.valid?.[i]===false||!xy)return;point(xy,colors[layer],layer==='face'?1.8:3);selectedPoints[camera].push({xy,layer,label,index:i,confidence:value.confidence?.[i]??null});});}
  function box(b,color){if(!b||b.length!==4||!b.every(Number.isFinite))return;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);}
  if(enabled.has('pose')){
    ctx.strokeStyle=colors.pose;ctx.lineWidth=1.7*unit;ctx.lineCap='round';
    for(const [a,b]of body.segments){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    for(const node of body.nodes){point(node.xy,colors.pose,2.8*unit);selectedPoints[camera].push({...node,layer:'pose',label:body.topology});}
  }
  group(f.face,'face','MediaPipe face');
  if(enabled.has('hands'))for(const h of f.hands||[]){const color=h.actor==='other_actor'?'#eb91c6':colors.hands;group(h,'hands',`${h.actor} / ${h.handedness}`);box(h.bbox,color);ctx.strokeStyle=color;ctx.lineWidth=2;for(const [a,b]of handEdges){if(h.xy?.[a]&&h.xy?.[b]&&h.valid?.[a]!==false&&h.valid?.[b]!==false){ctx.beginPath();ctx.moveTo(...h.xy[a]);ctx.lineTo(...h.xy[b]);ctx.stroke();}}}
  if(enabled.has('objects'))for(const o of f.objects||[])box(o.bbox,colors.objects);
  if(enabled.has('gaze')&&f.gaze){point(f.gaze,colors.gaze,7);selectedPoints[camera].push({xy:f.gaze,layer:'gaze',label:'AV gaze',confidence:null});}
}
function inspectPoint(camera,event){if(!active)return;const canvas=panes[camera].canvas,b=canvas.getBoundingClientRect(),xy=[(event.clientX-b.left)*canvas.width/b.width,(event.clientY-b.top)*canvas.height/b.height];let nearest,d=Infinity;for(const p of selectedPoints[camera]||[]){const delta=Math.hypot((p.xy[0]-xy[0])*b.width/canvas.width,(p.xy[1]-xy[1])*b.height/canvas.height);if(delta<d){d=delta;nearest=p;}}$('point-detail').textContent=nearest&&d<=18?`${camera} · ${nearest.label} · point ${nearest.index??'—'} · (${nearest.xy.map(v=>v.toFixed(2)).join(', ')}) px · confidence ${nearest.confidence===null?'unknown':nearest.confidence.toFixed(3)}`:`${camera} · no visible landmark near this point`;}
async function play(){if(!active)return;if(playing){pause();return;}if(panes.CAM_UL.video.currentTime*1000>=active.common_preview_end_ms-40)seek(0);try{await Promise.all(Object.values(panes).map(p=>p.video.play()));playing=true;$('play').textContent='Ⅱ Pause';$('play').setAttribute('aria-label','Pause');}catch(e){pause();status('Playback could not start: '+e.message);}}
function tick(){if(active){const master=panes.CAM_UL.video,ms=master.currentTime*1000;if(playing){if(ms>=active.common_preview_end_ms){pause();seek(active.common_preview_end_ms);}else{for(const [camera,p]of Object.entries(panes)){if(camera!=='CAM_UL'&&Math.abs(p.video.currentTime-master.currentTime)>.075&&!p.video.seeking)p.video.currentTime=master.currentTime;}updateClock(ms);}}Object.keys(panes).forEach(c=>draw(c));}requestAnimationFrame(tick);}requestAnimationFrame(tick);
$('folder').addEventListener('change',()=>{try{openSource(localSource($('folder').files));}catch(e){status(e.message);}});
$('load-hosted').addEventListener('click',()=>openSource(hostedSource()));
$('samples').addEventListener('change',()=>loadGroup(+$('samples').value));$('play').addEventListener('click',play);
function step(delta){pause();if(!active)return;const times=active.views.CAM_UL.timestamps_ms;const i=frameAtTime(times,panes.CAM_UL.video.currentTime*1000)??0;seek(times[Math.max(0,Math.min(times.length-1,i+delta))]);}
$('back').addEventListener('click',()=>step(-1));$('next').addEventListener('click',()=>step(1));
$('timeline').addEventListener('input',()=>{pause();seek(+$('timeline').value);});
$('speed').addEventListener('change',()=>Object.values(panes).forEach(p=>p.video.playbackRate=+$('speed').value));
$('inspect').addEventListener('click',()=>{const data={sample:active.id,relative_time_ms:panes.CAM_UL.video.currentTime*1000,coordinates:'original_source_pixels',views:currentSnapshots};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=active.id+'-landmarks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('keydown',e=>{if(!active||/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||!$('explorer').contains(e.target))return;if(e.code==='Space'){e.preventDefault();play();}if(e.key==='ArrowRight'){e.preventDefault();step(1);}if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}});
$('copy-citation').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('citation').textContent);$('citation-status').textContent='Copied';}catch{$('citation-status').textContent='Expand the citation to copy it.';}});
window.addEventListener('pagehide',cleanup);

// Load only the explicitly published sample catalog; full dataset access is separate.
openSource(hostedSource());
