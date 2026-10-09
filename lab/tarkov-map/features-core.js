'use strict';
const AtlasFeatureCore = (() => {
  function worldPoint(view, clientX, clientY, rect) {
    return [(clientX - rect.left - view.panX) / view.zoom, (clientY - rect.top - view.panY) / view.zoom];
  }
  function segmentDistance(p, a, b) {
    const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  }
  function hitDrawing(items,p,tolerance) {
    for(let i=items.length-1;i>=0;i--){const item=items[i];
      if(item.type==='pin'&&Math.hypot(p[0]-item.points[0][0],p[1]-item.points[0][1])<=tolerance)return i;
      if(item.type==='stroke'){
        if(item.points.length===1&&segmentDistance(p,item.points[0],item.points[0])<=tolerance+item.width/2)return i;
        for(let j=1;j<item.points.length;j++)if(segmentDistance(p,item.points[j-1],item.points[j])<=tolerance+item.width/2)return i;
      }
    }return -1;
  }
  function filterTasks(tasks,text,hideDone,done) {
    const words=text.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return tasks.filter(t=>(!hideDone||!done.includes(t.id))&&words.every(w=>(t.title+' '+t.description+' '+(t.english||'')).toLocaleLowerCase().includes(w)));
  }
  function taskMarkerIds(tasks,ids){return new Set(tasks.filter(t=>ids.includes(t.id)).flatMap(t=>t.markers));}
  function visibleTaskMarkers(all,base,floor,tasks,mode,ids) {
    if(mode==='default')return base;
    const allTaskIds=new Set(tasks.flatMap(t=>t.markers));
    const wanted=mode==='all'?allTaskIds:taskMarkerIds(tasks,ids);
    const merged=new Map(base.filter(p=>!allTaskIds.has(p.id)).map(p=>[p.id,p]));
    for(const p of all)if(String(p.floor_key)===String(floor)&&wanted.has(p.id))merged.set(p.id,p);
    return [...merged.values()];
  }
  function cleanState(raw) {
    const r=raw&&typeof raw==='object'?raw:{};
    const out={version:1,mode:['default','all','selected'].includes(r.mode)?r.mode:'default',selected:[],done:[],floors:{}};
    for(const k of ['selected','done'])out[k]=Array.isArray(r[k])?r[k].filter(x=>typeof x==='string').slice(0,2000):[];
    if(r.floors&&typeof r.floors==='object')for(const [floor,items]of Object.entries(r.floors)){
      if(!/^-?\d+$/.test(floor)||!Array.isArray(items))continue;
      out.floors[floor]=items.slice(0,500).filter(s=>s&&['stroke','pin'].includes(s.type)&&Array.isArray(s.points)&&s.points.length>0&&s.points.length<=10000&&s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&Number.isFinite(s.width)&&s.width>0&&s.width<1000&&/^#[0-9a-f]{6}$/i.test(s.color)).map(s=>({type:s.type,points:s.points.map(p=>p.slice()),width:s.width,color:s.color,text:String(s.text||'').slice(0,60)}));
    }return out;
  }
  class DrawingHistory {
    constructor(){this.past=[];this.future=[];}
    commit(items){this.past.push(structuredClone(items));if(this.past.length>30)this.past.shift();this.future=[];}
    undo(items){if(!this.past.length)return items;this.future.push(structuredClone(items));return this.past.pop();}
    redo(items){if(!this.future.length)return items;this.past.push(structuredClone(items));return this.future.pop();}
  }
  return {worldPoint,hitDrawing,filterTasks,taskMarkerIds,visibleTaskMarkers,cleanState,DrawingHistory};
})();
if(typeof module!=='undefined')module.exports=AtlasFeatureCore;
