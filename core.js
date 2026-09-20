/* Domain logic shared by the offline interface and regression tests. */
(function (root) {
  const empty = () => ({version:1,settings:{appName:'紫笺'},classes:[],students:[],activities:[],records:[],images:[]});
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
  function summary(d,sid,from='',to='') {
    const es=entries(d,sid,null,from,to), ds=es.filter(x=>x.a.kind==='dict'&&x.r.status!=='absent'), hs=es.filter(x=>x.a.kind==='hw'&&x.r.status!=='exempt');
    const qs=es.filter(x=>x.a.kind==='quiz'&&rate(x.r)!==null).map(x=>({...x,value:x.r.score/x.a.total*100}));
    return {dict:ds.length?ds.reduce((sum,x)=>sum+({p:1,'p-':.5,f:0}[x.r.status]),0)/ds.length*100:null,dictCount:ds.length,hw:hs.length?hs.filter(x=>x.r.status==='done'||x.r.submitted).length/hs.length*100:null,missing:hs.filter(x=>x.r.status==='missing').length,submitted:hs.filter(x=>x.r.status==='missing'&&x.r.submitted).length,quizzes:qs};
  }
  function delta(d,a,r) {
    if(rate(r)===null) return null;
    const p=entries(d,r.studentId,'quiz').filter(x=>order(x.a,a)<0 && rate(x.r)!==null).at(-1);
    return p?(r.score/a.total-p.r.score/p.a.total)*100:null;
  }
  function issues(d, classId='') {
    const out={retake:[],correction:[],homework:[]};
    d.records.forEach(r=>{const a=d.activities.find(a=>a.id===r.activityId);if(!a||classId&&a.classId!==classId)return;
      if(a.kind==='dict'&&r.status==='f'&&r.retake!=='passed')out.retake.push({a,r});
      if(a.kind==='dict'&&r.status!=='absent'&&r.correction!=='correct')out.correction.push({a,r});
      if(a.kind==='hw'&&r.status==='missing'&&!r.submitted)out.homework.push({a,r});
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
    const pairs=new Set();
    for(const r of d.records){const a=as.get(r.activityId),key=r.activityId+'|'+r.studentId;
      if(!a||!ss.has(r.studentId)||!a.studentIds.includes(r.studentId)||pairs.has(key))throw Error('记录关联无效或重复');pairs.add(key);
      const states={dict:['p','p-','f','absent'],quiz:['blank','absent','score'],hw:['done','missing','exempt']};
      if(!states[a.kind].includes(r.status)||typeof r.note!=='string'||!['correct','wrong','none'].includes(r.correction)||!['pending','failed','passed'].includes(r.retake)||typeof r.submitted!=='boolean'||![r.retakeDate,r.submitDate].every(v=>typeof v==='string'&&(!v||/^\d{4}-\d{2}-\d{2}$/.test(v))))throw Error('记录内容无效');
      if(a.kind==='quiz'&&r.status==='score'&&!(Number.isFinite(r.score)&&r.score>=0&&r.score<=a.total))throw Error('成绩超出范围');
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
  const api={empty,uid,order,record,previous,createActivity,entries,summary,delta,issues,validateBackup,matchStudent,parseGender,quizKey,quizGroup,linkQuiz,quizStats};
  if(typeof module!=='undefined')module.exports=api;root.Tracker=api;
})(globalThis);
