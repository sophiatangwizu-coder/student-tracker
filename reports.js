/* Compact print layout and batch class reports. No student data is mutated. */
let classReportState=null;
function compactReportLayout(markup){
  const template=document.createElement('template');template.innerHTML=markup;
  const article=template.content.querySelector('article');article.classList.add('compact-report');
  const body=document.createElement('div');body.className='report-columns';
  // Keep identity and summary across the full page, then flow complete details into two columns.
  const children=[...article.children];let afterSummary=false;
  for(const node of children){if(node.classList.contains('report-stats')){afterSummary=true;continue;}if(afterSummary)body.append(node);}
  const summary=body.firstElementChild;if(summary?.matches('p.help')){summary.classList.add('report-summary');article.append(summary);}
  article.append(body);
  // Combine repeated per-exam table headers while preserving each score and comparison note.
  const details=body.querySelector('.trend-details');
  if(details){const items=[...details.querySelectorAll('.trend-detail-item')],table=document.createElement('table'),tbody=document.createElement('tbody');
    const head=items[0]?.querySelector('thead');if(head)table.append(head.cloneNode(true));
    for(const item of items){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=head?.querySelectorAll('th').length||4;cell.className='compact-exam-caption';
      cell.innerHTML=`<strong>${item.querySelector('h3').innerHTML}</strong> · ${item.querySelector('p').innerHTML}`;row.append(cell);tbody.append(row);item.querySelectorAll('tbody tr').forEach(r=>tbody.append(r));}
    table.append(tbody);const summary=document.createElement('summary');summary.textContent='所选小测明细';details.replaceChildren(summary,table);details.open=true;
  }
  // Long notes use the full column width instead of becoming a very tall narrow cell.
  for(const section of body.querySelectorAll('section'))for(const row of [...section.querySelectorAll('tbody tr')]){
    const note=row.querySelector('.detail-note');if(!note||note.textContent.length<=100)continue;
    const full=document.createElement('tr'),cell=document.createElement('td');full.className='report-long-note';cell.colSpan=row.children.length;cell.className='detail-note';cell.textContent='备注：'+note.textContent;full.append(cell);note.textContent='详见下方备注';row.after(full);
  }
  return article.outerHTML;
}
function scopedStudentReport(s,options){
  const prior={studentId,from,to,trendMode,view},had=profileTrends.has(s.id),savedTrend=profileTrends.get(s.id);
  try{studentId=s.id;from=options.from;to=options.to;view='students';trendMode=options.metric;
    profileTrends.set(s.id,{type:'student',ids:[s.id],metric:options.metric,content:options.content,showClassAverage:options.showClassAverage,showGradeAverage:options.showGradeAverage,keys:null});
    return reportMarkup(s,options.images,options.kind);
  }finally{studentId=prior.studentId;from=prior.from;to=prior.to;trendMode=prior.trendMode;view=prior.view;if(had)profileTrends.set(s.id,savedTrend);else profileTrends.delete(s.id);}
}
function classReportStudents(){const st=classReportState;return data.students.filter(s=>s.classId===st.classId&&(st.includeInactive||s.active)).sort((a,b)=>String(a.number).localeCompare(String(b.number),'zh',{numeric:true})||a.name.localeCompare(b.name,'zh')||a.id.localeCompare(b.id));}
function classReportDialog(){
  if(!data.classes.length){toast('请先建立班级和学生名单');return;}
  classReportState={classId:classId||data.classes[0].id,from:'',to:'',kind:'all',images:false,includeInactive:true,metric:'gradeRank',content:'total',showClassAverage:true,showGradeAverage:true};
  modal('整班学生档案 PDF',`<div class="toolbar"><label>班级 <select data-class-report="classId">${classOptions(classReportState.classId,false)}</select></label><label>开始日期 <input type="date" data-class-report="from"></label><label>结束日期 <input type="date" data-class-report="to"></label><label>内容 <select data-class-report="kind">${exportOptions()}</select></label></div><div class="toolbar"><label><input type="checkbox" data-class-report="includeInactive" checked> 包含停用学生</label><label><input type="checkbox" data-class-report="images"> 附上作业图片</label><label>趋势指标 <select data-class-report="metric">${option('gradeRank','总成绩年级名次','gradeRank')}${option('rate','得分率','gradeRank')}</select></label><label>统计内容 <select data-class-report="content" disabled>${option('total','总成绩','total')}${T.sectionNames.map(n=>option(n,n,'total')).join('')}</select></label></div><div class="toolbar" id="class-report-means" hidden><label><input type="checkbox" data-class-report="showClassAverage" checked> 班级平均得分率</label><label><input type="checkbox" data-class-report="showGradeAverage" checked> 年级平均得分率</label></div><p class="help">按学号排列，整班合并为一份 PDF，每位学生另起一页。统一采用横向 A4 紧凑双栏，尽量每人 1–2 页；记录或图片较多时自动续页，完整保留内容。可缩小日期范围减少页数。整班导出采用以上统一范围，不受学生列表搜索或个人图表选场影响。</p><div class="toolbar"><strong id="class-report-count"></strong><span class="spacer"></span>${btn('一键打印整班 / 保存 PDF','print-class-report','','primary')}</div><p class="help">下方预览首位学生；打印窗口将包含全班。选择“另存为 PDF”、A4 横向、缩放 100%，关闭浏览器页眉和页脚。</p><div id="class-report-preview" class="report-preview-scroll"></div>`,true);
  updateClassReportPreview();
}
function updateClassReportPreview(){const st=classReportState,students=classReportStudents();$('#class-report-count').textContent=`${className(st.classId)} · 共 ${students.length} 位学生`;
  $('[data-action="print-class-report"]').disabled=!students.length;
  $('[data-class-report="content"]').disabled=st.metric==='gradeRank';
  $('[data-class-report="content"]').value=st.metric==='gradeRank'?'total':st.content;
  $('#class-report-means').hidden=st.metric!=='rate';
  $('#class-report-preview').innerHTML=students.length?scopedStudentReport(students[0],st):empty('该范围没有学生','请选择其他班级或包含停用学生。');
}
function changeClassReport(el){if(!el.dataset.classReport)return false;const key=el.dataset.classReport,value=el.type==='checkbox'?el.checked:el.value,st=classReportState,next={...st,[key]:value};
  if(next.from&&next.to&&next.from>next.to){el.value=st[key];throw Error('开始日期不能晚于结束日期');}
  classReportState=next;updateClassReportPreview();return true;
}
async function printClassReports(button){
  const students=classReportStudents(),options={...classReportState};if(!students.length)throw Error('没有可导出的学生');
  button.disabled=true;const oldText=button.textContent;
  try{const parts=[];for(let i=0;i<students.length;i++){parts.push(scopedStudentReport(students[i],options));if(i%5===0){button.textContent=`正在准备 ${i+1} / ${students.length} 位…`;await new Promise(resolve=>setTimeout(resolve,0));}}
    $('#print-root').innerHTML=parts.join('');await waitReportAssets();await printWithTitle(`${className(options.classId)}-全班学生档案-${today()}`);
  }finally{button.disabled=false;button.textContent=oldText;}
}
async function waitReportAssets(){await document.fonts.ready;await Promise.all([...$('#print-root').querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));}
async function printWithTitle(title){const old=document.title;document.title=title;try{window.print();}finally{document.title=old;}}
