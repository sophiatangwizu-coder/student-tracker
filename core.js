/* Domain logic shared by the offline interface and regression tests. */
(function (root) {
  const empty = () => ({version:1,settings:{appName:'紫笺'},classes:[],students:[],activities:[],records:[],images:[]});
  const sectionNames = ['听力短对话','听力篇章','听力长对话','语法填空','小猫钓鱼','完形填空','阅读A','阅读B','阅读C','六选四','翻译','小作文','大作文'];
  const dictParticipated = r => ['p','p-','f'].includes(r.status);
  const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const order = (a,b) => a.date.localeCompare(b.date) || a.created-b.created || a.id.localeCompare(b.id);
  const record = (d,a,s) => d.records.find(r=>r.activityId===a && r.studentId===s);
  const previous = (d,a) => d.activities.filter(x=>x.kind===a.kind && x.classId===a.classId && order(x,a)<0).sort(order).at(-1);
  const quizKey = a => a.quizGroupId||a.id;
  const quizGroup = (d,a) => d.activities.filter(x=>x.kind==='quiz'&&quizKey(x)===quizKey(a)).sort(order);
  function checkQuizJoin(d,a,target) {
    if(!target||target.kind!=='quiz')throw Error('找不到关联小测');
    const group=quizGroup(d,target).filter(x=>x.id!==a.id);
    if(group.some(x=>x.total!==a.total))throw Error('同一场跨班小测的总分必须一致，请勿关联不同试卷');
    checkSectionCompatibility([...group,a]);
    if(group.some(x=>x.classId===a.classId))throw Error('该班已有本场小测，请直接打开已有记录');
    const members=new Set(group.flatMap(x=>x.studentIds));
    if(a.studentIds.some(id=>members.has(id)))throw Error('同一学生已在其他班级参加本场小测，不能重复计算');
  }
  function linkQuiz(d,activityId,targetId) {
    const a=d.activities.find(x=>x.id===activityId&&x.kind==='quiz');if(!a)throw Error('找不到当前小测');
    if(!targetId){a.quizGroupId=uid();return a;}
    const target=d.activities.find(x=>x.id===targetId);checkQuizJoin(d,a,target);a.quizGroupId=quizKey(target);return a;
  }
  function quizStats(d,a) {
    const group=quizGroup(d,a),ids=new Set(group.map(x=>x.id)),students=new Map(d.students.map(s=>[s.id,s]));
    const records=d.records.filter(r=>ids.has(r.activityId)),valid=records.filter(r=>r.status==='score'&&Number.isFinite(r.score));
    const own=valid.filter(r=>r.activityId===a.id),male=own.filter(r=>students.get(r.studentId)?.gender==='male'),female=own.filter(r=>students.get(r.studentId)?.gender==='female');
    const average=rows=>rows.length?rows.reduce((sum,r)=>sum+r.score,0)/rows.length:null;
    const ranks=rows=>{const result=new Map();let previousScore=null,rank=0;[...rows].sort((x,y)=>y.score-x.score).forEach((r,i)=>{if(i===0||r.score!==previousScore)rank=i+1;previousScore=r.score;result.set(r.studentId,rank);});return result;};
    return {classAverage:average(own),gradeAverage:average(valid),maleAverage:average(male),femaleAverage:average(female),classCount:own.length,gradeCount:valid.length,maleCount:male.length,femaleCount:female.length,unknownCount:own.length-male.length-female.length,classExpected:a.studentIds.length,gradeExpected:records.length,classBlank:records.filter(r=>r.activityId===a.id&&r.status==='blank').length,gradeBlank:records.filter(r=>r.status==='blank').length,classAbsent:records.filter(r=>r.activityId===a.id&&r.status==='absent').length,gradeAbsent:records.filter(r=>r.status==='absent').length,classRanks:ranks(own),gradeRanks:ranks(valid),group};
  }
  function createActivity(d, input) {
    if(!d.classes.some(c=>c.id===input.classId)) throw Error('请选择班级');
    if(!input.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw Error('请填写名称与日期');
    if(input.kind==='quiz' && !(Number(input.total)>0 && Number.isFinite(Number(input.total)))) throw Error('总分必须大于 0');
    const studentIds=d.students.filter(s=>s.classId===input.classId && s.active).map(s=>s.id);
    if(!studentIds.length) throw Error('该班还没有在读学生，请先添加名单');
    const a={...input,name:input.name.trim(),id:uid(),created:Date.now(),studentIds,total:input.kind==='quiz'?Number(input.total):null};
    if(a.kind==='quiz'){
      validateSections(a.sections===undefined?{}:a.sections);
      if(input.joinQuizId){const target=d.activities.find(x=>x.id===input.joinQuizId);checkQuizJoin(d,a,target);a.quizGroupId=quizKey(target);}
      else a.quizGroupId=uid();
    }
    delete a.joinQuizId;
    d.activities.push(a);
    studentIds.forEach(studentId=>d.records.push({id:uid(),activityId:a.id,studentId,status:input.kind==='dict'?'p':input.kind==='hw'?'done':'blank',score:null,retake:'pending',retakeDate:'',correction:'correct',submitted:false,submitDate:'',note:''}));
    return a;
  }
  function entries(d, sid, kind, from='',to='') {
    return d.activities.filter(a=>(!kind||a.kind===kind) && (!from||a.date>=from) && (!to||a.date<=to)).sort(order).flatMap(a=>{const r=record(d,a.id,sid);return r?[{a,r}]:[];});
  }
  const rate = r => r.status==='score' && Number.isFinite(r.score)?r.score:null;
  const homeworkState = r => r.hwRevision==='pending'?'revision_pending':r.hwRevision==='done'?'revised':r.status;
  const homeworkComplete = r => (r.status==='done'||r.status==='missing'&&r.submitted)&&r.hwRevision!=='pending';
  function setHomeworkStatus(r,value,date) {
    if(!['done','missing','exempt','revision_pending','revised'].includes(value))throw Error('无效的作业状态');
    if(value==='revision_pending'||value==='revised'){
      if(r.status==='missing'){r.submitted=true;r.submitDate ||= date;}
      else {r.status='done';r.submitted=false;r.submitDate='';}
      r.hwRevision=value==='revision_pending'?'pending':'done';
      r.revisedDate=value==='revised'?(r.revisedDate||date):'';
    }else{
      r.status=value;r.hwRevision='none';r.revisedDate='';
      r.submitted=false;r.submitDate='';
    }
  }
  function summary(d,sid,from='',to='') {
    const es=entries(d,sid,null,from,to), ds=es.filter(x=>x.a.kind==='dict'&&dictParticipated(x.r)), hs=es.filter(x=>x.a.kind==='hw'&&x.r.status!=='exempt');
    const qs=es.filter(x=>x.a.kind==='quiz'&&rate(x.r)!==null).map(x=>({...x,value:x.r.score/x.a.total*100}));
    return {dict:ds.length?ds.reduce((sum,x)=>sum+({p:1,'p-':.5,f:0}[x.r.status]),0)/ds.length*100:null,dictCount:ds.length,hw:hs.length?hs.filter(x=>homeworkComplete(x.r)).length/hs.length*100:null,missing:hs.filter(x=>x.r.status==='missing').length,submitted:hs.filter(x=>x.r.status==='missing'&&x.r.submitted).length,hwPending:hs.filter(x=>x.r.hwRevision==='pending').length,hwRevised:hs.filter(x=>x.r.hwRevision==='done').length,quizzes:qs};
  }
  // Selection is a set of quiz group keys. Chronology uses the earliest class date.
  const groupDate = (d,a) => quizGroup(d,a)[0];
  function rankChange(d,a,r,selectedKeys=null,from='',to='') {
    if(rate(r)===null)return null;
    const g=quizGroup(d,a),scope=g.map(x=>x.classId).sort().join('|');
    if(g.length<2 || selectedKeys&&!selectedKeys.includes(quizKey(a)))return null;
    const anchor=groupDate(d,a);
    const candidates=entries(d,r.studentId,'quiz').filter(x=>{
      const ga=groupDate(d,x.a);
      return rate(x.r)!==null&&order(ga,anchor)<0&&(!from||ga.date>=from)&&(!to||ga.date<=to)&&(!selectedKeys||selectedKeys.includes(quizKey(x.a)))&&quizGroup(d,x.a).map(y=>y.classId).sort().join('|')===scope;
    }).sort((x,y)=>order(groupDate(d,x.a),groupDate(d,y.a)));
    const prev=candidates.at(-1);if(!prev)return null;
    const current=quizStats(d,a),before=quizStats(d,prev.a);
    return {value:before.gradeRanks.get(r.studentId)-current.gradeRanks.get(r.studentId),previous:prev.a,beforeRank:before.gradeRanks.get(r.studentId),rank:current.gradeRanks.get(r.studentId),beforeCount:before.gradeCount,count:current.gradeCount};
  }
  const delta = (d,a,r,selectedKeys=null,from='',to='') => rankChange(d,a,r,selectedKeys,from,to)?.value??null;
  function validateSections(sections) {
    if(!sections||typeof sections!=='object'||Array.isArray(sections))throw Error('题型分项配置无效');
    for(const [name,max] of Object.entries(sections))if(!sectionNames.includes(name)||!Number.isFinite(max)||max<=0)throw Error('分项满分须为大于 0 的数字');
  }
  function checkSectionCompatibility(group) {
    const maxima={};
    for(const a of group){validateSections(a.sections===undefined?{}:a.sections);for(const [name,max] of Object.entries(a.sections||{})){if(maxima[name]!==undefined&&maxima[name]!==max)throw Error(`${name}的分项满分与关联班级不一致`);maxima[name]=max;}}
  }
  function setSections(d,a,sections) {
    validateSections(sections);
    checkSectionCompatibility(quizGroup(d,a).map(x=>x.id===a.id?{...x,sections}:x));
    for(const r of d.records.filter(r=>r.activityId===a.id))for(const [name,value] of Object.entries(r.sectionScores||{}))if(value!==null&&(!Object.hasOwn(sections,name)||value>sections[name]))throw Error(`${name}已有成绩，不能移除或将满分改得低于已有得分`);
    a.sections={...sections};
  }
  function contentScore(a,r,content='total') {
    if(!r||r.status==='absent')return null;
    if(content==='total')return rate(r);
    return Object.hasOwn(a.sections||{},content)&&Number.isFinite(r.sectionScores?.[content])?r.sectionScores[content]:null;
  }
  const contentMax=(a,content='total')=>content==='total'?a.total:a.sections?.[content]??null;
  function contentStats(d,a,content='total') {
    const group=quizGroup(d,a),rows=group.flatMap(act=>act.studentIds.map(id=>({a:act,r:record(d,act.id,id)})));
    const all=rows.map(x=>({...x,value:contentScore(x.a,x.r,content)})),valid=all.filter(x=>x.value!==null),own=valid.filter(x=>x.a.id===a.id);
    const mean=xs=>xs.length?xs.reduce((n,x)=>n+x.value,0)/xs.length:null;
    return {classAverage:mean(own),gradeAverage:mean(valid),classCount:own.length,gradeCount:valid.length,classBlank:all.filter(x=>x.a.id===a.id&&x.r.status!=='absent'&&x.value===null).length,gradeBlank:all.filter(x=>x.r.status!=='absent'&&x.value===null).length,total:contentMax(a,content),gradeTotal:group.map(x=>contentMax(x,content)).find(x=>x!==null)??null,group};
  }
  function scorePatch(a,r,row) {
    const patch={},scores={},raw=String(row['成绩']??'').trim();
    if(raw==='缺考'){patch.status='absent';patch.score=null;}
    else if(raw!==''){const n=Number(raw);if(!Number.isFinite(n)||n<0||n>a.total)throw Error(`成绩须为 0 至 ${a.total}`);patch.score=n;patch.status='score';}
    for(const name of sectionNames){const v=String(row[name]??'').trim();if(!v)continue;
      if(!Object.hasOwn(a.sections||{},name))throw Error(`请先设置${name}的满分`);
      const n=Number(v);if(!Number.isFinite(n)||n<0||n>a.sections[name])throw Error(`${name}须为 0 至 ${a.sections[name]}`);scores[name]=n;
    }
    if(Object.keys(scores).length){if((patch.status||r.status)==='absent')throw Error('缺考学生不能录入分项成绩，请先取消缺考');patch.sectionScores={...r.sectionScores,...scores};}
    return patch;
  }
  function quizGroups(d){const seen=new Set();return d.activities.filter(a=>a.kind==='quiz').sort(order).filter(a=>{const k=quizKey(a);if(seen.has(k))return false;seen.add(k);return true;}).map(a=>({key:quizKey(a),a,group:quizGroup(d,a)}));}
  function trendData(d,options={}) {
    const {type='student',ids=[],metric='rate',keys=null,from='',to=''}=options,content=metric==='gradeRank'?'total':options.content||'total';
    const eligible=quizGroups(d).filter(g=>(!from||g.a.date>=from)&&(!to||g.a.date<=to)&&ids.length&&ids.every(id=>type==='class'?g.group.some(a=>a.classId===id):g.group.some(a=>a.studentIds.includes(id))));
    const selected=eligible.filter(g=>keys===null||keys.includes(g.key));
    const students=new Map(d.students.map(s=>[s.id,s])),classes=new Map(d.classes.map(c=>[c.id,c]));
    const points=selected.map(g=>({...g,label:g.a.name,date:g.a.date,stats:new Map(g.group.map(a=>[a.id,contentStats(d,a,content)])),ranks:quizStats(d,g.a)}));
    const series=[],selectedKeys=selected.map(g=>g.key);
    const pointFor=(p,a,r)=>{if(!a)return null;const value=contentScore(a,r,content),max=contentMax(a,content),stats=p.stats.get(a.id);return value===null?null:{value:metric==='gradeRank'?p.group.length>1?p.ranks.gradeRanks.get(r.studentId):null:value/max*100,score:value,max,count:p.ranks.gradeCount,classCount:stats.classCount,gradeCount:stats.gradeCount,blank:stats.gradeBlank,classId:a.classId,date:a.date,change:rankChange(d,a,r,selectedKeys,from,to)};};
    if(type==='student'){
      for(const id of ids)series.push({label:students.get(id)?.name||'未知学生',id,role:'student',points:points.map(p=>{const a=p.group.find(a=>a.studentIds.includes(id));return pointFor(p,a,a&&record(d,a.id,id));})});
      if(metric!=='gradeRank'){
        const classIds=[...new Set(points.flatMap(p=>p.group.filter(a=>ids.some(id=>a.studentIds.includes(id))).map(a=>a.classId)))];
        if(options.showClassAverage!==false)for(const id of classIds)series.push({label:`${classes.get(id)?.name}平均得分率`,id,role:'class',points:points.map(p=>{const a=p.group.find(a=>a.classId===id&&ids.some(sid=>a.studentIds.includes(sid)));if(!a)return null;const st=p.stats.get(a.id);return st.classAverage===null?null:{value:st.classAverage/st.total*100,score:st.classAverage,max:st.total,count:st.classCount,blank:st.classBlank};})});
        if(options.showGradeAverage!==false)series.push({label:'年级平均得分率',id:'grade',role:'grade',points:points.map(p=>{const st=p.stats.get(p.a.id);return p.group.length<2||st.gradeAverage===null?null:{value:st.gradeAverage/st.gradeTotal*100,score:st.gradeAverage,max:st.gradeTotal,count:st.gradeCount,blank:st.gradeBlank};})});
      }
    }else for(const id of ids)series.push({label:classes.get(id)?.name||'未知班级',id,role:'class',points:points.map(p=>{const a=p.group.find(a=>a.classId===id),st=p.stats.get(a.id);return st.classAverage===null?null:{value:metric==='average'?st.classAverage:st.classAverage/st.total*100,score:st.classAverage,max:st.total,count:st.classCount,blank:st.classBlank};})});
    return {eligible,points,series,content,metric,type,selectedKeys};
  }
  function issues(d, classId='') {
    const out={retake:[],correction:[],homework:[],homeworkRevision:[]};
    d.records.forEach(r=>{const a=d.activities.find(a=>a.id===r.activityId);if(!a||classId&&a.classId!==classId)return;
      if(a.kind==='dict'&&r.status==='f'&&r.retake!=='passed')out.retake.push({a,r});
      if(a.kind==='dict'&&dictParticipated(r)&&r.correction!=='correct')out.correction.push({a,r});
      if(a.kind==='hw'&&r.status==='missing'&&!r.submitted)out.homework.push({a,r});
      if(a.kind==='hw'&&r.hwRevision==='pending')out.homeworkRevision.push({a,r});
    });return out;
  }
  function validateBackup(d) {
    if(!d||d.version!==1)throw Error('不支持的备份版本');
    if(d.settings!==undefined&&(!d.settings||typeof d.settings.appName!=='string'||!d.settings.appName.trim()||d.settings.appName.length>20))throw Error('工作台名称无效，须为 1 至 20 个字符');
    for(const key of ['classes','students','activities','records','images']) {
      if(!Array.isArray(d[key])||new Set(d[key].map(x=>x.id)).size!==d[key].length||d[key].some(x=>typeof x.id!=='string'||!/^[-A-Za-z0-9_]+$/.test(x.id)))throw Error(`备份的 ${key} 数据损坏`);
    }
    const cs=new Set(d.classes.map(x=>x.id)),ss=new Set(d.students.map(x=>x.id)),as=new Map(d.activities.map(x=>[x.id,x])),rs=new Set(d.records.map(x=>x.id));
    if(d.classes.some(x=>typeof x.name!=='string'||!x.name.trim()))throw Error('班级无效');
    if(d.students.some(x=>!cs.has(x.classId)||typeof x.name!=='string'||!x.name.trim()||typeof x.number!=='string'||typeof x.active!=='boolean'||x.gender!==undefined&&!['male','female','unknown'].includes(x.gender)))throw Error('学生信息无效');
    if(d.activities.some(x=>!cs.has(x.classId)||!['dict','quiz','hw'].includes(x.kind)||typeof x.name!=='string'||!x.name.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Number.isFinite(x.created)||!Array.isArray(x.studentIds)||new Set(x.studentIds).size!==x.studentIds.length||x.studentIds.some(s=>!ss.has(s))||x.kind==='quiz'&&!(Number.isFinite(x.total)&&x.total>0)))throw Error('活动信息无效');
    const groups=new Map();
    for(const a of d.activities){
      if(a.quizGroupId!==undefined&&(a.kind!=='quiz'||typeof a.quizGroupId!=='string'||!/^[-A-Za-z0-9_]+$/.test(a.quizGroupId)))throw Error('跨班小测关联信息无效');
      if(a.kind!=='quiz')continue;const key=quizKey(a),g=groups.get(key)||{total:a.total,classes:new Set(),students:new Set()};
      if(g.total!==a.total||g.classes.has(a.classId)||a.studentIds.some(id=>g.students.has(id)))throw Error('跨班小测总分不一致，或班级、学生重复');
      g.classes.add(a.classId);a.studentIds.forEach(id=>g.students.add(id));groups.set(key,g);
    }
    for(const a of d.activities.filter(x=>x.kind==='quiz'))checkSectionCompatibility(quizGroup(d,a));
    const pairs=new Set();
    for(const r of d.records){const a=as.get(r.activityId),key=r.activityId+'|'+r.studentId;
      if(!a||!ss.has(r.studentId)||!a.studentIds.includes(r.studentId)||pairs.has(key))throw Error('记录关联无效或重复');pairs.add(key);
      const states={dict:['p','p-','f','absent','dict_exempt'],quiz:['blank','absent','score'],hw:['done','missing','exempt']};
      if(!states[a.kind].includes(r.status)||typeof r.note!=='string'||!['correct','wrong','none'].includes(r.correction)||!['pending','failed','passed'].includes(r.retake)||typeof r.submitted!=='boolean'||![r.retakeDate,r.submitDate].every(v=>typeof v==='string'&&(!v||/^\d{4}-\d{2}-\d{2}$/.test(v))))throw Error('记录内容无效');
      if(a.kind==='quiz'&&r.status==='score'&&!(Number.isFinite(r.score)&&r.score>=0&&r.score<=a.total))throw Error('成绩超出范围');
      if(r.sectionScores!==undefined){if(a.kind!=='quiz'||!r.sectionScores||typeof r.sectionScores!=='object'||Array.isArray(r.sectionScores))throw Error('分项成绩无效');for(const [name,v] of Object.entries(r.sectionScores))if(!Object.hasOwn(a.sections||{},name)||v!==null&&(!Number.isFinite(v)||v<0||v>a.sections[name]))throw Error('分项成绩超出范围或缺少满分配置');}
      if(r.hwRevision!==undefined&&(a.kind!=='hw'||!['none','pending','done'].includes(r.hwRevision)))throw Error('作业订正状态无效');
      if(['pending','done'].includes(r.hwRevision)&&!(r.status==='done'||r.status==='missing'&&r.submitted))throw Error('待改或已改的作业必须已交');
      if(r.revisedDate!==undefined&&(typeof r.revisedDate!=='string'||r.revisedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(r.revisedDate)))throw Error('作业已改日期无效');
    }
    if(d.activities.some(a=>a.studentIds.some(s=>!pairs.has(a.id+'|'+s))))throw Error('备份缺少学生记录');
    if(d.images.some(x=>!rs.has(x.recordId)||typeof x.name!=='string'||!['good','improve'].includes(x.tag)||typeof x.data!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.data)))throw Error('图片数据无效');
    return d;
  }
  function parseGender(value) {
    const text=String(value??'').trim().toLowerCase();
    if(['','未填写','未知','unknown'].includes(text))return 'unknown';
    if(['男','男生','male','m'].includes(text))return 'male';
    if(['女','女生','female','f'].includes(text))return 'female';
    throw Error('性别请填写男、女或未填写');
  }
  function matchStudent(d,row,classId) {
    const number=String(row['学号']??'').trim(),name=String(row['姓名']??'').trim();
    const found=d.students.filter(s=>s.classId===classId && (number?s.number===number:s.name===name));
    if(found.length!==1)throw Error(found.length?'同名或学号重复，请用唯一学号匹配':'找不到对应学生');
    return found[0];
  }
  function copyListRecords(d,a,type) {
    const students=new Map(d.students.map(s=>[s.id,s])),rows=d.records.filter(r=>r.activityId===a.id);
    const compare=(x,y)=>{const s=students.get(x.studentId),t=students.get(y.studentId);return String(s.number||'').localeCompare(String(t.number||''),'zh',{numeric:true})||s.name.localeCompare(t.name,'zh')||s.id.localeCompare(t.id);};
    if(type==='bottom5'&&a.kind==='quiz')return rows.filter(r=>r.status==='score'&&Number.isFinite(r.score)).sort((x,y)=>x.score-y.score||compare(x,y)).slice(0,5);
    return rows.filter(r=>{
      if(a.kind==='dict')return type==='failed'?r.status==='f':type==='retake'?r.status==='f'&&r.retake!=='passed':type==='correction'?dictParticipated(r)&&r.correction!=='correct':false;
      if(a.kind==='hw')return type==='unsubmitted'?r.status==='missing'&&!r.submitted:['revision_pending','revised'].includes(type)&&homeworkState(r)===type;
      return false;
    }).sort(compare);
  }
  function copyStudentNames(d,a,rows) {
    const students=new Map(d.students.map(s=>[s.id,s])),counts=new Map();
    a.studentIds.forEach(id=>{const name=students.get(id).name;counts.set(name,(counts.get(name)||0)+1);});
    return rows.map(r=>{const s=students.get(r.studentId);return counts.get(s.name)>1?`${s.name}（${s.number?'学号 '+s.number:'名单序号 '+(a.studentIds.indexOf(s.id)+1)}）`:s.name;});
  }
  const api={trendData,sectionNames,dictParticipated,rankChange,groupDate,validateSections,setSections,contentScore,contentMax,contentStats,scorePatch,quizGroups,empty,uid,order,record,previous,createActivity,entries,summary,delta,issues,validateBackup,matchStudent,parseGender,quizKey,quizGroup,linkQuiz,quizStats,homeworkState,homeworkComplete,setHomeworkStatus,copyListRecords,copyStudentNames};
  if(typeof module!=='undefined')module.exports=api;root.Tracker=api;
})(globalThis);
