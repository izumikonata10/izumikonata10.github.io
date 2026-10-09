'use strict';
(() => {
  const C=AtlasFeatureCore,states=new Map(),histories=new Map();let activeStroke=null,mode='pan',focusedTask=null,activeMap=map.mapId;
  const layout=document.querySelector('.layout'),canvas=$('mapCanvas');
  const panel=document.createElement('section');panel.className='task-panel';panel.setAttribute('aria-label','任务和剧情目标');
  panel.innerHTML='<div class="task-head"><button class="task-panel-close" id="closeTasks" aria-label="关闭任务面板">×</button><div class="eyebrow">当前地图 / TASK OBJECTIVES</div><h2>任务 / 剧情目标 <span id="taskCount"></span></h2><div class="task-search-row"><input id="taskSearch" type="search" aria-label="搜索任务和剧情目标" placeholder="搜索任务名、剧情或目标…"><button id="resetTasks">重置</button></div><div class="task-count-note" id="taskSelectionCount"></div></div><div class="task-options"><button id="showEveryTask">显示全部任务 / 剧情点</button><button id="clearTrackedTasks">清空选中</button><label><input type="checkbox" id="hideDoneTasks">隐藏已完成</label></div><div class="task-list" id="taskList"></div><div class="task-footer">勾选任务高亮地图点位，点击楼层跳转。<br>完成状态和手绘标记仅保存在当前浏览器。</div>';
  layout.append(panel);
  const toggle=document.createElement('button');toggle.id='toggleTasks';toggle.textContent='任务 / 剧情';toggle.setAttribute('aria-expanded','true');document.querySelector('.tools').prepend(toggle);
  if(innerWidth<1100)layout.classList.add('tasks-closed');
  function togglePanel(open){layout.classList.toggle('tasks-closed',!open);toggle.setAttribute('aria-expanded',String(open));}
  toggle.setAttribute('aria-expanded',String(!layout.classList.contains('tasks-closed')));toggle.onclick=()=>togglePanel(layout.classList.contains('tasks-closed'));$('closeTasks').onclick=()=>togglePanel(false);
  const bar=document.createElement('div');bar.className='draw-tools';bar.setAttribute('aria-label','地图手绘工具');bar.innerHTML='<button data-draw-mode="pan" class="active">移动</button><button data-draw-mode="stroke">画笔</button><button data-draw-mode="pin">图钉</button><button data-draw-mode="eraser">橡皮擦</button><label>颜色<input id="drawColor" type="color" value="#e45d32" aria-label="标记颜色"></label><label>粗细<select id="drawWidth" aria-label="画笔粗细"><option value="2">细</option><option value="4" selected>中</option><option value="7">粗</option></select></label><input id="pinText" type="text" maxlength="60" placeholder="图钉文字（可选）" aria-label="图钉文字"><button id="drawUndo" title="Ctrl+Z">撤销</button><button id="drawRedo" title="Ctrl+Shift+Z">重做</button><button id="drawClear">清空本层</button><span class="draw-hint" id="drawHint">按地图和楼层自动保存</span>';
  document.querySelector('.toolbar').after(bar);
  const clearDialog=document.createElement('dialog');clearDialog.id='clearDrawingDialog';clearDialog.innerHTML='<h2>清空本层手绘？</h2><p>只清除当前地图、当前楼层的手绘。清除后仍可撤销。</p><div class="clear-actions"><button id="cancelClear">取消</button><button class="primary" id="confirmClear">清空本层</button></div>';document.body.append(clearDialog);
  function tasks(){return window.ATLAS_TASKS[map.mapId]||[];}
  function state(){if(!states.has(map.mapId)){let raw;try{raw=JSON.parse(localStorage.getItem('tarkov-atlas-extras-v1:'+map.mapId)||'null');}catch{message('本机标记存储不可用，本次操作仍可使用。',true);}states.set(map.mapId,C.cleanState(raw));}return states.get(map.mapId);}
  function save(){try{localStorage.setItem('tarkov-atlas-extras-v1:'+map.mapId,JSON.stringify(state()));$('drawHint').textContent='已保存到本机';}catch{$('drawHint').textContent='保存失败，请勿关闭页面';message('浏览器存储空间不足或存储被禁用，标记暂时只保留在当前页面。',true);}}
  function drawing(){return state().floors[floor]||(state().floors[floor]=[]);}
  function history(){const k=map.mapId+':'+floor;if(!histories.has(k))histories.set(k,new C.DrawingHistory());return histories.get(k);}
  function changeDrawing(next){if(next.length>500){message('本层最多保存 500 个手绘标记，请先清理部分标记。',true);return;}history().commit(drawing());state().floors[floor]=next;save();drawAll();buttons();}
  function buttons(){$('drawUndo').disabled=!history().past.length;$('drawRedo').disabled=!history().future.length;$('drawClear').disabled=!drawing().length;}
  function setMode(next){mode=next;activeStroke=null;canvas.dataset.mode=next;bar.querySelectorAll('[data-draw-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.drawMode===next);b.setAttribute('aria-pressed',String(b.dataset.drawMode===next));});drawAll();}
  bar.querySelectorAll('[data-draw-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.drawMode));
  function track(t,on){const s=state();s.mode='selected';s.selected=on?[...new Set([...s.selected,t.id])]:s.selected.filter(id=>id!==t.id);focusedTask=on?t.id:null;save();renderTasks();refresh();}
  function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
  function renderTasks(){const all=tasks(),s=state(),list=C.filterTasks(all,$('taskSearch').value,$('hideDoneTasks').checked,s.done);$('taskCount').textContent=all.length;$('taskSelectionCount').textContent=s.mode==='selected'?`已选 ${s.selected.length} 项 · 列表匹配 ${list.length} 项`:`全部任务点可见 · 列表匹配 ${list.length} 项`;$('taskList').replaceChildren();
    if(!list.length){$('taskList').append(element('p',all.length?'没有匹配的目标，试试任务名、剧情名或重置筛选。':'当前地图的公开数据没有任务目标。','task-empty'));return;}
    const marks=new Map(map.markers.map(p=>[p.id,p]));
    for(const t of list){const card=element('article',undefined,'task-card');card.classList.toggle('is-tracked',s.selected.includes(t.id));card.classList.toggle('is-done',s.done.includes(t.id));card.append(element('div',t.kind==='story'?'剧情目标':'任务目标','task-kind'));
      const title=element('h3'),label=element('label'),check=element('input');check.type='checkbox';check.checked=s.selected.includes(t.id);check.setAttribute('aria-label','在地图标记：'+t.title+' '+t.description);check.onchange=()=>{if(!check.checked){track(t,false);return;}const points=t.markers.map(id=>marks.get(id)).filter(Boolean),target=points.find(p=>String(p.floor_key)===floor)||points[0];if(target)focusTask(t,String(target.floor_key));};label.append(check,document.createTextNode(' '+t.title));title.append(label);card.append(title,element('p',t.description||'点击楼层查看地图位置。'));if(t.needsKey)card.append(element('div','⚿ 此目标需要使用特定钥匙','task-key'));
      const actions=element('div',undefined,'task-card-actions');const counts=new Map();for(const id of t.markers){const p=marks.get(id);if(p)counts.set(String(p.floor_key),(counts.get(String(p.floor_key))||0)+1);}
      for(const [f,count]of counts){const button=element('button',(map.floors.find(x=>String(x.key)===f)?.name||f+'层')+' '+count+'个');button.onclick=()=>focusTask(t,f);actions.append(button);}
      const done=element('button',s.done.includes(t.id)?'已完成 ✓':'完成');done.classList.toggle('done',s.done.includes(t.id));done.setAttribute('aria-label',(s.done.includes(t.id)?'取消完成：':'完成：')+t.title);done.onclick=()=>{s.done=s.done.includes(t.id)?s.done.filter(id=>id!==t.id):[...s.done,t.id];save();renderTasks();};actions.append(done);
      if(t.href){const a=element('a','详细攻略 ↗');a.href=t.href;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}card.append(actions);$('taskList').append(card);
    }
  }
  async function focusTask(t,f){track(t,true);const id=map.mapId;setMode('pan');await setFloor(f);if(map.mapId!==id||floor!==f)return;const pts=map.markers.filter(p=>t.markers.includes(p.id)&&String(p.floor_key)===f);if(!pts.length)return;
    follow=false;$('followButton').classList.remove('active');
    const xs=pts.map(p=>+p.x),ys=pts.map(p=>+p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    for(const v of views){const fit=Math.min(v.w/currentFloor().width,v.h/currentFloor().height);v.zoom=Math.min(fit*12,Math.max(fit,Math.min((v.w-70)/Math.max(70,Math.max(...xs)-Math.min(...xs)),(v.h-90)/Math.max(70,Math.max(...ys)-Math.min(...ys)))));v.panX=v.w/2-cx*v.zoom;v.panY=v.h/2-cy*v.zoom;v.draw();}detail(pts[0]);updateStatus('任务定位：'+t.title+' · '+currentFloor().name+'（已暂停跟随玩家）');
  }
  $('taskSearch').oninput=renderTasks;$('hideDoneTasks').onchange=renderTasks;
  $('resetTasks').onclick=()=>{$('taskSearch').value='';$('hideDoneTasks').checked=false;state().selected=[];state().mode='default';focusedTask=null;save();renderTasks();refresh();};
  $('showEveryTask').onclick=()=>{state().mode='all';state().selected=[];focusedTask=null;save();renderTasks();refresh();};
  $('clearTrackedTasks').onclick=()=>{state().mode='selected';state().selected=[];focusedTask=null;save();renderTasks();refresh();};
  const originalVisible=visibleMarkers;visibleMarkers=function(){const s=state();return C.visibleTaskMarkers(map.markers,originalVisible(),floor,tasks(),s.mode,s.selected);};
  const originalDraw=MapView.prototype.draw;MapView.prototype.draw=function(){originalDraw.call(this);if(!this.w||!this.h)return;if(activeStroke&&(activeStroke.mapId!==map.mapId||activeStroke.floor!==floor))activeStroke=null;
    const c=this.ctx,z=this.zoom;const highlighted=C.taskMarkerIds(tasks(),state().selected);
    for(const hit of this.hits){if(!highlighted.has(hit.p.id))continue;c.save();c.strokeStyle='#f0bf35';c.lineWidth=3;c.beginPath();c.arc(hit.x,hit.y,17,0,Math.PI*2);c.stroke();c.fillStyle='#223020ee';c.font='bold 11px "Microsoft YaHei"';const title=hit.p.title.slice(0,36);const width=c.measureText(title).width;c.fillRect(hit.x-width/2-5,hit.y+21,width+10,19);c.fillStyle='#f2df8a';c.textAlign='center';c.fillText(title,hit.x,hit.y+34);c.restore();}
    for(const item of [...drawing(),...(activeStroke?[activeStroke.item]:[])]){c.save();c.strokeStyle=item.color;c.fillStyle=item.color;c.lineCap='round';c.lineJoin='round';c.lineWidth=item.width*z;const to=p=>[p[0]*z+this.panX,p[1]*z+this.panY];if(item.type==='stroke'){c.beginPath();item.points.forEach((p,i)=>{const [x,y]=to(p);i?c.lineTo(x,y):c.moveTo(x,y);});if(item.points.length===1){const [x,y]=to(item.points[0]);c.arc(x,y,item.width*z/2,0,Math.PI*2);c.fill();}else c.stroke();}else{const [x,y]=to(item.points[0]);c.beginPath();c.arc(x,y,7,0,Math.PI*2);c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();c.font='bold 12px "Microsoft YaHei"';c.textAlign='center';const text=item.text||'标记',width=c.measureText(text).width;c.fillStyle='#17241dec';c.fillRect(x-width/2-6,y-31,width+12,21);c.fillStyle='#fff';c.fillText(text,x,y-16);}c.restore();}
  };
  const originalLocate=locateName;locateName=async function(...args){if(activeStroke)return false;return originalLocate(...args);};
  const originalSelect=selectMap;selectMap=async function(...args){activeStroke=null;focusedTask=null;const pending=originalSelect(...args);activeMap=map.mapId;$('taskSearch').value='';setMode('pan');renderTasks();buttons();await pending;};
  const originalFloors=renderFloors;renderFloors=function(){activeStroke=null;originalFloors();buttons();};
  function point(e){return C.worldPoint(mainView,e.clientX,e.clientY,canvas.getBoundingClientRect());}
  function inside(p){const f=currentFloor();return p[0]>=0&&p[1]>=0&&p[0]<=f.width&&p[1]<=f.height;}
  function block(e){e.preventDefault();e.stopImmediatePropagation();}
  canvas.addEventListener('pointerdown',e=>{if(mode==='pan')return;block(e);if(e.button!==0)return;const p=point(e);if(!inside(p))return;canvas.setPointerCapture(e.pointerId);
    if(mode==='eraser'){const i=C.hitDrawing(drawing(),p,12/mainView.zoom);if(i>=0)changeDrawing(drawing().filter((_,n)=>n!==i));return;}
    if(mode==='pin'){changeDrawing([...drawing(),{type:'pin',points:[p],width:4,color:$('drawColor').value,text:$('pinText').value.trim()||'标记'}]);return;}
    activeStroke={mapId:map.mapId,floor,pointerId:e.pointerId,item:{type:'stroke',points:[p],width:Number($('drawWidth').value)/mainView.zoom,color:$('drawColor').value,text:''}};drawAll();
  },true);
  canvas.addEventListener('pointermove',e=>{if(mode==='pan')return;block(e);if(!activeStroke||e.pointerId!==activeStroke.pointerId)return;if(activeStroke.mapId!==map.mapId||activeStroke.floor!==floor){activeStroke=null;return;}const p=point(e),points=activeStroke.item.points;if(inside(p)&&Math.hypot(p[0]-points.at(-1)[0],p[1]-points.at(-1)[1])*mainView.zoom>=2&&points.length<10000){points.push(p);drawAll();}},true);
  canvas.addEventListener('pointerup',e=>{if(mode==='pan')return;block(e);if(activeStroke&&e.pointerId===activeStroke.pointerId){const stroke=activeStroke;activeStroke=null;if(stroke.mapId===map.mapId&&stroke.floor===floor)changeDrawing([...drawing(),stroke.item]);}if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);},true);
  canvas.addEventListener('pointercancel',()=>{activeStroke=null;drawAll();},true);canvas.addEventListener('lostpointercapture',()=>{if(activeStroke){activeStroke=null;drawAll();}},true);
  canvas.addEventListener('wheel',e=>{if(activeStroke)block(e);},true);canvas.addEventListener('dblclick',e=>{if(mode!=='pan')block(e);},true);
  function undo(){activeStroke=null;state().floors[floor]=history().undo(drawing());save();drawAll();buttons();}
  function redo(){activeStroke=null;state().floors[floor]=history().redo(drawing());save();drawAll();buttons();}
  $('drawUndo').onclick=undo;$('drawRedo').onclick=redo;
  let clearContext=null;$('drawClear').onclick=()=>{clearContext=map.mapId+':'+floor;clearDialog.showModal();};$('cancelClear').onclick=()=>clearDialog.close();$('confirmClear').onclick=()=>{if(clearContext===map.mapId+':'+floor)changeDrawing([]);else message('地图或楼层已切换，未清除标记。');clearDialog.close();};
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){setMode('pan');return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}});
  window.addEventListener('blur',()=>{activeStroke=null;drawAll();});
  $('helpDialog').append(element('p','任务 / 剧情面板可以按名称、目标内容搜索；勾选后高亮对应地图点，点击楼层按钮自动切层并居中，同时暂停跟随玩家。完成记录仅保存在本机，不会提交到游戏或参考网站。画笔与图钉按地图及楼层保存；橡皮擦点击删除一笔或一个图钉，清空本层可撤销。按 Esc 返回移动模式。'));
  renderTasks();buttons();setMode('pan');refresh();
})();
