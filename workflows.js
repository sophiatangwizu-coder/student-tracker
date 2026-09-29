'use strict';

// Browsing state is separate from the student filters inside a single activity.
let activityDetail = false;
const activityBrowsers = {};
function activityBrowser() {
  return activityBrowsers[view] ||= {query:'',from:'',to:'',status:'',order:'newest',page:1};
}
function activityCounts(a,rows=data.records.filter(r=>r.activityId===a.id)) {
  if(a.kind==='dict')return {primary:rows.filter(r=>r.status==='f'&&r.retake!=='passed').length,secondary:rows.filter(r=>T.dictParticipated(r)&&r.correction!=='correct').length};
  if(a.kind==='hw')return {primary:rows.filter(r=>r.status==='missing'&&!r.submitted).length,secondary:rows.filter(r=>T.homeworkState(r)==='revision_pending').length};
  return {primary:rows.filter(r=>r.status==='blank').length,secondary:rows.filter(r=>r.status==='score').length};
}
function activityListView() {
  const state=activityBrowser(),all=data.activities.filter(a=>a.kind===view&&(!classId||a.classId===classId));
  const recordsByActivity=new Map();data.records.forEach(r=>{if(!recordsByActivity.has(r.activityId))recordsByActivity.set(r.activityId,[]);recordsByActivity.get(r.activityId).push(r);});
  let matches=all.map(a=>({a,counts:activityCounts(a,recordsByActivity.get(a.id)||[])})).filter(({a,counts})=>
    (!state.query||a.name.toLowerCase().includes(state.query.toLowerCase()))&&
    (!state.from||a.date>=state.from)&&(!state.to||a.date<=state.to)&&
    (!state.status||(state.status==='attention'?(counts.primary+(a.kind==='quiz'?0:counts.secondary)>0):(counts.primary+(a.kind==='quiz'?0:counts.secondary)===0))));
  matches.sort((x,y)=>state.order==='oldest'?T.order(x.a,y.a):state.order==='name'?x.a.name.localeCompare(y.a.name,'zh')||-T.order(x.a,y.a):-T.order(x.a,y.a));
  const pageSize=20,pages=Math.max(1,Math.ceil(matches.length/pageSize));state.page=Math.min(state.page,pages);
  const page=matches.slice((state.page-1)*pageSize,state.page*pageSize);
  const statusLabel=view==='quiz'?'有待录入成绩':view==='hw'?'有未完成或待改':'有重默或订正待处理';
  return heading(`${labels[view]}记录`, '先找到一场记录，再查看和登记学生情况。',btn(`＋ 新建${labels[view]}`,'activity-new',`data-kind="${view}"`,'primary')+(view==='quiz'?btn('成绩分析','analysis-open') : ''))+
    `<section class="panel activity-library"><div class="toolbar"><input type="search" id="activity-search" aria-label="搜索场次名称" placeholder="搜索${labels[view]}名称…" value="${esc(state.query)}"><select id="activity-list-class" aria-label="筛选场次班级">${classOptions(classId)}</select><select id="activity-list-status" aria-label="筛选场次进度">${option('','全部进度',state.status)}${option('attention',statusLabel,state.status)}${option('done',view==='quiz'?'成绩已录齐':'无待处理事项',state.status)}</select><select id="activity-list-order" aria-label="场次排序">${option('newest','日期从新到旧',state.order)}${option('oldest','日期从旧到新',state.order)}${option('name','名称排序',state.order)}</select></div>
    <div class="toolbar"><span class="range-label">日期范围</span><input type="date" id="activity-list-from" aria-label="场次开始日期" value="${state.from}"><span class="muted">至</span><input type="date" id="activity-list-to" aria-label="场次结束日期" value="${state.to}">${btn('清除筛选','activity-list-reset','','small')}<span class="spacer"></span><span class="count">筛选 ${matches.length} 场 · 当前班级范围共 ${all.length} 场</span></div>
    ${page.length?`<div class="table-wrap"><table class="activity-list-table"><thead><tr><th>名称</th><th>日期</th><th>班级</th><th>人数</th><th>进度</th><th></th></tr></thead><tbody>${page.map(({a,counts})=>`<tr><td><button class="link activity-title" data-action="open-activity" data-id="${a.id}" data-from-list="true">${esc(a.name)}</button>${a.kind==='quiz'?`<div class="help">满分 ${a.total}</div>`:''}</td><td>${a.date}</td><td>${esc(className(a.classId))}</td><td>${a.studentIds.length} 人</td><td><div class="row">${a.kind==='dict'?`<span class="badge ${counts.primary?'red':'green'}">待重默 ${counts.primary}</span><span class="badge ${counts.secondary?'amber':''}">订正待处理 ${counts.secondary}</span>`:a.kind==='hw'?`<span class="badge ${counts.primary?'red':'green'}">未完成 ${counts.primary}</span><span class="badge ${counts.secondary?'amber':''}">待改 ${counts.secondary}</span>`:`<span class="badge green">已录入 ${counts.secondary}</span><span class="badge ${counts.primary?'amber':''}">待录入 ${counts.primary}</span>`}</div></td><td>${btn('进入详情 →','open-activity',`data-id="${a.id}" data-from-list="true"`,'small')}</td></tr>`).join('')}</tbody></table></div><div class="row spread list-pagination"><span class="help">每页 ${pageSize} 场</span><div class="row">${btn('上一页','activity-page',`data-page="${state.page-1}" ${state.page===1?'disabled':''}`,'small')}<span class="help">${state.page} / ${pages}</span>${btn('下一页','activity-page',`data-page="${state.page+1}" ${state.page===pages?'disabled':''}`,'small')}</div></div>`:empty(all.length?'没有符合条件的记录':`还没有${labels[view]}记录`,all.length?'调整班级、日期或名称筛选后再试试。':'创建后，当前班级的在读学生会自动加入。',all.length?btn('清除筛选','activity-list-reset'):btn('开始记录','activity-new',`data-kind="${view}"`,'primary'))}</section>`;
}
function changeActivityListFilter(el) {
  const state=activityBrowser(),fields={'activity-list-from':'from','activity-list-to':'to','activity-list-status':'status','activity-list-order':'order'};
  if(el.id==='activity-list-class'){classId=el.value;state.page=1;render();return true;}
  if(!fields[el.id])return false;
  const key=fields[el.id],next={...state,[key]:el.value};
  if(next.from&&next.to&&next.from>next.to){el.value=state[key];throw Error('开始日期不能晚于结束日期');}
  state[key]=el.value;state.page=1;render();return true;
}

const copyLabels={failed:'首次默写未通过',retake:'待重默',correction:'本次订正待处理',unsubmitted:'作业未完成',revision_pending:'作业待改',revised:'作业已改',bottom5:'小测班级最后 5 名',filtered:'当前筛选名单'};
function copyTools(a) {
  const choices=a.kind==='dict'?[['failed','复制未通过'],['retake','复制待重默'],['correction','复制订正待处理']]:a.kind==='hw'?[['unsubmitted','复制未完成'],['revision_pending','复制待改'],['revised','复制已改']]:[['bottom5','复制班级最后 5 名']];
  return `<div class="copy-toolbar"><span class="help">一键复制名单</span>${choices.map(([type,label])=>btn(label,'copy-list',`data-id="${a.id}" data-type="${type}"`,'small')).join('')}${btn('复制当前筛选','copy-list',`data-id="${a.id}" data-type="filtered"`,'small')}<span class="help">${a.kind==='quiz'?'最后 5 名按本场全班有效成绩选取；同分按学号、姓名取足 5 人，不足则复制全部。':'快捷名单按本场全班记录生成；“当前筛选”按表格显示结果生成。'}</span></div>`;
}
async function copyActivityList(a,type) {
  const rows=type==='filtered'?recordRows(a).map(x=>x.r):T.copyListRecords(data,a,type);
  if(!rows.length){toast('没有符合条件的学生，未修改剪贴板');return;}
  const label=type==='bottom5'?`小测班级最后 ${rows.length} 名`:copyLabels[type];
  const names=T.copyStudentNames(data,a,rows);
  const text=`${className(a.classId)} · ${a.date} · ${a.name}\n${label}（${rows.length} 人）：\n${names.join('、')}`;
  await copyText(text,`已复制 ${rows.length} 位学生名单`);
}
async function copyText(text,message='已复制名单') {
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);toast(message);return;}}catch(_){/* Local files and restricted browsers may need a fallback. */}
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;left:-9999px;top:0';
  ($('#modal').open?$('#modal'):document.body).append(area);area.select();let copied=false;
  try{copied=document.execCommand('copy');}catch(_){}finally{area.remove();}
  if(copied){toast(message);return;}
  modal('名单已准备好',`<p class="help">浏览器未允许自动复制。下方文字已选中，请按 ⌘C（Mac）或 Ctrl+C（Windows）复制。</p><textarea id="copy-fallback" class="copy-fallback" readonly aria-label="待复制名单">${esc(text)}</textarea><div class="dialog-actions">${btn('关闭','close')}</div>`);
  $('#copy-fallback').focus();$('#copy-fallback').select();
}
