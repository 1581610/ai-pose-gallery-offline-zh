/* Pose Index. Native browser APIs only; all assets and records remain local. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA = JSON.parse($('#poseData').textContent);
const GALLERY_MODE = document.querySelector('meta[name="pose-index-mode"]').content;
const ONLINE = GALLERY_MODE!=='offline';
const HOSTED = GALLERY_MODE==='hosted';
if(ONLINE){
  document.title='姿态索引 · 中文姿势参考图库';
  $('#pageSubtitle').textContent=HOSTED?'完整中文图库 · 素材来源：ギア。收藏、集合与备注保存在你的浏览器。':'图片由原作者站点提供，浏览需要联网。收藏、集合与备注保存在你的浏览器。';
  $('.side-bottom p').textContent='个人记录留在本机 · 无统计脚本';
  $('.footer>span').textContent='姿态索引 · POSE INDEX / 素材原作者：ギア';
}
const byId = new Map(DATA.map(d => [d.id, d]));
const ANGLES = ['正面','俯视','仰视','侧面','斜视'];
const groupMap = new Map();
DATA.forEach(d => {
  if (!groupMap.has(d.pose)) groupMap.set(d.pose, { ...d, items: [] });
  groupMap.get(d.pose).items.push(d);
});
const GROUPS = [...groupMap.values()];
GROUPS.forEach(g => g.items.sort((a,b) => ANGLES.indexOf(a.angle)-ANGLES.indexOf(b.angle)));
const series = [...new Set(DATA.map(d => d.line))];
const synonymGroups = [['抬手','举手','举臂','抬臂','上举','举起','手臂上抬','手举过头'],['躺卧','躺姿','卧姿','躺着'],['侧面','侧视'],['仰视','低机位'],['俯视','高机位'],['斜视','斜侧'],['臀部','屁股'],['跪姿','跪立']];
function norm(s) { return String(s).normalize('NFKC').toLowerCase(); }
function expand(s) { let t=norm(s); for(const group of synonymGroups) if(group.some(x=>t.includes(x))) t+=' '+group.join(' '); return t; }
DATA.forEach(d => d.search = expand([d.name,d.ja,d.line,d.cat,d.angle,d.id,d.num].join(' ')));
const KEY='pose_index_v2';
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
const validIds = v => Array.isArray(v) ? [...new Set(v.filter(x => typeof x==='string' && byId.has(x)))] : [];
const validPoses = v => Array.isArray(v) ? [...new Set(v.filter(x => typeof x==='string' && groupMap.has(x)))] : [];
function sanitize(raw) {
  const x=raw && typeof raw==='object' ? raw : {};
  const collections=[];
  for(const c of (Array.isArray(x.collections) ? x.collections.slice(0,100) : [])) {
    if(c && typeof c.name==='string' && c.name.trim()) collections.push({id:typeof c.id==='string'&&/^c[a-z0-9-]{1,70}$/i.test(c.id)?c.id:uid(),name:c.name.trim().slice(0,60),items:validIds(c.items)});
  }
  const notes={};
  if(x.notes && typeof x.notes==='object') for(const [k,v] of Object.entries(x.notes)) if(groupMap.has(k)&&typeof v==='string') notes[k]=v.slice(0,3000);
  return {version:2, favImages:validIds(x.favImages),favPoses:validPoses(x.favPoses),collections,notes,recent:validIds(x.recent).slice(0,150),board:validIds(x.board).slice(0,4)};
}
function uid() { return 'c'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9); }
const loaded=read(KEY);
let store=sanitize(loaded);
if(!loaded) store.favImages=validIds(read('pose_fav'));
const old=loaded?.view||{};
const S={scope:['all','fav','recent'].includes(old.scope)||store.collections.some(c=>c.id===old.scope)?old.scope:'all',line:series.includes(old.line)?old.line:'',cat:typeof old.cat==='string'?old.cat:'',angle:ANGLES.includes(old.angle)?old.angle:'',query:typeof old.query==='string'?old.query.slice(0,500):'',mode:['pose','single','compare'].includes(old.mode)?old.mode:'pose',sort:old.sort==='name'?'name':'source',density:Math.max(155,Math.min(295,Number(old.density)||215)),ja:!!old.ja,theme:old.theme==='dark'?'dark':'light',shown:Math.max(1,Math.min(DATA.length,Number(old.shown)||48)),scroll:Math.max(0,Math.min(1000000,Number(old.scroll)||0))};
const selected=new Set();
let matches=[],results=[],filteredGroups=[],current=null,zoom=1,pan={x:0,y:0},mirror=false,loadToken=0,returnFocus=null,storageWarning=false,searchTimer;
function toast(message) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3200); }
function save() {
  try { localStorage.setItem(KEY,JSON.stringify({...store,view:S})); }
  catch { if(!storageWarning) {storageWarning=true;toast('浏览器无法保存记录，请使用“导出个人资料”备份。');} }
}
function favourite(d) { return store.favPoses.includes(d.pose)||store.favImages.includes(d.id); }
function collection() { return store.collections.find(c=>c.id===S.scope); }
function compute() {
  const tokens=norm(S.query).trim().split(/\s+/).filter(Boolean);
  const scopeIds=S.scope==='recent'?new Set(store.recent):collection()?new Set(collection().items):null;
  matches=DATA.filter(d => (!S.line||d.line===S.line)&&(!S.cat||d.cat===S.cat)&&(!S.angle||d.angle===S.angle)&&(S.scope!=='fav'||favourite(d))&&(!scopeIds||scopeIds.has(d.id))&&tokens.every(t=>d.search.includes(t)));
  const groups=new Map();
  for(const d of matches) { if(!groups.has(d.pose)) groups.set(d.pose,{group:groupMap.get(d.pose),items:[]});groups.get(d.pose).items.push(d); }
  filteredGroups=[...groups.values()];
  if(S.scope==='recent') { const pos=new Map(store.recent.map((id,i)=>[id,i]));matches.sort((a,b)=>pos.get(a.id)-pos.get(b.id));filteredGroups.sort((a,b)=>Math.min(...a.items.map(x=>pos.get(x.id)))-Math.min(...b.items.map(x=>pos.get(x.id)))); }
  else if(S.sort==='name') {matches.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));filteredGroups.sort((a,b)=>a.group.name.localeCompare(b.group.name,'zh-CN'));}
  results=S.mode==='single'?matches:filteredGroups;
}
function batch() {return S.mode==='single'?96:S.mode==='compare'?24:48;}
function nav() {
  $('#poseTotal').textContent=GROUPS.length;$('#imageTotal').textContent=DATA.length.toLocaleString();$('#librarySize').textContent=GROUPS.length;
  $('#favCount').textContent=DATA.filter(favourite).length;$('#recentCount').textContent=new Set(store.recent.map(id=>byId.get(id).pose)).size;
  $('#libraryNav').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.scope===S.scope));
  $('#collections').innerHTML=store.collections.map(c=>`<button class="nav-item ${S.scope===c.id?'active':''}" data-scope="${esc(c.id)}">${esc(c.name)}<span>${c.items.length}</span></button>`).join('')+`<button class="nav-item mobile-collection" data-new>＋ 新建集合</button>`;
  $('#series').innerHTML=[['','全部系列'],...series.map(x=>[x,x])].map(([v,n])=>`<button class="nav-item ${S.line===v?'active':''}" data-line="${esc(v)}">${esc(n)}<span>${v?GROUPS.filter(g=>g.line===v).length:GROUPS.length}</span></button>`).join('');
  const cats=[...new Set(DATA.filter(d=>!S.line||d.line===S.line).map(d=>d.cat))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  $('#category').innerHTML='<option value="">全部分类</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');$('#category').value=S.cat;
  $('#angle').innerHTML='<option value="">全部视角</option>'+ANGLES.map(a=>`<option>${a}</option>`).join('');$('#angle').value=S.angle;
  $('#sort').value=S.sort;$('#search').value=S.query;$('#density').value=S.density;$('#showJa').checked=S.ja;
  document.documentElement.dataset.theme=S.theme;document.documentElement.style.setProperty('--card-size',S.density+'px');document.body.classList.toggle('show-ja',S.ja);
  $$('#modes button').forEach(b=>{b.classList.toggle('active',b.dataset.mode===S.mode);b.setAttribute('aria-pressed',b.dataset.mode===S.mode);});
  $('#pageTitle').textContent=collection()?.name||({all:'找到下一笔的姿态。',fav:'留住值得反复看的姿态。',recent:'接着上一次的灵感。'}[S.scope]||'参考集合');
  $('#collectionActions').hidden=!collection();$('#boardCount').textContent=store.board.length+' / 4';
}
function chips() {
  $('#activeFilters').innerHTML=[['line',S.line],['cat',S.cat],['angle',S.angle],['query',S.query]].filter(([,v])=>v).map(([k,v])=>`<button class="filter-chip" data-clear="${k}" aria-label="移除筛选 ${esc(v)}">${esc(v)}<span>×</span></button>`).join('');
}
function angleStrip(g,d) {
  return '<div class="angle-strip">'+ANGLES.map(a=>{const x=g.items.find(x=>x.angle===a);return x?`<button class="angle-mini ${x.id===d.id?'active':''}" data-open="${esc(x.id)}" aria-label="查看${a}"><img src="${esc(x.thumb)}" loading="lazy" decoding="async" alt=""><span>${a}</span></button>`:`<span class="angle-mini missing" title="源素材没有此视角">—</span>`;}).join('')+'</div>';
}
function card(d,grouped) {
  const g=groupMap.get(d.pose),ids=grouped?g.items.map(x=>x.id):[d.id],checked=ids.every(id=>selected.has(id));
  return `<article class="card" tabindex="0" role="button" aria-label="打开 ${esc(d.name)}，${esc(d.angle)}" data-id="${esc(d.id)}" data-pose="${esc(d.pose)}"><div class="card-image"><img src="${esc(d.thumb)}" loading="lazy" decoding="async" alt="${esc(d.name+' '+d.angle)}"><div class="card-top"><span class="card-number">${esc(d.num)} · ${esc(d.angle)}</span><input class="card-check" type="checkbox" data-select="${esc(grouped?d.pose:d.id)}" ${checked?'checked':''} aria-label="选择${grouped?'整组姿势':'此图'}"></div><button class="fav-mark ${favourite(d)?'on':''}" data-fav="${esc(grouped?d.pose:d.id)}" title="${grouped?'收藏整个姿势':'收藏此图'}" aria-label="${grouped?'收藏整个姿势':'收藏此图'}" aria-pressed="${grouped?store.favPoses.includes(d.pose):store.favImages.includes(d.id)}">${favourite(d)?'♥':'♡'}</button></div><div class="card-body"><h3>${esc(d.name)}</h3><div class="ja">${esc(d.ja)}</div><div class="card-detail"><span>${esc(d.cat)}</span><span>${grouped?g.items.length+' 个视角':esc(d.angle)}</span></div></div>${grouped?angleStrip(g,d):''}</article>`;
}
function compare(entry) {
  const g=entry.group;
  const angles=S.angle?[S.angle]:ANGLES;
  return `<section class="compare-group" data-pose="${esc(g.pose)}"><div class="compare-heading"><h3>${esc(g.num)} / ${esc(g.name)}</h3><span class="muted">${esc(g.line)}</span></div><div class="compare-images">${angles.map(a=>{const d=g.items.find(d=>d.angle===a);return d?`<button class="compare-image" data-open="${esc(d.id)}" aria-label="打开${esc(g.name)}，${a}"><img src="${esc(d.thumb)}" alt="${esc(g.name+' '+a)}" loading="lazy" decoding="async"><span>${a}${favourite(d)?' ♥':''}</span></button>`:`<div class="compare-image missing">${a} · 未提供</div>`;}).join('')}</div></section>`;
}
function selectionUi() {$('#selectionBar').hidden=!selected.size;$('#selectionCount').textContent='已选 '+selected.size+' 张图片';}
function draw(recompute=true) {
  if(recompute)compute();nav();chips();selectionUi();
  $('#grid').className='grid '+S.mode+(S.angle?' filtered':'');
  const visible=results.slice(0,S.shown);
  $('#grid').innerHTML=visible.map(e=>S.mode==='single'?card(e,false):S.mode==='compare'?compare(e):card(e.items[0],true)).join('')||'<div class="empty"><p>NO MATCHES</p><h2>还没有符合条件的图片</h2><p>试试减少筛选条件，或将图片加入收藏与集合。</p><button class="btn" data-reset>清除筛选</button></div>';
  const contextCount=S.mode==='compare'?filteredGroups.reduce((n,e)=>n+(S.angle?e.group.items.filter(d=>d.angle===S.angle).length:e.group.items.length),0):matches.length;
  $('#resultCount').textContent=`${filteredGroups.length} 个姿势 · ${matches.length.toLocaleString()} 张图片`+(contextCount!==matches.length?` · 完整对照 ${contextCount} 张`:'');
  $('#shownCount').textContent=`已显示 ${Math.min(S.shown,results.length)} / ${results.length} ${S.mode==='single'?'张':'组'}`;
  $('#loadMore').hidden=S.shown>=results.length;$('#endLabel').hidden=S.shown<results.length||!results.length;
  $('#loadMore').textContent=`继续浏览 · 还有 ${Math.max(0,results.length-S.shown)} ${S.mode==='single'?'张':'组'}`;
}
function update(patch,{reset=true}={}) {Object.assign(S,patch);if(reset){S.shown=batch();S.scroll=0;selected.clear();}draw();save();}
function reset() {update({scope:'all',line:'',cat:'',angle:'',query:''});}
function toggleFav(value) {
  const type=groupMap.has(value)?'favPoses':'favImages',a=store[type],i=a.indexOf(value);if(i<0)a.push(value);else a.splice(i,1);save();draw();if(current) viewerInfo();
}
function download(text,name,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function csv(items) {
  const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['id','系列','编号','分类','姿势名','视角','文件','日文原名'],...items.map(d=>[d.id,d.line,d.num,d.cat,d.name,d.angle,d.full,d.ja])];
  download('\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n'),'pose-index-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');toast('已导出 '+items.length+' 张图片的索引');
}
function promptDialog(title,html,confirm='确定') {
  return new Promise(resolve=>{const dlg=$('#smallDialog');$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#dialogConfirm').textContent=confirm;
    dlg.returnValue='';dlg.onclose=()=>{resolve(dlg.returnValue==='ok'?($('#dialogValue')?.value??true):null);dlg.onclose=null;};dlg.showModal();setTimeout(()=>$('#dialogValue')?.focus(),0);
  });
}
async function newCollection(items=[]) {
  const name=await promptDialog('新建参考集合','<input id="dialogValue" aria-label="集合名称" maxlength="60" placeholder="例如：人物立绘、坐姿练习">','创建');
  if(typeof name!=='string'||!name.trim())return null;
  const c={id:uid(),name:name.trim(),items:validIds(items)};store.collections.push(c);save();draw();toast('已创建「'+c.name+'」');return c;
}
async function addToCollection(ids) {
  if(!ids.length){toast('请先选择图片');return;}
  if(!store.collections.length){await newCollection(ids);return;}
  const value=await promptDialog('加入参考集合','<select id="dialogValue" aria-label="选择集合">'+store.collections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')+'<option value="new">＋ 新建集合</option></select>','加入');
  if(value==='new'){await newCollection(ids);return;}const c=store.collections.find(c=>c.id===value);if(!c)return;c.items=[...new Set([...c.items,...ids])];save();draw();toast('已加入「'+c.name+'」');
}
function viewerInfo() {
  if(!current)return;const d=current,g=groupMap.get(d.pose);
  $('#viewerNumber').textContent=d.num+' / '+d.angle;$('#viewerTitle').textContent=d.name;$('#viewerJa').textContent=d.ja;
  $('#viewerPosition').textContent=(filteredGroups.findIndex(e=>e.group.pose===d.pose)+1)+' / '+filteredGroups.length+' 姿势';
  $('#viewerAngles').innerHTML=ANGLES.map(a=>{const x=g.items.find(x=>x.angle===a);return x?`<button class="angle-mini ${x.id===d.id?'active':''}" data-open="${esc(x.id)}" aria-label="切换${a}"><img src="${esc(x.thumb)}" alt=""><span>${a}</span></button>`:'<span class="angle-mini missing">—</span>';}).join('');
  $('#viewerMeta').innerHTML=[['系列',d.line],['分类',d.cat],['视角',d.angle],['文件',d.full],['编号',d.id]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  for(const [id,on,label] of [['favPose',store.favPoses.includes(d.pose),'姿势'],['favImage',store.favImages.includes(d.id),'此图']]){const b=$('#'+id);b.textContent=(on?'♥ 已收藏':'♡ 收藏')+label;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);}
  const pin=store.board.includes(d.id);$('#pinImage').textContent=pin?'移出参考台':'放入参考台';$('#pinImage').classList.toggle('on',pin);
  $('#downloadImage').href=d.full;$('#downloadImage').download=d.full.split('/').pop();$('#poseNote').value=store.notes[d.pose]||'';
  if(ONLINE&&!HOSTED){$('#downloadImage').removeAttribute('download');$('#downloadImage').target='_blank';$('#downloadImage').rel='noopener noreferrer';$('#downloadImage').textContent='打开原作者原图 ↗';}
  $('#prevPose').disabled=filteredGroups.findIndex(e=>e.group.pose===d.pose)<=0;$('#nextPose').disabled=filteredGroups.findIndex(e=>e.group.pose===d.pose)>=filteredGroups.length-1;
}
function transform() {
  $('#fullImage').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${mirror?-zoom:zoom},${zoom})`;
  $('#stage').classList.toggle('zoomed',zoom>1);$('#fitImage').textContent=zoom===1?'适应窗口':Math.round(zoom*100)+'% · 复位';$('#mirrorImage').setAttribute('aria-pressed',mirror);
}
function fit() {zoom=1;pan={x:0,y:0};transform();}
function setZoom(z){zoom=Math.max(1,Math.min(5,z));if(zoom===1)pan={x:0,y:0};transform();}
function openImage(id) {
  const d=byId.get(id);if(!d)return;
  if(!$('#viewer').open){returnFocus=document.activeElement;$('#viewer').showModal();document.body.style.overflow='hidden';}
  current=d;fit();mirror=false;transform();viewerInfo();
  store.recent=[d.id,...store.recent.filter(x=>x!==d.id)].slice(0,150);save();
  const token=++loadToken,img=$('#fullImage');img.src=d.thumb;img.alt=d.name+' '+d.angle;$('#imageStatus').textContent='正在读取原图…';
  const full=new Image();full.onload=()=>{if(token!==loadToken)return;img.src=d.full;$('#imageStatus').textContent='';};full.onerror=()=>{if(token===loadToken)$('#imageStatus').textContent='原图读取失败，当前显示缩略图。请运行图片校验。';};full.src=d.full;
}
function closeViewer(){if($('#viewer').open)$('#viewer').close();}
$('#viewer').addEventListener('close',()=>{loadToken++;current=null;document.body.style.overflow='';draw();returnFocus?.focus({preventScroll:true});save();});
function stepAngle(n){if(!current)return;const a=groupMap.get(current.pose).items;openImage(a[(a.findIndex(x=>x.id===current.id)+n+a.length)%a.length].id);}
function stepPose(n){if(!current)return;const i=filteredGroups.findIndex(e=>e.group.pose===current.pose),next=filteredGroups[i+n];if(next)openImage((next.group.items.find(d=>d.angle===current.angle)||next.items[0]).id);}
function pin(id){const i=store.board.indexOf(id);if(i>=0)store.board.splice(i,1);else if(store.board.length<4)store.board.push(id);else{toast('参考台最多 4 张，请先移除一张');return;}save();nav();if(current)viewerInfo();}
function drawBoard(){ $('#boardGrid').innerHTML=store.board.map(id=>{const d=byId.get(id);return `<section class="board-card"><div><img src="${esc(d.full)}" alt="${esc(d.name+' '+d.angle)}"></div><header><span>${esc(d.num+' '+d.name+' / '+d.angle)}</span><div><button class="text-btn" data-board-mirror="${id}">镜像</button> <button class="text-btn" data-board-remove="${id}">移除</button></div></header></section>`;}).join('')||'<div class="board-empty">在大图预览中点击“放入参考台”，并排比较最多 4 张图片。</div>'; }
$('#libraryNav').onclick=e=>{const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#collections').onclick=e=>{if(e.target.closest('[data-new]')){newCollection();return;}const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#series').onclick=e=>{const b=e.target.closest('[data-line]');if(b)update({line:b.dataset.line,cat:''});};
$('#search').oninput=e=>{clearTimeout(searchTimer);const query=e.target.value;searchTimer=setTimeout(()=>update({query}),140);};
$('#category').onchange=e=>update({cat:e.target.value});$('#angle').onchange=e=>update({angle:e.target.value});$('#sort').onchange=e=>update({sort:e.target.value});
$('#resetBtn').onclick=reset;$('#activeFilters').onclick=e=>{const b=e.target.closest('[data-clear]');if(b)update({[b.dataset.clear]:'',...(b.dataset.clear==='line'?{cat:''}:{})});};
$('#modes').onclick=e=>{
  const b=e.target.closest('[data-mode]');if(!b||b.dataset.mode===S.mode)return;
  const anchor=$$('#grid [data-pose]').find(el=>el.getBoundingClientRect().bottom>$('.controls').getBoundingClientRect().bottom)?.dataset.pose;
  const beforeY=window.scrollY;S.mode=b.dataset.mode;compute();const i=results.findIndex(x=>(x.pose||x.group?.pose)===anchor);S.shown=Math.max(batch(),Math.ceil((i+1)/batch())*batch());draw(false);
  if(beforeY>$('#grid').offsetTop && anchor)requestAnimationFrame(()=>{const el=$$('#grid [data-pose]').find(x=>x.dataset.pose===anchor);if(el)window.scrollBy(0,el.getBoundingClientRect().top-$('.controls').offsetHeight-12);});save();
};
$('#density').oninput=e=>{S.density=+e.target.value;document.documentElement.style.setProperty('--card-size',S.density+'px');save();};
$('#showJa').onchange=e=>{S.ja=e.target.checked;document.body.classList.toggle('show-ja',S.ja);save();};$('#themeBtn').onclick=()=>{S.theme=S.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=S.theme;save();};
$('#filtersToggle').onclick=()=>{const open=$('.controls').classList.toggle('filters-open');$('#filtersToggle').setAttribute('aria-expanded',open);};
$('#loadMore').onclick=()=>{S.shown+=batch();draw(false);save();};$('#backTop').onclick=()=>window.scrollTo({top:0,behavior:'auto'});
$('#grid').onclick=e=>{
  const fav=e.target.closest('[data-fav]');if(fav){toggleFav(fav.dataset.fav);return;}
  if(e.target.closest('[data-select]'))return;
  if(e.target.closest('[data-reset]')){reset();return;}
  const open=e.target.closest('[data-open]');if(open){openImage(open.dataset.open);return;}
  const card=e.target.closest('.card');if(card)openImage(card.dataset.id);
};
$('#grid').onchange=e=>{const b=e.target.closest('[data-select]');if(!b)return;const value=b.dataset.select;const ids=groupMap.has(value)?groupMap.get(value).items.map(x=>x.id):[value];for(const id of ids)b.checked?selected.add(id):selected.delete(id);selectionUi();};
$('#grid').onkeydown=e=>{if(e.target.matches('.card')&&['Enter',' '].includes(e.key)){e.preventDefault();openImage(e.target.dataset.id);}};
$('#grid').onpointerover=e=>{if(e.pointerType==='touch')return;const b=e.target.closest('.angle-mini[data-open]'),card=b?.closest('.card');if(!card)return;const d=byId.get(b.dataset.open);card.dataset.id=d.id;card.querySelector('.card-image>img').src=d.thumb;card.querySelector('.card-number').textContent=d.num+' · '+d.angle;card.querySelectorAll('.angle-mini').forEach(x=>x.classList.toggle('active',x===b));};
$('#selectionClear').onclick=()=>{selected.clear();draw(false);};$('#selectVisible').onclick=()=>{for(const r of results.slice(0,S.shown)){const ds=S.mode==='single'?[r]:r.items;ds.forEach(d=>selected.add(d.id));}draw(false);};
$('#selectionCollection').onclick=()=>addToCollection([...selected]);$('#selectionCsv').onclick=()=>csv(DATA.filter(d=>selected.has(d.id)));$('#exportCsv').onclick=()=>csv(matches);
$('#copyPaths').onclick=async()=>{const text=matches.map(d=>d.full).join('\n');try{await navigator.clipboard.writeText(text);toast('已复制 '+matches.length+' 条相对路径');}catch{await promptDialog('图片相对路径','<p>浏览器未允许直接复制，可在下面全选后复制。</p><textarea id="dialogValue" aria-label="图片路径" rows="8" readonly>'+esc(text)+'</textarea>','关闭');}};
$('#newCollection').onclick=()=>newCollection();$('#renameCollection').onclick=async()=>{const c=collection();if(!c)return;const value=await promptDialog('重命名集合',`<input id="dialogValue" aria-label="集合名称" maxlength="60" value="${esc(c.name)}">`);if(typeof value==='string'&&value.trim()){c.name=value.trim();save();draw();}};
$('#removeFromCollection').onclick=()=>{const c=collection();if(!c)return;if(!selected.size){toast('请先勾选要移出的图片');return;}c.items=c.items.filter(id=>!selected.has(id));selected.clear();save();draw();};
$('#deleteCollection').onclick=async()=>{const c=collection();if(!c)return;if(await promptDialog('删除参考集合',`<p>删除「${esc(c.name)}」？仅移除集合记录，图片和收藏保留。操作前可导出个人资料。</p>`,'删除集合')){store.collections=store.collections.filter(x=>x!==c);update({scope:'all'});}};
$('#backupBtn').onclick=()=>{download(JSON.stringify({...store,format:'pose-index-backup',exportedAt:new Date().toISOString()},null,2),'pose-index-backup-'+new Date().toISOString().slice(0,10)+'.json');toast('个人资料已导出：收藏、集合、备注和参考台');};
$('#importInput').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>5000000)throw new Error('备份超过 5 MB');const raw=JSON.parse(await file.text());if(raw.format!=='pose-index-backup'||raw.version!==2)throw new Error('不是此图库支持的备份文件');const incoming=sanitize(raw);
    if(!await promptDialog('合并个人资料',`<p>将合并 ${incoming.favImages.length} 个单图收藏、${incoming.favPoses.length} 个姿势收藏、${incoming.collections.length} 个集合。已有收藏保留；同一姿势的已有备注优先保留。</p>`,'合并'))return;
    store.favImages=[...new Set([...store.favImages,...incoming.favImages])];store.favPoses=[...new Set([...store.favPoses,...incoming.favPoses])];
    for(const c of incoming.collections){const old=store.collections.find(x=>x.id===c.id);if(old)old.items=[...new Set([...old.items,...c.items])];else store.collections.push(c);}
    store.notes={...incoming.notes,...store.notes};store.recent=[...new Set([...store.recent,...incoming.recent])].slice(0,150);store.board=[...new Set([...store.board,...incoming.board])].slice(0,4);save();draw();toast('资料已合并');
  }catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}
};
$('#closeViewer').onclick=closeViewer;$('#viewerAngles').onclick=e=>{const b=e.target.closest('[data-open]');if(b)openImage(b.dataset.open);};
$('#prevAngle').onclick=()=>stepAngle(-1);$('#nextAngle').onclick=()=>stepAngle(1);$('#prevPose').onclick=()=>stepPose(-1);$('#nextPose').onclick=()=>stepPose(1);
$('#zoomIn').onclick=()=>setZoom(zoom*1.35);$('#zoomOut').onclick=()=>setZoom(zoom/1.35);$('#fitImage').onclick=fit;$('#mirrorImage').onclick=()=>{mirror=!mirror;transform();};
$('#favPose').onclick=()=>current&&toggleFav(current.pose);$('#favImage').onclick=()=>current&&toggleFav(current.id);$('#pinImage').onclick=()=>current&&pin(current.id);$('#addCollection').onclick=()=>current&&addToCollection([current.id]);
$('#poseNote').oninput=e=>{if(!current)return;store.notes[current.pose]=e.target.value;save();};
$('#boardBtn').onclick=()=>{drawBoard();$('#boardDialog').showModal();};$('#closeBoard').onclick=()=>$('#boardDialog').close();$('#clearBoard').onclick=()=>{store.board=[];save();nav();drawBoard();};
$('#boardGrid').onclick=e=>{const remove=e.target.closest('[data-board-remove]');if(remove){pin(remove.dataset.boardRemove);drawBoard();return;}if(e.target.closest('[data-board-mirror]'))e.target.closest('.board-card').firstElementChild.classList.toggle('mirror');};
$('#stage').addEventListener('wheel',e=>{if(e.target.closest('button'))return;e.preventDefault();setZoom(zoom*(e.deltaY>0?0.88:1.14));},{passive:false});
const points=new Map();let gesture=null;
$('#stage').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#stage').setPointerCapture(e.pointerId);if(points.size===1)gesture={x:e.clientX,y:e.clientY,pan:{...pan}};if(points.size===2){const p=[...points.values()];gesture={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom};}$('#stage').classList.add('dragging');});
$('#stage').addEventListener('pointermove',e=>{if(!points.has(e.pointerId)||!gesture)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2&&gesture.distance){const p=[...points.values()];setZoom(gesture.zoom*Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)/gesture.distance);}else if(points.size===1&&gesture.pan&&zoom>1){const rect=$('#stage').getBoundingClientRect();pan={x:Math.max(-rect.width*zoom/2,Math.min(rect.width*zoom/2,gesture.pan.x+e.clientX-gesture.x)),y:Math.max(-rect.height*zoom/2,Math.min(rect.height*zoom/2,gesture.pan.y+e.clientY-gesture.y))};transform();}});
function pointerEnd(e){const start=gesture;points.delete(e.pointerId);if(!points.size){$('#stage').classList.remove('dragging');if(e.type==='pointerup'&&start?.pan&&zoom===1&&e.pointerType==='touch'&&Math.abs(e.clientX-start.x)>60&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.5)stepAngle(e.clientX<start.x?1:-1);gesture=null;}else{const p=[...points.values()][0];gesture={x:p.x,y:p.y,pan:{...pan}};}}
$('#stage').addEventListener('pointerup',pointerEnd);$('#stage').addEventListener('pointercancel',pointerEnd);
$('#helpBtn').onclick=()=>promptDialog('使用姿态索引','<p>搜索支持空格分隔的多个关键词，例如“坐姿 侧面”，并包含一组常用动作同义词。</p><p>点开图片：默认完整显示，滚轮或双指缩放，放大后拖动。← → 换角度，↑ ↓ 换姿势，F 收藏姿势。</p><p>卡片右上角勾选可批量加入集合。参考台可固定 4 张图。</p><p>导出个人资料可备份收藏、集合和备注。浏览器的 file:// 与本地 HTTP 地址各自保存记录，切换入口请用备份迁移。</p><div class="help-actions"><button type="button" class="btn" id="helpBackup">导出个人资料</button> <label class="btn">导入资料<input type="file" id="helpImport" accept=".json" hidden></label></div><p>素材归原作者ギア；用于本机创作参考。请遵守原作者条款，不转载素材图片。</p>','关闭').then(()=>{});
$('#dialogBody').addEventListener('click',e=>{if(e.target.id==='helpBackup')$('#backupBtn').click();});
$('#dialogBody').addEventListener('change',e=>{if(e.target.id==='helpImport'){const dt=new DataTransfer();for(const f of e.target.files)dt.items.add(f);$('#importInput').files=dt.files;$('#smallDialog').close();$('#importInput').dispatchEvent(new Event('change'));}});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select,[contenteditable=true]'))return;
  if($('#smallDialog').open||$('#boardDialog').open)return;
  if($('#viewer').open){const actions={ArrowLeft:()=>stepAngle(-1),ArrowRight:()=>stepAngle(1),ArrowUp:()=>stepPose(-1),ArrowDown:()=>stepPose(1),f:()=>toggleFav(current.pose),F:()=>toggleFav(current.pose),' ':()=>{if(zoom!==1){fit();return;}const img=$('#fullImage'),z=Math.max(img.naturalWidth/img.clientWidth,img.naturalHeight/img.clientHeight);setZoom(z);}};if(actions[e.key]){e.preventDefault();actions[e.key]();}return;}
  if(e.key==='/'){e.preventDefault();$('#search').focus();}
});
let scrollTimer;window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{S.scroll=window.scrollY;save();},180);},{passive:true});
window.addEventListener('pagehide',()=>{S.scroll=window.scrollY;save();});
const initialScroll=S.scroll;draw();save();requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,initialScroll)));
})();
