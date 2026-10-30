/* Pose Index. Native browser APIs; personal records stay in browser storage. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA = JSON.parse($('#poseData').textContent);
const PROMPTS = (() => { const el = document.getElementById('promptData'); if (!el) return {}; try { return JSON.parse(el.textContent) || {}; } catch (e) { return {}; } })();
const GALLERY_MODE = document.querySelector('meta[name="pose-index-mode"]').content;
const ONLINE = GALLERY_MODE!=='offline';
const HOSTED = GALLERY_MODE==='hosted';
if(ONLINE){
  document.title='姿态索引 · 中文姿势参考图库';
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
  for(const c of (Array.isArray(x.collections) ? x.collections : [])) {
    if(c && typeof c.name==='string' && c.name.trim()) {
      const entry={id:typeof c.id==='string'&&/^c[a-z0-9-]{1,70}$/i.test(c.id)?c.id:uid(),name:c.name.trim().slice(0,60),items:validIds(c.items)};
      const same=collections.find(x=>x.id===entry.id);
      if(same) same.items=[...new Set([...same.items,...entry.items])]; else collections.push(entry);
    }
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
const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.trunc(value):fallback;
const S={scope:['all','fav','recent'].includes(old.scope)||store.collections.some(c=>c.id===old.scope)?old.scope:'all',line:series.includes(old.line)?old.line:'',cat:typeof old.cat==='string'?old.cat:'',angle:ANGLES.includes(old.angle)?old.angle:'',query:typeof old.query==='string'?old.query.slice(0,500):'',mode:['pose','single','compare'].includes(old.mode)?old.mode:'pose',sort:old.sort==='name'?'name':'source',density:Math.max(155,Math.min(295,finite(old.density,215))),ja:!!old.ja,theme:old.theme==='dark'?'dark':'light',shown:Math.max(1,Math.min(DATA.length,finite(old.shown,48))),scroll:Math.max(0,Math.min(1000000,finite(old.scroll,0)))};
const selected=new Set();
let cachedCollections='',cachedCategoryLine=null,seriesBuilt=false;
let imageExporting=false;
let matches=[],results=[],filteredGroups=[],viewerGroups=[],current=null,zoom=1,pan={x:0,y:0},mirror=false,loadToken=0,returnFocus=null,storageWarning=false,searchTimer,composing=false;
const clone=x=>JSON.parse(JSON.stringify(x));
let baseStore=clone(store);
// Apply this tab's additions/removals to the latest saved data, rather than
// replacing data another tab may have saved since our last read.
function mergeIds(base,local,remote) {
  const before=new Set(base),now=new Set(local),removed=new Set(base.filter(id=>!now.has(id)));
  return [...new Set([...remote.filter(id=>!removed.has(id)),...local.filter(id=>!before.has(id))])];
}
function mergeStore(base,local,remote) {
  const out=clone(remote);
  for(const key of ['favImages','favPoses']) out[key]=mergeIds(base[key],local[key],remote[key]);
  const before=new Map(base.collections.map(c=>[c.id,c]));
  const here=new Map(local.collections.map(c=>[c.id,c]));
  out.collections=remote.collections.filter(c=>!before.has(c.id)||here.has(c.id));
  for(const c of local.collections) {
    const prior=before.get(c.id),other=out.collections.find(x=>x.id===c.id);
    if(!prior){if(other)other.items=[...new Set([...other.items,...c.items])];else out.collections.push(clone(c));}
    else if(other){if(c.name!==prior.name)other.name=c.name;other.items=mergeIds(prior.items,c.items,other.items);}
    else if(JSON.stringify(prior)!==JSON.stringify(c))out.collections.push(clone(c));
  }
  for(const key of new Set([...Object.keys(base.notes),...Object.keys(local.notes)])) {
    if(base.notes[key]!==local.notes[key]) {if(Object.hasOwn(local.notes,key))out.notes[key]=local.notes[key];else delete out.notes[key];}
  }
  if(JSON.stringify(base.recent)!==JSON.stringify(local.recent))out.recent=[...new Set([...local.recent.filter(id=>!base.recent.includes(id)),...remote.recent,...local.recent])].slice(0,150);
  const added=local.board.filter(id=>!base.board.includes(id));
  out.board=[...new Set([...added,...mergeIds(base.board,local.board,remote.board)])].slice(0,4);
  return out;
}
function toast(message) {
  const el=$('#toast');el.textContent=message;
  clearTimeout(toast.timer);clearTimeout(toast.hideTimer);
  if(el.showPopover)el.showPopover();
  else ($('#smallDialog[open],#boardDialog[open],#viewer[open]')||document.body).append(el);
  el.classList.add('visible');
  toast.timer=setTimeout(()=>{el.classList.remove('visible');toast.hideTimer=setTimeout(()=>el.hidePopover?.(),200);},3200);
}
function save(visitedId=null) {
  try {
    const before=JSON.stringify(store);
    const latest=read(KEY);
    if(latest)store=mergeStore(baseStore,store,sanitize(latest));
    // An explicit visit must stay newest even when merging saved history.
    if(visitedId&&byId.has(visitedId))store.recent=[visitedId,...store.recent.filter(id=>id!==visitedId)].slice(0,150);
    if(!['all','fav','recent'].includes(S.scope)&&!collection())S.scope='all';
    localStorage.setItem(KEY,JSON.stringify({...store,view:S}));
    baseStore=clone(store);
    if(before!==JSON.stringify(store))queueMicrotask(()=>{draw();if(current)viewerInfo();});
  }
  catch { if(!storageWarning) {storageWarning=true;toast('浏览器无法保存记录，请使用“导出个人资料”备份。');} }
}
function favourite(d) { return store.favPoses.includes(d.pose)||store.favImages.includes(d.id); }
function collection() { return store.collections.find(c=>c.id===S.scope); }
function compute() {
  if(S.cat&&!DATA.some(d=>(!S.line||d.line===S.line)&&d.cat===S.cat))S.cat='';
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
  const collectionsMarkup=store.collections.map(c=>`<button class="nav-item" data-scope="${esc(c.id)}">${esc(c.name)}<span>${c.items.length}</span></button>`).join('')+`<button class="nav-item mobile-collection" data-new>＋ 新建集合</button>`;
  if(collectionsMarkup!==cachedCollections){$('#collections').innerHTML=collectionsMarkup;cachedCollections=collectionsMarkup;}
  $$('#libraryNav [data-scope],#collections [data-scope]').forEach(b=>{const active=b.dataset.scope===S.scope;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(!seriesBuilt){
    $('#series').innerHTML=[['','全部系列'],...series.map(x=>[x,x])].map(([v,n])=>`<button class="nav-item" data-line="${esc(v)}">${esc(n)}<span>${v?GROUPS.filter(g=>g.line===v).length:GROUPS.length}</span></button>`).join('');
    $('#angle').innerHTML='<option value="">全部视角</option>'+ANGLES.map(a=>`<option>${a}</option>`).join('');seriesBuilt=true;
  }
  $$('#series [data-line]').forEach(b=>{const active=b.dataset.line===S.line;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  if(cachedCategoryLine!==S.line){
    const cats=[...new Set(DATA.filter(d=>!S.line||d.line===S.line).map(d=>d.cat))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    $('#category').innerHTML='<option value="">全部分类</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');cachedCategoryLine=S.line;
  }
  $('#category').value=S.cat;$('#angle').value=S.angle;
  $('#sort').value=S.sort;if(!composing&&document.activeElement!==$('#search'))$('#search').value=S.query;$('#density').value=S.density;$('#showJa').checked=S.ja;
  document.documentElement.dataset.theme=S.theme;document.documentElement.style.setProperty('--card-size',S.density+'px');document.body.classList.toggle('show-ja',S.ja);
  $$('#modes button').forEach(b=>{b.classList.toggle('active',b.dataset.mode===S.mode);b.setAttribute('aria-pressed',b.dataset.mode===S.mode);});
  const activeCollection=collection();
  const heading=activeCollection?['REFERENCE COLLECTION',activeCollection.name,'把相关动作与视角，放在一起参考。']:({all:['POSE REFERENCE','姿势参考','观察形体，寻找构图。'],fav:['YOUR FAVOURITES','我的收藏','收集值得反复观察的姿态。'],recent:['RECENTLY VIEWED','最近浏览','接着上一次的观察与构思。']}[S.scope]||['REFERENCE COLLECTION','参考集合','把相关动作与视角，放在一起参考。']);
  $('#pageKicker').textContent=heading[0];$('#pageTitle').textContent=heading[1];
  $('#pageSubtitle').textContent=ONLINE&&!HOSTED?'图片由原作者网站提供，浏览时需要联网。':heading[2];
  $('#collectionActions').hidden=!collection();$('#boardCount').textContent=store.board.length+' / 4';
}
function chips() {
  $('#activeFilters').innerHTML=[['line',S.line],['cat',S.cat],['angle',S.angle],['query',S.query]].filter(([,v])=>v).map(([k,v])=>`<button class="filter-chip" data-clear="${k}" aria-label="移除筛选 ${esc(v)}">${esc(v)}<span>×</span></button>`).join('');
}
function angleStrip(g,d) {
  return '<div class="angle-strip">'+ANGLES.map(a=>{const x=g.items.find(x=>x.angle===a);return x?`<button class="angle-mini ${x.id===d.id?'active':''}" data-open="${esc(x.id)}" aria-label="查看${a}"><img src="${esc(x.thumb)}" loading="lazy" decoding="async" alt=""><span>${a}</span></button>`:`<span class="angle-mini missing" title="源素材没有此视角">—</span>`;}).join('')+'</div>';
}
function selectionIds(value) {return groupMap.has(value)?(filteredGroups.find(e=>e.group.pose===value)?.items||[]).map(d=>d.id):[value];}
function card(d,grouped,items=[d]) {
  const g=groupMap.get(d.pose),ids=items.map(x=>x.id),checked=ids.every(id=>selected.has(id));
  const on=grouped?store.favPoses.includes(d.pose):store.favImages.includes(d.id);
  const partial=grouped?g.items.filter(x=>store.favImages.includes(x.id)).length:0;
  return `<article class="card" tabindex="0" role="button" aria-label="打开 ${esc(d.name)}，${esc(d.angle)}" data-id="${esc(d.id)}" data-pose="${esc(d.pose)}"><div class="card-image"><img src="${esc(d.thumb)}" loading="lazy" decoding="async" alt="${esc(d.name+' '+d.angle)}"><div class="card-top"><span class="card-number">${esc(d.num)} · ${esc(d.angle)}</span><input class="card-check" type="checkbox" data-select="${esc(grouped?d.pose:d.id)}" ${checked?'checked':''} aria-label="选择${grouped?'此组命中图片':'此图'}"></div><button class="fav-mark ${on?'on':''}" data-fav="${esc(grouped?d.pose:d.id)}" title="${grouped?'收藏整个姿势':'收藏此图'}" aria-label="${grouped?'收藏整个姿势':'收藏此图'}" aria-pressed="${on}">${on?'♥':'♡'}</button></div><div class="card-body"><h3>${esc(d.name)}</h3><div class="ja">${esc(d.ja)}</div><div class="card-detail"><span>${esc(d.cat)}</span><span>${grouped?g.items.length+' 个视角':esc(d.angle)}</span></div>${partial?`<span class="saved-detail">单图收藏 ${partial} 张</span>`:!grouped&&store.favPoses.includes(d.pose)?'<span class="saved-detail">所在姿势已收藏</span>':''}</div>${grouped?angleStrip(g,d):''}</article>`;
}
function compare(entry) {
  const g=entry.group;
  const angles=S.angle?[S.angle]:ANGLES;
  return `<section class="compare-group" data-pose="${esc(g.pose)}"><div class="compare-heading"><h3>${esc(g.num)} / ${esc(g.name)}</h3><div class="compare-select"><span class="muted">${esc(g.line)}</span><input type="checkbox" class="card-check" data-select="${esc(g.pose)}" ${entry.items.every(d=>selected.has(d.id))?'checked':''} aria-label="选择此组命中图片"></div></div><div class="compare-images">${angles.map(a=>{const d=g.items.find(d=>d.angle===a);return d?`<button class="compare-image" data-open="${esc(d.id)}" aria-label="打开${esc(g.name)}，${a}"><img src="${esc(d.thumb)}" alt="${esc(g.name+' '+a)}" loading="lazy" decoding="async"><span>${a}${favourite(d)?' ♥':''}</span></button>`:`<div class="compare-image missing">${a} · 未提供</div>`;}).join('')}</div></section>`;
}
function selectionUi() {$('#selectionBar').hidden=!selected.size;$('#selectionCount').textContent='已选 '+selected.size+' 张图片';}
function draw(recompute=true) {
  if(recompute)compute();nav();chips();selectionUi();
  $('#grid').className='grid '+S.mode+(S.angle?' filtered':'');
  const visible=results.slice(0,S.shown);
  $('#grid').innerHTML=visible.map(e=>S.mode==='single'?card(e,false):S.mode==='compare'?compare(e):card(e.items[0],true,e.items)).join('')||'<div class="empty"><p>NO MATCHES</p><h2>还没有符合条件的图片</h2><p>试试减少筛选条件，或将图片加入收藏与集合。</p><button class="btn" data-reset>清除筛选</button></div>';
  $$('#grid [data-select]').forEach(b=>{const ids=selectionIds(b.dataset.select);b.indeterminate=ids.some(id=>selected.has(id))&&!ids.every(id=>selected.has(id));});
  const contextCount=S.mode==='compare'?filteredGroups.reduce((n,e)=>n+(S.angle?e.group.items.filter(d=>d.angle===S.angle).length:e.group.items.length),0):matches.length;
  $('#resultCount').textContent=`${filteredGroups.length} 个姿势 · ${matches.length.toLocaleString()} 张图片`+(contextCount!==matches.length?` · 完整对照 ${contextCount} 张`:'');
  $('#shownCount').textContent=`已显示 ${Math.min(S.shown,results.length)} / ${results.length} ${S.mode==='single'?'张':'组'}`;
  $('#loadMore').hidden=S.shown>=results.length;$('#endLabel').hidden=S.shown<results.length||!results.length;
  $('#loadMore').textContent=`继续浏览 · 还有 ${Math.max(0,results.length-S.shown)} ${S.mode==='single'?'张':'组'}`;
}
function update(patch,{reset=true}={}) {
  clearTimeout(searchTimer);
  if(!Object.hasOwn(patch,'query')&&!composing)patch={query:$('#search').value,...patch};
  const wasDeep=window.scrollY>$('.result-toolbar').offsetTop;
  Object.assign(S,patch);
  if(reset){S.shown=batch();selected.clear();}
  if(!composing)$('#search').value=S.query;
  draw();
  if(reset&&wasDeep)window.scrollTo(0,Math.max(0,$('.result-toolbar').offsetTop-$('.controls').offsetHeight));
  S.scroll=window.scrollY;save();
}
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
// Explicitly close local dialogs; never submit a network form. Making cancel
// a non-submit button also ensures Enter in a name field confirms the action.
$('#dialogForm').addEventListener('submit',event=>{event.preventDefault();$('#smallDialog').close('ok');});
$('#dialogCancel').onclick=()=>$('#smallDialog').close('cancel');
async function newCollection(items=[]) {
  if(store.collections.length>=1000){toast('最多支持 1000 个集合，请先整理已有集合');return null;}
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
  $('#viewerPosition').textContent=(viewerGroups.findIndex(e=>e.group.pose===d.pose)+1)+' / '+viewerGroups.length+' 姿势';
  $('#viewerAngles').innerHTML=ANGLES.map(a=>{const x=g.items.find(x=>x.angle===a);return x?`<button class="angle-mini ${x.id===d.id?'active':''}" data-open="${esc(x.id)}" aria-label="切换${a}"><img src="${esc(x.thumb)}" alt=""><span>${a}</span></button>`:'<span class="angle-mini missing">—</span>';}).join('');
  const prompt = PROMPTS[d.pose] || '';
  $('#posePrompt').textContent = prompt || '该姿势暂无提示词';
  $('#copyPrompt').disabled = !prompt;
  $('#viewerMeta').innerHTML=[['系列',d.line],['分类',d.cat],['视角',d.angle],['文件',d.full],['编号',d.id]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  for(const [id,on,label] of [['favPose',store.favPoses.includes(d.pose),'姿势'],['favImage',store.favImages.includes(d.id),'此图']]){const b=$('#'+id);b.textContent=(on?'♥ 已收藏':'♡ 收藏')+label;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);}
  const pin=store.board.includes(d.id);$('#pinImage').textContent=pin?'移出参考台':'放入参考台';$('#pinImage').classList.toggle('on',pin);
  $('#downloadImage').href=d.full;$('#downloadImage').download=d.full.split('/').pop();if(document.activeElement!==$('#poseNote'))$('#poseNote').value=store.notes[d.pose]||'';
  if(ONLINE&&!HOSTED){$('#downloadImage').removeAttribute('download');$('#downloadImage').target='_blank';$('#downloadImage').rel='noopener noreferrer';$('#downloadImage').textContent='打开原作者原图 ↗';}
  $('#prevPose').disabled=viewerGroups.findIndex(e=>e.group.pose===d.pose)<=0;$('#nextPose').disabled=viewerGroups.findIndex(e=>e.group.pose===d.pose)>=viewerGroups.length-1;
}
function transform() {
  const img=$('#fullImage'),ratio=img.naturalWidth/Math.max(1,img.naturalHeight);
  const width=Math.min(img.clientWidth,img.clientHeight*ratio),height=Math.min(img.clientHeight,img.clientWidth/Math.max(.001,ratio));
  const maxX=Math.max(0,(width*zoom-img.clientWidth)/2),maxY=Math.max(0,(height*zoom-img.clientHeight)/2);
  pan.x=Math.max(-maxX,Math.min(maxX,pan.x));pan.y=Math.max(-maxY,Math.min(maxY,pan.y));
  $('#fullImage').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${mirror?-zoom:zoom},${zoom})`;
  $('#stage').classList.toggle('zoomed',zoom>1);$('#fitImage').textContent=zoom===1?'适应窗口':Math.round(zoom*100)+'% · 复位';$('#mirrorImage').setAttribute('aria-pressed',mirror);
}
function fit() {zoom=1;pan={x:0,y:0};transform();}
function setZoom(z){const img=$('#fullImage'),max=Math.max(5,img.naturalWidth/Math.max(1,img.clientWidth),img.naturalHeight/Math.max(1,img.clientHeight));zoom=Math.max(1,Math.min(max,z));if(zoom===1)pan={x:0,y:0};transform();}
function imageMime(filename){return filename.endsWith('.webp')?'image/webp':/\.jpe?g$/i.test(filename)?'image/jpeg':'image/png';}
function openImage(id) {
  const d=byId.get(id);if(!d)return;
  if(!$('#viewer').open){returnFocus={element:document.activeElement,pose:d.pose,id:d.id};viewerGroups=filteredGroups.map(e=>({group:e.group,items:[...e.items]}));$('#viewer').showModal();document.body.style.overflow='hidden';}
  points.clear();gesture=null;$('#stage').classList.remove('dragging');
  current=d;fit();mirror=false;transform();viewerInfo();
  store.recent=[d.id,...store.recent.filter(x=>x!==d.id)].slice(0,150);save(d.id);
  const token=++loadToken,img=$('#fullImage');img.src=d.thumb;img.alt=d.name+' '+d.angle;$('#imageStatus').textContent='正在读取原图…';
  const full=new Image();full.onload=()=>{if(token!==loadToken)return;img.src=d.full;$('#imageStatus').textContent='';};full.onerror=()=>{if(token===loadToken)$('#imageStatus').textContent=ONLINE?'原图读取失败，当前显示缩略图。可使用原图按钮重试。':'原图读取失败，当前显示缩略图。请检查本机图片是否完整。';};full.src=d.full;
}
function closeViewer(){if($('#viewer').open)$('#viewer').close();}
$('#viewer').addEventListener('close',()=>{
  loadToken++;current=null;imageExporting=false;points.clear();gesture=null;document.body.style.overflow='';draw();
  const focus=returnFocus?.element?.isConnected?returnFocus.element:
    $$('#grid [data-id]').find(e=>e.dataset.id===returnFocus?.id)||
    $$('#grid [data-pose]').find(e=>e.dataset.pose===returnFocus?.pose)||$('#grid .card,#grid [data-open]')||$('#search');
  (focus.matches('section')?focus.querySelector('[data-open]'):focus)?.focus({preventScroll:true});save();
});
function stepAngle(n){if(!current)return;const a=groupMap.get(current.pose).items;openImage(a[(a.findIndex(x=>x.id===current.id)+n+a.length)%a.length].id);}
function stepPose(n){if(!current)return;const i=viewerGroups.findIndex(e=>e.group.pose===current.pose),next=viewerGroups[i+n];if(next)openImage((next.group.items.find(d=>d.angle===current.angle)||next.items[0]).id);}
function pin(id){const i=store.board.indexOf(id);if(i>=0)store.board.splice(i,1);else if(store.board.length<4)store.board.push(id);else{toast('参考台最多 4 张，请先移除一张');return;}save();nav();if(current)viewerInfo();}
function drawBoard(){ $('#boardGrid').innerHTML=store.board.map(id=>{const d=byId.get(id);return `<section class="board-card"><div><img src="${esc(d.full)}" alt="${esc(d.name+' '+d.angle)}"></div><header><span>${esc(d.num+' '+d.name+' / '+d.angle)}</span><div><button class="text-btn" data-board-mirror="${id}">镜像</button> <button class="text-btn" data-board-remove="${id}">移除</button></div></header></section>`;}).join('')||'<div class="board-empty">在大图预览中点击“放入参考台”，并排比较最多 4 张图片。</div>'; }
$('#libraryNav').onclick=e=>{const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#collections').onclick=e=>{if(e.target.closest('[data-new]')){newCollection();return;}const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#series').onclick=e=>{const b=e.target.closest('[data-line]');if(b)update({line:b.dataset.line,cat:''});};
function scheduleSearch(e){clearTimeout(searchTimer);if(composing||e?.isComposing)return;const query=$('#search').value;searchTimer=setTimeout(()=>update({query}),140);}
$('#search').oninput=scheduleSearch;
$('#search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
$('#search').addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
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
$('#grid').onchange=e=>{const b=e.target.closest('[data-select]');if(!b)return;for(const id of selectionIds(b.dataset.select))b.checked?selected.add(id):selected.delete(id);b.indeterminate=false;selectionUi();};
$('#grid').onkeydown=e=>{if(e.target.matches('.card')&&['Enter',' '].includes(e.key)){e.preventDefault();openImage(e.target.dataset.id);}};
$('#grid').onpointerover=e=>{if(e.pointerType==='touch')return;const b=e.target.closest('.angle-mini[data-open]'),card=b?.closest('.card');if(!card)return;const d=byId.get(b.dataset.open);card.dataset.id=d.id;const img=card.querySelector('.card-image>img');img.src=d.thumb;img.alt=d.name+' '+d.angle;card.setAttribute('aria-label','打开 '+d.name+'，'+d.angle);card.querySelector('.card-number').textContent=d.num+' · '+d.angle;card.querySelectorAll('.angle-mini').forEach(x=>x.classList.toggle('active',x===b));};
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
    if(file.size>64*1024*1024)throw new Error('备份超过 64 MB');const raw=JSON.parse(await file.text());if(!raw||raw.format!=='pose-index-backup'||raw.version!==2)throw new Error('不是此图库支持的备份文件');
    if(Array.isArray(raw.collections)&&raw.collections.length>1000)throw new Error('备份包含超过 1000 个集合，请先拆分后导入');const incoming=sanitize(raw);
    if(new Set([...store.collections,...incoming.collections].map(c=>c.id)).size>1000)throw new Error('合并后超过 1000 个集合，请先整理后再导入');
    if(!await promptDialog('合并个人资料',`<p>将合并 ${incoming.favImages.length} 个单图收藏、${incoming.favPoses.length} 个姿势收藏、${incoming.collections.length} 个集合。已有收藏保留；同一姿势的已有备注优先保留。</p>`,'合并'))return;
    store.favImages=[...new Set([...store.favImages,...incoming.favImages])];store.favPoses=[...new Set([...store.favPoses,...incoming.favPoses])];
    for(const c of incoming.collections){const old=store.collections.find(x=>x.id===c.id);if(old)old.items=[...new Set([...old.items,...c.items])];else store.collections.push(c);}
    store.notes={...incoming.notes,...store.notes};store.recent=[...new Set([...store.recent,...incoming.recent])].slice(0,150);store.board=[...new Set([...store.board,...incoming.board])].slice(0,4);save();draw();toast('资料已合并');
  }catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}
};
$('#closeViewer').onclick=closeViewer;$('#copyPrompt').onclick=async()=>{const prompt=PROMPTS[current&&current.pose];if(!prompt)return;try{await navigator.clipboard.writeText(prompt);toast('已复制姿态提示词');}catch{await promptDialog('姿态提示词','<p>浏览器未允许直接复制，可在下面全选后复制。</p><textarea id="dialogValue" aria-label="姿态提示词" rows="6" readonly>'+esc(prompt)+'</textarea>','关闭');}};$('#viewerAngles').onclick=e=>{const b=e.target.closest('[data-open]');if(b)openImage(b.dataset.open);};
$('#prevAngle').onclick=()=>stepAngle(-1);$('#nextAngle').onclick=()=>stepAngle(1);$('#prevPose').onclick=()=>stepPose(-1);$('#nextPose').onclick=()=>stepPose(1);
$('#zoomIn').onclick=()=>setZoom(zoom*1.35);$('#zoomOut').onclick=()=>setZoom(zoom/1.35);$('#fitImage').onclick=fit;$('#mirrorImage').onclick=()=>{mirror=!mirror;transform();};
$('#favPose').onclick=()=>current&&toggleFav(current.pose);$('#favImage').onclick=()=>current&&toggleFav(current.id);$('#pinImage').onclick=()=>current&&pin(current.id);$('#addCollection').onclick=()=>current&&addToCollection([current.id]);
$('#poseNote').oninput=e=>{if(!current)return;store.notes[current.pose]=e.target.value;save();};
$('#boardBtn').onclick=()=>{drawBoard();$('#boardDialog').showModal();};$('#closeBoard').onclick=()=>$('#boardDialog').close();$('#clearBoard').onclick=()=>{store.board=[];save();nav();drawBoard();};
$('#boardGrid').onclick=e=>{const remove=e.target.closest('[data-board-remove]');if(remove){pin(remove.dataset.boardRemove);drawBoard();return;}if(e.target.closest('[data-board-mirror]'))e.target.closest('.board-card').firstElementChild.classList.toggle('mirror');};
$('#stage').addEventListener('wheel',e=>{if(e.target.closest('button'))return;e.preventDefault();setZoom(zoom*(e.deltaY>0?0.88:1.14));},{passive:false});
const points=new Map();let gesture=null;
$('#stage').addEventListener('pointerdown',e=>{
  if(e.target.closest('button'))return;
  // Mouse image export belongs to the browser. Touch keeps swipe/pinch;
  // zoomed mouse gestures pan unless Alt explicitly requests image export.
  if(e.pointerType!=='touch'&&e.target===$('#fullImage')&&(zoom===1||e.altKey))return;
  if(e.pointerType!=='touch')e.preventDefault();
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#stage').setPointerCapture(e.pointerId);
  if(points.size===1)gesture={x:e.clientX,y:e.clientY,pan:{...pan}};
  if(points.size===2){const p=[...points.values()];gesture={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom};}
  $('#stage').classList.add('dragging');
});
$('#fullImage').addEventListener('dragstart',event=>{
  if(!current||zoom>1&&!event.altKey){event.preventDefault();return;}
  const image=$('#fullImage'),url=new URL(current.full,document.baseURI).href;
  if(image.src!==url||!image.complete||!image.naturalWidth){event.preventDefault();toast('原图尚未就绪，请等加载完成后拖出，或使用原图按钮');return;}
  const filename=current.full.split('/').pop();
  const mime=imageMime(filename);
  // Preserve native bitmap/file formats and add full-resolution URL formats
  // used by desktop file managers, drawing programs and other drop targets.
  event.dataTransfer.effectAllowed='copy';
  imageExporting=true;
  event.dataTransfer.setData('text/uri-list',url);
  event.dataTransfer.setData('text/plain',url);
  event.dataTransfer.setData('text/html',`<img src="${esc(url)}" alt="${esc(current.name)}">`);
  event.dataTransfer.setData('DownloadURL',`${mime}:${filename}:${url}`);
});
$('#fullImage').addEventListener('dragend',()=>{imageExporting=false;points.clear();gesture=null;$('#stage').classList.remove('dragging');});
// Dropping our own exported image back onto the viewer should not navigate
// away. External drop targets still receive the normal file payload.
$('#viewer').addEventListener('dragover',event=>{if(imageExporting)event.preventDefault();});
$('#viewer').addEventListener('drop',event=>{if(imageExporting)event.preventDefault();});
$('#stage').addEventListener('pointermove',e=>{if(!points.has(e.pointerId)||!gesture)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2&&gesture.distance){const p=[...points.values()];setZoom(gesture.zoom*Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)/gesture.distance);}else if(points.size===1&&gesture.pan&&zoom>1){const rect=$('#stage').getBoundingClientRect();pan={x:Math.max(-rect.width*zoom/2,Math.min(rect.width*zoom/2,gesture.pan.x+e.clientX-gesture.x)),y:Math.max(-rect.height*zoom/2,Math.min(rect.height*zoom/2,gesture.pan.y+e.clientY-gesture.y))};transform();}});
function pointerEnd(e){const start=gesture;points.delete(e.pointerId);if(!points.size){$('#stage').classList.remove('dragging');if(e.type==='pointerup'&&start?.pan&&zoom===1&&e.pointerType==='touch'&&Math.abs(e.clientX-start.x)>60&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.5)stepAngle(e.clientX<start.x?1:-1);gesture=null;}else{const p=[...points.values()][0];gesture={x:p.x,y:p.y,pan:{...pan}};}}
$('#stage').addEventListener('pointerup',pointerEnd);$('#stage').addEventListener('pointercancel',pointerEnd);
$('#helpBtn').onclick=()=>promptDialog('使用姿态索引','<p>搜索支持空格分隔的多个关键词，例如“坐姿 侧面”，并包含一组常用动作同义词。</p><p>点开图片：右侧会显示该姿势的纯姿态英文提示词，点“复制提示词”即可拿去生图；内容只写身体动作，不含场景、服装或视角词。默认完整显示，滚轮或双指缩放，放大后拖动。未放大时可直接将原图拖到其他位置；放大后按 Alt 拖出原图。← → 换角度，↑ ↓ 换姿势，F 收藏姿势。</p><p>如果接收程序不支持图片拖放，请使用“保存原图”后上传。直接双击 HTML 时，网页上传区可能只收到图片地址；可通过“打开图库.cmd”启动本地服务后再拖出，全程无需联网。</p><p>卡片勾选会选择当前筛选命中的图片。整组收藏与单图收藏是独立开关。参考台可固定 4 张图。</p><p>导出个人资料可备份收藏、集合和备注。在线网站、直接打开文件和本地服务分别保存记录，换入口前请先导出迁移。</p><div class="help-actions"><button type="button" class="btn" id="helpBackup">导出个人资料</button> <label class="btn">导入资料<input type="file" id="helpImport" accept=".json" hidden></label></div><p>素材原作者：ギア。使用范围以顶部“素材原站”中的说明为准，代码开源许可不覆盖原素材。</p>','关闭').then(()=>{});
$('#dialogBody').addEventListener('click',e=>{if(e.target.id==='helpBackup')$('#backupBtn').click();});
$('#dialogBody').addEventListener('change',async e=>{
  if(e.target.id!=='helpImport'||!e.target.files.length)return;
  const dt=new DataTransfer();for(const file of e.target.files)dt.items.add(file);
  const dialog=$('#smallDialog');
  const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
  dialog.close();await closed;
  $('#importInput').files=dt.files;$('#importInput').dispatchEvent(new Event('change'));
});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select,[contenteditable=true]'))return;
  if($('#smallDialog').open||$('#boardDialog').open)return;
  if($('#viewer').open){if(e.key===' '&&e.target.closest('button,a,summary'))return;const actions={ArrowLeft:()=>stepAngle(-1),ArrowRight:()=>stepAngle(1),ArrowUp:()=>stepPose(-1),ArrowDown:()=>stepPose(1),f:()=>toggleFav(current.pose),F:()=>toggleFav(current.pose),' ':()=>{if(zoom!==1){fit();return;}const img=$('#fullImage'),z=Math.max(img.naturalWidth/img.clientWidth,img.naturalHeight/img.clientHeight);setZoom(z);}};if(actions[e.key]){e.preventDefault();actions[e.key]();}return;}
  if(e.key==='/'){e.preventDefault();$('#search').focus();}
});
let scrollTimer;window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{S.scroll=window.scrollY;save();},180);},{passive:true});
window.addEventListener('pagehide',()=>{S.scroll=window.scrollY;save();});
window.addEventListener('storage',event=>{
  if(event.key!==KEY&&event.key!==null)return;
  const next=sanitize(read(KEY));
  if(JSON.stringify(next)===JSON.stringify(baseStore))return;
  store=mergeStore(baseStore,store,next);baseStore=clone(store);
  if(!['all','fav','recent'].includes(S.scope)&&!collection())S.scope='all';
  draw();if(current)viewerInfo();
});
window.addEventListener('resize',()=>{if(current)transform();});
const initialScroll=S.scroll;draw();save();requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,initialScroll)));
})();
