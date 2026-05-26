// glow
document.addEventListener('mousemove',e=>{const g=document.getElementById('glow');g.style.left=e.clientX+'px';g.style.top=e.clientY+'px'});

// ── state ──
let rawData=[],cleanedData=[],prevCleaned=[],headers=[],colTypes={},fileName='';
let dashCharts=[];
let activeFilters={};
let sortCol=null,sortDir=1;
let cleanOpts={dupes:true,missing:true,whitespace:true,types:true};
let cleanCtrlOpen=true;

// ── tabs ──
function switchTab(name){
  ['upload','insights','dashboard','manual'].forEach(n=>{
    document.getElementById('tab-'+n).classList.toggle('active',n===name);
    document.getElementById('panel-'+n).classList.toggle('active',n===name);
  });
  if(name==='manual') cbPopulateColPicker();
}

function updateBadges(){
  const has=cleanedData.length>0;
  const bu=document.getElementById('badge-upload');
  const bi=document.getElementById('badge-insights');
  const bd=document.getElementById('badge-dashboard');
  if(has){
    bu.textContent=cleanedData.length+' rows';bu.style.display='';
    bi.textContent=headers.length+' cols';bi.style.display='';
    bd.textContent='ready';bd.style.display='';
  } else {
    [bu,bi,bd].forEach(b=>{b.style.display='none'});
  }
}

// ── cleaning controls ──
function toggleCleanControls(){
  cleanCtrlOpen=!cleanCtrlOpen;
  document.getElementById('cleanOptsBody').style.display=cleanCtrlOpen?'':'none';
  document.getElementById('ctoggle').textContent=cleanCtrlOpen?'▾ collapse':'▸ expand';
}
function toggleOpt(key){
  cleanOpts[key]=!cleanOpts[key];
  const el=document.getElementById('opt-'+key);
  el.classList.toggle('on',cleanOpts[key]);
  el.querySelector('.clean-opt-check').textContent=cleanOpts[key]?'✓':'';
}

// ── file load ──
function handleDrop(e){
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
}
function handleFile(file){
  if(!file)return;
  fileName=file.name;
  const ext=file.name.split('.').pop().toLowerCase();
  document.getElementById('fileIconEl').textContent=ext==='csv'?'📄':'📊';
  document.getElementById('fileNameEl').textContent=file.name;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rawData=XLSX.utils.sheet_to_json(ws,{defval:''});
      headers=rawData.length?Object.keys(rawData[0]):[];
      document.getElementById('fileMetaEl').textContent=rawData.length.toLocaleString()+' rows · '+headers.length+' columns';
      document.getElementById('fileInfoArea').style.display='block';
      document.getElementById('onboardGrid').style.display='none';
      document.getElementById('cleaningResults').style.display='none';
      document.getElementById('undoBar').style.display='none';
      detectRawErrors();
    }catch(e){ alert('Could not parse file. Check it is a valid CSV or Excel file.'); }
  };
  reader.readAsBinaryString(file);
}

// ── cleaning ──
function runCleaning(){
  if(!rawData.length)return;
  prevCleaned=[...cleanedData];
  document.getElementById('progressArea').style.display='block';
  document.getElementById('cleanBtn').disabled=true;
  const steps=[
    {p:15,l:'Detecting column types…'},{p:35,l:'Removing duplicates…'},
    {p:55,l:'Handling missing values…'},{p:75,l:'Standardizing formats…'},
    {p:90,l:'Trimming whitespace…'},{p:100,l:'Finalizing…'}
  ];
  let i=0;
  (function run(){
    if(i>=steps.length){setTimeout(finishCleaning,300);return}
    const s=steps[i++];
    document.getElementById('progressLabel').textContent=s.l;
    document.getElementById('progressFill').style.width=s.p+'%';
    setTimeout(run,260);
  })();
}

function detectType(col){
  const vals=rawData.map(r=>r[col]).filter(v=>v!=null&&v!=='');
  const sample=vals.slice(0,50);
  let nc=0,dc=0;
  sample.forEach(v=>{
    if(!isNaN(parseFloat(v))&&isFinite(v))nc++;
    else if(!isNaN(Date.parse(v)))dc++;
  });
  const n=Math.max(sample.length,1);
  if(nc/n>.7)return'numeric';
  if(dc/n>.5)return'date';
  return'text';
}

function finishCleaning(){
  colTypes={};
  headers.forEach(h=>{ colTypes[h]=cleanOpts.types?detectType(h):'text'; });

  let data=[...rawData];
  let dupsRemoved=0,missingFilled=0,whitespaceFixed=0;

  if(cleanOpts.dupes){
    const seen=new Set();
    data=data.filter(row=>{
      const k=JSON.stringify(row);
      if(seen.has(k)){dupsRemoved++;return false}
      seen.add(k);return true;
    });
  }

  const numDefaults={};
  if(cleanOpts.missing){
    headers.forEach(h=>{
      if(colTypes[h]==='numeric'){
        const vals=data.map(r=>parseFloat(r[h])).filter(v=>!isNaN(v));
        numDefaults[h]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
      }
    });
  }

  cleanedData=data.map(row=>{
    const r={...row};
    headers.forEach(h=>{
      let v=r[h];
      if(cleanOpts.whitespace&&typeof v==='string'){const t=v.trim();if(t!==v)whitespaceFixed++;v=t;}
      if(cleanOpts.missing&&(v===''||v==null)){
        missingFilled++;
        v=colTypes[h]==='numeric'?parseFloat((numDefaults[h]||0).toFixed(2)):'Unknown';
      }
      r[h]=v;
    });
    return r;
  });

  if(prevCleaned.length){
    document.getElementById('undoBar').style.display='flex';
    document.getElementById('undoMsg').textContent='Re-cleaned. Previous '+prevCleaned.length.toLocaleString()+' rows saved.';
  }

  document.getElementById('cleanStats').innerHTML=
    '<div class="stat"><div class="stat-label">Original</div><div class="stat-val">'+rawData.length.toLocaleString()+'</div><div class="stat-sub">rows</div></div>'+
    '<div class="stat"><div class="stat-label">Cleaned</div><div class="stat-val">'+cleanedData.length.toLocaleString()+'</div><div class="stat-sub">'+dupsRemoved+' dupes removed</div></div>'+
    '<div class="stat"><div class="stat-label">Missing filled</div><div class="stat-val">'+missingFilled.toLocaleString()+'</div></div>'+
    '<div class="stat"><div class="stat-label">Whitespace</div><div class="stat-val">'+whitespaceFixed.toLocaleString()+'</div><div class="stat-sub">cells trimmed</div></div>';

  const logItems=[
    {d:'dot-blue',t:'Detected '+headers.filter(h=>colTypes[h]==='numeric').length+' numeric, '+headers.filter(h=>colTypes[h]==='text').length+' text, '+headers.filter(h=>colTypes[h]==='date').length+' date columns',c:null,skip:!cleanOpts.types},
    {d:'dot-amber',t:'Removed duplicate rows',c:dupsRemoved,skip:!cleanOpts.dupes},
    {d:'dot-amber',t:'Filled missing values',c:missingFilled,skip:!cleanOpts.missing},
    {d:'dot-green',t:'Trimmed whitespace',c:whitespaceFixed,skip:!cleanOpts.whitespace},
    {d:'dot-green',t:'Dataset ready',c:cleanedData.length+' rows',skip:false}
  ].filter(l=>!l.skip);
  document.getElementById('cleaningLog').innerHTML=logItems.map(l=>
    '<div class="log-row"><span class="log-dot '+l.d+'"></span><span class="log-text">'+l.t+'</span>'+(l.c!=null?'<span class="log-count">'+l.c+'</span>':'')+'</div>'
  ).join('');

  document.getElementById('cleanedFileLabel').textContent=cleanedData.length.toLocaleString()+' rows · '+headers.length+' columns';
  document.getElementById('progressArea').style.display='none';
  document.getElementById('cleanBtn').disabled=false;
  activeFilters={};sortCol=null;sortDir=1;
  renderPreview();
  document.getElementById('cleaningResults').style.display='block';
  updateBadges();
  buildInsights();
  buildDashboard();
  saveDatasetAnalysis();
}

function undoClean(){
  if(!prevCleaned.length)return;
  cleanedData=[...prevCleaned];prevCleaned=[];
  document.getElementById('undoBar').style.display='none';
  activeFilters={};sortCol=null;
  renderPreview();buildInsights();buildDashboard();updateBadges();
}

// ── preview ──
function renderPreview(){
  let data=[...cleanedData];
  Object.entries(activeFilters).forEach(([col,val])=>{ data=data.filter(r=>String(r[col])===val); });
  if(sortCol) data.sort((a,b)=>{
    const av=a[sortCol],bv=b[sortCol];
    if(!isNaN(av-bv))return(parseFloat(av)-parseFloat(bv))*sortDir;
    return String(av).localeCompare(String(bv))*sortDir;
  });
  const rows=data.slice(0,20);

  // filter pills
  const pills=Object.entries(activeFilters).map(([col,val])=>
    '<span class="filter-pill">'+col+': '+val+'<button onclick="removeDrillFilter(\''+col+'\')">×</button></span>'
  ).join('');
  const fb=document.getElementById('filterBar');
  fb.innerHTML=pills;fb.style.display=pills?'flex':'none';

  let html='<table><thead><tr>'+headers.map(h=>
    '<th onclick="sortPreview(\''+esc(h)+'\')">'+h+(sortCol===h?(sortDir===1?' ↑':' ↓'):'')+'</th>'
  ).join('')+'</tr></thead><tbody>';
  rows.forEach((r,ri)=>{
    const rowJson=JSON.stringify(r).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    html+='<tr onclick="drillRow(this,\''+rowJson+'\')">'+headers.map(h=>'<td title="'+esc(String(r[h]||''))+'">'+esc(String(r[h]||'').slice(0,40))+'</td>').join('')+'</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('previewTable').innerHTML=html;
  document.getElementById('drillPanel').innerHTML='';
}

function sortPreview(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  renderPreview();
}

function drillRow(tr,rowStr){
  document.querySelectorAll('tbody tr.hl').forEach(r=>r.classList.remove('hl'));
  tr.classList.add('hl');
  const row=JSON.parse(rowStr);
  const numCols=headers.filter(h=>colTypes[h]==='numeric');
  if(!numCols.length){document.getElementById('drillPanel').innerHTML='';return;}
  const stats=numCols.slice(0,6).map(h=>'<div class="drill-stat"><strong>'+Number(row[h]).toLocaleString(undefined,{maximumFractionDigits:2})+'</strong>'+h+'</div>').join('');
  document.getElementById('drillPanel').innerHTML='<div class="drill-panel"><div class="drill-title">📌 Row detail</div><div class="drill-stats">'+stats+'</div></div>';
}

function removeDrillFilter(col){ delete activeFilters[col]; renderPreview(); }

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── download ──
function downloadCleaned(fmt){
  if(!cleanedData.length)return;
  const ws=XLSX.utils.json_to_sheet(cleanedData);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Cleaned');
  XLSX.writeFile(wb,'cleaned_'+fileName.replace(/\.[^.]+$/,'')+'.'+(fmt==='xlsx'?'xlsx':'csv'));
}

// ── chart export ──
function exportChart(canvasId,name){
  const c=document.getElementById(canvasId);
  if(!c)return;
  const a=document.createElement('a');a.download=(name||'chart')+'.png';a.href=c.toDataURL('image/png');a.click();
}

// ── insights ──
function buildInsights(){
  if(!cleanedData.length)return;
  document.getElementById('insightsEmpty').style.display='none';
  document.getElementById('insightsContent').style.display='block';
  const numCols=headers.filter(h=>colTypes[h]==='numeric');
  let totalMissing=0;
  headers.forEach(h=>{totalMissing+=rawData.filter(r=>r[h]===''||r[h]==null).length;});
  const completeness=Math.round((1-totalMissing/(rawData.length*headers.length))*100);
  document.getElementById('insightStats').innerHTML=
    '<div class="stat"><div class="stat-label">Rows</div><div class="stat-val">'+cleanedData.length.toLocaleString()+'</div></div>'+
    '<div class="stat"><div class="stat-label">Columns</div><div class="stat-val">'+headers.length+'</div></div>'+
    '<div class="stat"><div class="stat-label">Numeric</div><div class="stat-val">'+numCols.length+'</div></div>'+
    '<div class="stat"><div class="stat-label">Completeness</div><div class="stat-val">'+completeness+'%</div></div>';

  document.getElementById('colProfiles').innerHTML=headers.slice(0,12).map(h=>{
    const vals=cleanedData.map(r=>r[h]).filter(v=>v!==''&&v!=null&&v!=='Unknown');
    const fill=Math.round(vals.length/cleanedData.length*100);
    const unique=new Set(vals.map(v=>String(v))).size;
    const type=colTypes[h]||'text';
    const color=type==='numeric'?'#00f5c4':type==='date'?'#7b5ea7':'#ff6b6b';
    const flagged=fill<70;
    let extra='';
    if(type==='numeric'){
      const nums=vals.map(v=>parseFloat(v)).filter(v=>!isNaN(v));
      if(nums.length){
        const avg=nums.reduce((a,b)=>a+b,0)/nums.length;
        extra='<div class="col-stats"><span>min '+Math.min(...nums).toLocaleString(undefined,{maximumFractionDigits:1})+'</span><span>avg '+avg.toFixed(1)+'</span><span>max '+Math.max(...nums).toLocaleString(undefined,{maximumFractionDigits:1})+'</span></div>';
      }
    } else {
      extra='<div class="col-stats"><span>'+unique+' unique</span></div>';
    }
    return '<div class="col-card'+(flagged?' flagged':'')+'">'+
      '<div class="col-name">'+h+'</div>'+
      '<div class="col-type">'+type+' · '+fill+'% filled</div>'+
      '<div class="col-fill"><div class="col-fill-inner" style="width:'+fill+'%;background:'+color+'"></div></div>'+
      extra+
      '<div class="col-action-row">'+
        '<button class="col-act-btn" onclick="filterByCol(\''+h+'\')">Filter</button>'+
        '<button class="col-act-btn" onclick="goToBuilder(\''+h+'\')">Chart</button>'+
        (flagged?'<span class="badge badge-amber">low fill</span>':'')+
      '</div>'+
    '</div>';
  }).join('');

  let qt='<table><thead><tr><th>Column</th><th>Type</th><th>Filled%</th><th>Unique</th><th>Missing</th><th>Quality</th></tr></thead><tbody>';
  headers.forEach(h=>{
    const vals=cleanedData.map(r=>r[h]);
    const filled=vals.filter(v=>v!==''&&v!=null&&v!=='Unknown').length;
    const missing=cleanedData.length-filled;
    const unique=new Set(vals.map(v=>String(v))).size;
    const pct=Math.round(filled/cleanedData.length*100);
    const q=pct>=95?'<span class="badge badge-green">Excellent</span>':pct>=80?'<span class="badge badge-amber">Good</span>':'<span class="badge badge-red">Poor</span>';
    qt+='<tr><td style="font-family:\'Space Mono\',monospace;font-size:10px">'+h+'</td><td><span class="badge badge-blue">'+(colTypes[h]||'text')+'</span></td><td>'+pct+'%</td><td>'+unique+'</td><td>'+missing+'</td><td>'+q+'</td></tr>';
  });
  document.getElementById('qualityTable').innerHTML=qt+'</tbody></table>';
}

function filterByCol(col){
  const vals=[...new Set(cleanedData.map(r=>String(r[col])))];
  if(vals.length){activeFilters[col]=vals[0];}
  switchTab('upload');setTimeout(renderPreview,100);
}
function goToBuilder(col){
  cbLabelCol=col;switchTab('manual');setTimeout(cbPopulateColPicker,100);
}

// ── dashboard ──
const CC=['#00f5c4','#7b5ea7','#ff6b6b','#f59e0b','#3b82f6','#10b981','#ec4899','#8b5cf6'];
const SO={
  x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'rgba(107,107,153,.9)',font:{size:9,family:"'Space Mono',monospace"},maxRotation:45}},
  y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'rgba(107,107,153,.9)',font:{size:9,family:"'Space Mono',monospace"}}}
};

// ── dash helpers ──
function numStats(vals){
  const n=vals.filter(v=>!isNaN(v));
  if(!n.length)return{sum:0,avg:0,min:0,max:0,median:0,count:0,std:0};
  const s=n.reduce((a,b)=>a+b,0);
  const sorted=[...n].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return{sum:s,avg:s/n.length,min:sorted[0],max:sorted[sorted.length-1],
    median:sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2,
    count:n.length,std:Math.sqrt(n.reduce((a,b)=>a+(b-s/n.length)**2,0)/n.length)};
}
function fmtNum(v){
  if(Math.abs(v)>=1e9)return(v/1e9).toFixed(1)+'B';
  if(Math.abs(v)>=1e6)return(v/1e6).toFixed(1)+'M';
  if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+'K';
  return v%1===0?String(v):v.toFixed(2);
}
function aggBy(catCol,numCol){
  const map={};
  cleanedData.forEach(r=>{
    const k=String(r[catCol]||'(blank)').slice(0,24);
    const v=parseFloat(r[numCol]);
    if(!isNaN(v)){map[k]=map[k]||[];map[k].push(v);}
  });
  return map;
}

function buildDashboard(){
  if(!cleanedData.length)return;
  document.getElementById('dashEmpty').style.display='none';
  document.getElementById('dashThinking').style.display='flex';
  document.getElementById('dashContent').style.display='none';
  dashCharts.forEach(c=>c.destroy());dashCharts=[];
  const msgs=['Analyzing data structure…','Identifying best chart types…','Computing distributions…','Generating dashboard…'];
  let mi=0;
  const tm=setInterval(()=>{ document.getElementById('dashThinkingText').textContent=msgs[Math.min(mi++,msgs.length-1)]; },600);
  setTimeout(()=>{clearInterval(tm);document.getElementById('dashThinking').style.display='none';document.getElementById('dashContent').style.display='block';renderDashboard();},2400);
}

function mkCard(id,title,sub,badge,extra){
  return '<div class="chart-card">'+
    '<div class="chart-header">'+
      '<div><div class="chart-title">'+title+'</div><div class="chart-sub">'+sub+'</div></div>'+
      '<div class="chart-actions"><span class="chart-type-badge">'+badge+'</span>'+
        '<button class="export-btn" onclick="exportChart(\''+id+'\',\''+id+'\')">⬇ PNG</button>'+
      '</div>'+
    '</div>'+(extra||'')+
    '<div style="position:relative;height:220px"><canvas id="'+id+'"></canvas></div>'+
    '<div id="'+id+'-drill"></div>'+
  '</div>';
}

function renderDashboard(){
  const numCols=headers.filter(h=>colTypes[h]==='numeric');
  const catCols=headers.filter(h=>colTypes[h]==='text');
  let html='';const defs=[];

  if(numCols.length){
    html+='<div class="stat-grid">';
    numCols.slice(0,4).forEach(h=>{
      const vals=cleanedData.map(r=>parseFloat(r[h])).filter(v=>!isNaN(v));
      const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
      html+='<div class="stat"><div class="stat-label">'+h+'</div><div class="stat-val">'+(avg>=1000?avg.toLocaleString(undefined,{maximumFractionDigits:0}):avg.toFixed(2))+'</div><div class="stat-sub">avg · '+vals.length+' values</div></div>';
    });
    html+='</div>';
  }

  if(numCols.length){
    const h=numCols[0];
    const vals=cleanedData.map(r=>parseFloat(r[h])).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
    const bins=8,mn=vals[0],mx=vals[vals.length-1],step=(mx-mn)/bins||1;
    const buckets=Array.from({length:bins},(_,i)=>({l:(mn+i*step).toFixed(1),c:0}));
    vals.forEach(v=>{const idx=Math.min(Math.floor((v-mn)/step),bins-1);buckets[idx].c++;});
    html+=mkCard('ch1','Distribution: '+h,'Frequency histogram','histogram');
    defs.push({id:'ch1',type:'bar',labels:buckets.map(b=>b.l),datasets:[{label:h,data:buckets.map(b=>b.c),backgroundColor:'#00f5c433',borderColor:'#00f5c4',borderWidth:1}],opts:{scales:SO,plugins:{legend:{display:false}}}});
  }

  if(catCols.length){
    const h=catCols[0];
    const counts={};
    cleanedData.forEach(r=>{const v=String(r[h]||'').slice(0,22);counts[v]=(counts[v]||0)+1;});
    const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const labels=sorted.map(([k])=>k),data=sorted.map(([,v])=>v);
    const legend='<div class="legend-row">'+labels.map((l,i)=>'<span class="legend-item"><span class="legend-swatch" style="background:'+CC[i%CC.length]+'"></span>'+l+'</span>').join('')+'</div>';
    html+=mkCard('ch2','Breakdown: '+h,'Top '+labels.length+' categories · click to drill','donut',legend);
    defs.push({id:'ch2',type:'doughnut',labels,datasets:[{data,backgroundColor:CC.map(c=>c+'cc'),borderColor:CC,borderWidth:1}],opts:{cutout:'62%',plugins:{legend:{display:false}}},drillCol:h,drillData:data});
  }

  if(numCols.length>=2){
    const h1=numCols[0],h2=numCols[1];
    const srows=cleanedData.slice(0,Math.min(14,cleanedData.length));
    const rowLabels=srows.map((r,i)=>catCols.length?String(r[catCols[0]]||'').slice(0,14):'Row '+(i+1));
    const legend='<div class="legend-row"><span class="legend-item"><span class="legend-swatch" style="background:#00f5c4"></span>'+h1+'</span><span class="legend-item"><span class="legend-swatch" style="background:#7b5ea7"></span>'+h2+'</span></div>';
    html+=mkCard('ch3',h1+' vs '+h2,'Grouped bars · click to drill','grouped bar',legend);
    defs.push({id:'ch3',type:'bar',labels:rowLabels,datasets:[
      {label:h1,data:srows.map(r=>parseFloat(r[h1])||0),backgroundColor:'#00f5c433',borderColor:'#00f5c4',borderWidth:1},
      {label:h2,data:srows.map(r=>parseFloat(r[h2])||0),backgroundColor:'#7b5ea733',borderColor:'#7b5ea7',borderWidth:1}
    ],opts:{scales:SO,plugins:{legend:{display:false}}},drillRows:srows,drillH1:h1,drillH2:h2});
  }

  if(numCols.length>=2){
    const h1=numCols[0],h2=numCols[1];
    const pts=cleanedData.slice(0,80).map(r=>({x:parseFloat(r[h1])||0,y:parseFloat(r[h2])||0}));
    html+=mkCard('ch4','Correlation: '+h1+' × '+h2,'Scatter plot','scatter');
    defs.push({id:'ch4',type:'scatter',datasets:[{data:pts,backgroundColor:'#00f5c444',borderColor:'#00f5c4',pointRadius:3,pointHoverRadius:5,borderWidth:1}],opts:{scales:{x:{...SO.x,title:{display:true,text:h1,color:'#6b6b99',font:{size:9}}},y:{...SO.y,title:{display:true,text:h2,color:'#6b6b99',font:{size:9}}}},plugins:{legend:{display:false}}}});
  }

  if(numCols.length){
    const h=numCols[numCols.length>1?1:0];
    const pts=cleanedData.slice(0,40).map(r=>parseFloat(r[h])||0);
    html+=mkCard('ch5','Trend: '+h,'Sequential values','line');
    defs.push({id:'ch5',type:'line',labels:pts.map((_,i)=>i+1),datasets:[{label:h,data:pts,borderColor:'#7b5ea7',backgroundColor:'#7b5ea718',borderWidth:2,pointRadius:2,fill:true,tension:.4}],opts:{scales:SO,plugins:{legend:{display:false}}}});
  }

  html+='<div style="text-align:center;margin-top:2rem;padding:1rem 0;border-top:1px solid var(--border);display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">'+
    '<button class="btn btn-success" onclick="downloadCleaned(\'csv\')">⬇ Download CSV</button>'+
    '<button class="btn btn-success" onclick="downloadCleaned(\'xlsx\')">⬇ Download XLSX</button></div>';

  document.getElementById('dashContent').innerHTML=html;

  requestAnimationFrame(()=>{
    defs.forEach(def=>{
      const canvas=document.getElementById(def.id);if(!canvas)return;
      const cfg={
        type:def.type,
        data:{labels:def.labels||[],datasets:def.datasets},
        options:{responsive:true,maintainAspectRatio:false,...def.opts}
      };
      // add drill click handlers
      if(def.drillCol){
        cfg.options.onClick=function(evt,els){
          if(!els.length)return;
          const idx=els[0].index;
          const label=def.labels[idx];
          const count=def.drillData[idx];
          const total=def.drillData.reduce((a,b)=>a+b,0);
          const dp=document.getElementById(def.id+'-drill');
          dp.innerHTML='<div class="drill-panel"><div class="drill-title">📌 '+label+'</div><div class="drill-stats">'+
            '<div class="drill-stat"><strong>'+count+'</strong>count</div>'+
            '<div class="drill-stat"><strong>'+Math.round(count/total*100)+'%</strong>of total</div>'+
            '<button class="col-act-btn" style="margin-top:.3rem" onclick="activeFilters[\''+def.drillCol+'\']='+"'"+label+"'"+';switchTab(\'upload\');setTimeout(renderPreview,100)">Filter →</button>'+
          '</div></div>';
        };
      }
      if(def.drillRows){
        cfg.options.onClick=function(evt,els){
          if(!els.length)return;
          const idx=els[0].datasetIndex===0?els[0].index:els[0].index;
          const row=def.drillRows[els[0].index];
          if(!row)return;
          const dp=document.getElementById(def.id+'-drill');
          dp.innerHTML='<div class="drill-panel"><div class="drill-title">📌 '+def.labels[els[0].index]+'</div><div class="drill-stats">'+
            '<div class="drill-stat"><strong>'+(row[def.drillH1]||0)+'</strong>'+def.drillH1+'</div>'+
            '<div class="drill-stat"><strong>'+(row[def.drillH2]||0)+'</strong>'+def.drillH2+'</div>'+
            '<div class="drill-stat"><strong>'+((parseFloat(row[def.drillH1])||0)-(parseFloat(row[def.drillH2])||0)).toFixed(2)+'</strong>difference</div>'+
          '</div></div>';
        };
      }
      dashCharts.push(new Chart(canvas,cfg));
    });
  });
}

// ── CHART BUILDER ──
const CICONS={bar:'▬',line:'↗',doughnut:'◎',pie:'◕',scatter:'⁙',radar:'⬡',polarArea:'◉',area:'▨'};
const CLABELS={bar:'Bar',line:'Line',doughnut:'Donut',pie:'Pie',scatter:'Scatter',radar:'Radar',polarArea:'Polar',area:'Area'};
const CTYPES=['bar','line','area','doughnut','pie','scatter','radar','polarArea'];

let cbSource='file',cbLabelCol=null,cbValueCols=[],cbActiveChart='bar',cbChartInst=null;
let meCols=['Label','Value'];
let meRows=[['Jan','120'],['Feb','85'],['Mar','200'],['Apr','150'],['May','95']];

function cbDetType(col){
  if(!cleanedData.length)return'text';
  const vals=cleanedData.map(r=>r[col]).filter(v=>v!==''&&v!=null);
  const nums=vals.filter(v=>!isNaN(parseFloat(v))&&isFinite(v));
  return nums.length/Math.max(vals.length,1)>.7?'numeric':'text';
}

function cbSetSource(src){
  cbSource=src;
  document.getElementById('srcBtnFile').classList.toggle('active',src==='file');
  document.getElementById('srcBtnManual').classList.toggle('active',src==='manual');
  document.getElementById('cbFileSource').style.display=src==='file'?'block':'none';
  document.getElementById('cbManualSource').style.display=src==='manual'?'block':'none';
  if(src==='file')cbPopulateColPicker();
}

function cbPopulateColPicker(){
  const noFile=document.getElementById('cbNoFile');
  const picker=document.getElementById('cbColPicker');
  if(!cleanedData.length||!headers.length){noFile.style.display='block';picker.style.display='none';return;}
  noFile.style.display='none';picker.style.display='block';
  document.getElementById('srcFileSub').textContent=cleanedData.length+' rows · '+headers.length+' cols';
  const textCols=headers.filter(h=>cbDetType(h)==='text');
  const numCols=headers.filter(h=>cbDetType(h)==='numeric');
  if(!cbLabelCol)cbLabelCol=textCols[0]||headers[0];
  if(!cbValueCols.length&&numCols.length)cbValueCols=[numCols[0]];

  const chip=(col,mode)=>{
    const type=cbDetType(col);
    const isl=cbLabelCol===col,isv=cbValueCols.includes(col);
    const cls=isl?'sel-label':isv?'sel-value':'';
    const role=isl?'<span class="cb-col-chip-role rl">LABEL</span>':isv?'<span class="cb-col-chip-role rv">VALUE</span>':'';
    const fn=mode==='label'?'cbPickLabel(\''+col+'\')':'cbToggleValue(\''+col+'\')';
    return '<div class="cb-col-chip '+cls+'" onclick="'+fn+'"><span class="cb-col-chip-name">'+col+'</span><span class="cb-col-chip-type">'+type+'</span>'+role+'</div>';
  };
  document.getElementById('cbLabelCols').innerHTML=headers.map(h=>chip(h,'label')).join('');
  document.getElementById('cbValueCols').innerHTML=numCols.length?numCols.map(h=>chip(h,'value')).join(''):'<div style="font-size:11px;color:var(--muted);padding:.4rem">No numeric columns detected</div>';
}

function cbPickLabel(col){cbLabelCol=col;cbPopulateColPicker();}
function cbToggleValue(col){
  if(cbValueCols.includes(col)){if(cbValueCols.length>1)cbValueCols=cbValueCols.filter(c=>c!==col);}
  else cbValueCols=[...cbValueCols,col];
  cbPopulateColPicker();
}

function cbSuggest(ns,rc,lc){
  if(ns>=3)return{chart:'radar',icon:'⬡',reason:ns+' numeric dimensions — radar overlays all metrics in one view.'};
  if(ns>=2)return{chart:'bar',icon:'▬',reason:ns+' numeric series — grouped bars make side-by-side comparison easy.'};
  if(lc<=6&&ns===1)return{chart:'doughnut',icon:'◎',reason:lc+' categories — donut clearly shows part-to-whole proportions.'};
  if(rc>10&&ns===1)return{chart:'line',icon:'↗',reason:rc+' data points in sequence — line chart communicates trend best.'};
  return{chart:'bar',icon:'▬',reason:'Bar chart is the most versatile default for categorical comparison.'};
}

function cbRenderTypeGrid(suggested){
  document.getElementById('cbChartTypePicker').style.display='block';
  document.getElementById('cbTypeGrid').innerHTML=CTYPES.map(t=>
    '<button class="cb-type-btn'+(t===cbActiveChart?' active':'')+(t===suggested?' suggested':'')+'" onclick="cbSelectType(\''+t+'\')">'+
      '<span class="cb-type-icon">'+CICONS[t]+'</span>'+
      '<span class="cb-type-name">'+CLABELS[t]+'</span>'+
    '</button>'
  ).join('');
}

function cbSelectType(t){
  cbActiveChart=t;
  document.querySelectorAll('.cb-type-btn').forEach(b=>b.classList.toggle('active',b.querySelector('.cb-type-name').textContent===CLABELS[t]));
  cbDrawChart();
}

function cbBuild(){
  if(cbSource==='file'){
    if(!cleanedData.length){alert('No cleaned file. Upload a file first.');return;}
    cbBuildFromFile();
  } else {
    cbSyncManual();cbBuildFromManual();
  }
}

function cbBuildFromFile(){
  const limit=document.getElementById('cbRowLimit').value;
  const sort=document.getElementById('cbSortBy').value;
  let rows=[...cleanedData];
  if(limit!=='all')rows=rows.slice(0,parseInt(limit));
  if(sort!=='none'&&cbValueCols.length){
    const vc=cbValueCols[0];
    rows.sort((a,b)=>{const va=parseFloat(a[vc])||0,vb=parseFloat(b[vc])||0;return sort==='asc'?va-vb:vb-va;});
  }
  const labelData=rows.map(r=>String(r[cbLabelCol]||'').slice(0,24));
  const seriesData=cbValueCols.map(col=>({name:col,data:rows.map(r=>parseFloat(r[col])||0)}));
  const sg=cbSuggest(seriesData.length,rows.length,new Set(labelData).size);
  if(cbActiveChart==='bar'&&sg.chart!=='bar')cbActiveChart=sg.chart;
  showSuggestion(sg);cbRenderTypeGrid(sg.chart);
  document.getElementById('cbChartTitle').textContent=(cbLabelCol||'')+' · '+cbValueCols.join(', ');
  document.getElementById('cbChartSub').textContent=rows.length+' rows';
  window._cbL=labelData;window._cbS=seriesData;cbDrawChart();
}

function cbBuildFromManual(){
  const types=meCols.map((_,ci)=>{
    const vals=meRows.map(r=>r[ci]).filter(v=>v!=='');
    const nums=vals.filter(v=>!isNaN(parseFloat(v))&&isFinite(v));
    return nums.length/Math.max(vals.length,1)>.7?'numeric':'text';
  });
  const li=types.findIndex(t=>t==='text');
  const nis=types.map((t,i)=>t==='numeric'?i:-1).filter(i=>i>=0);
  const vrows=meRows.filter(r=>r.some(c=>c!==''));
  const labelData=vrows.map(r=>r[li>=0?li:0]||'');
  const seriesData=nis.map(ci=>({name:meCols[ci],data:vrows.map(r=>parseFloat(r[ci])||0)}));
  const sg=cbSuggest(seriesData.length,vrows.length,new Set(labelData).size);
  if(cbActiveChart==='bar')cbActiveChart=sg.chart;
  showSuggestion(sg);cbRenderTypeGrid(sg.chart);
  document.getElementById('cbChartTitle').textContent=meCols.join(' · ');
  document.getElementById('cbChartSub').textContent=vrows.length+' data points';
  window._cbL=labelData;window._cbS=seriesData;cbDrawChart();
}

function showSuggestion(sg){
  document.getElementById('cbSuggestion').style.display='flex';
  document.getElementById('cbSugIcon').textContent=sg.icon;
  document.getElementById('cbSugTitle').textContent=CLABELS[sg.chart]+' recommended';
  document.getElementById('cbSugReason').textContent=sg.reason;
}

function cbDrawChart(){
  document.getElementById('cbChartCard').style.display='block';
  if(cbChartInst){cbChartInst.destroy();cbChartInst=null;}
  const canvas=document.getElementById('cbChart');
  const labels=window._cbL||[];
  const series=window._cbS||[];
  const t=cbActiveChart;
  const lo=show=>({display:show,labels:{color:'rgba(107,107,153,.9)',font:{size:9,family:"'Space Mono',monospace"},boxWidth:9}});
  let cfg;
  if(t==='doughnut'||t==='pie'){
    const vals=series.length?series[0].data:[];
    cfg={type:t==='pie'?'pie':'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:CC.map(c=>c+'cc'),borderColor:CC,borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:lo(true)},cutout:t==='doughnut'?'58%':0}};
  } else if(t==='radar'){
    cfg={type:'radar',data:{labels,datasets:series.map((s,i)=>({label:s.name,data:s.data,borderColor:CC[i%CC.length],backgroundColor:CC[i%CC.length]+'22',pointBackgroundColor:CC[i%CC.length],borderWidth:2}))},options:{responsive:true,maintainAspectRatio:false,scales:{r:{grid:{color:'rgba(255,255,255,.08)'},pointLabels:{color:'rgba(107,107,153,.9)',font:{size:9}},ticks:{color:'rgba(107,107,153,.6)',backdropColor:'transparent',font:{size:8}}}},plugins:{legend:lo(series.length>1)}}};
  } else if(t==='scatter'){
    const xs=series[0]?series[0].data:[];const ys=series[1]?series[1].data:xs.map((_,i)=>i);
    cfg={type:'scatter',data:{datasets:[{data:xs.map((x,i)=>({x,y:ys[i]})),backgroundColor:'#00f5c444',borderColor:'#00f5c4',pointRadius:4,borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:SO}};
  } else if(t==='polarArea'){
    const vals=series.length?series[0].data:[];
    cfg={type:'polarArea',data:{labels,datasets:[{data:vals,backgroundColor:CC.map(c=>c+'99'),borderColor:CC,borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{grid:{color:'rgba(255,255,255,.07)'},ticks:{color:'rgba(107,107,153,.7)',backdropColor:'transparent',font:{size:8}}}},plugins:{legend:lo(true)}}};
  } else if(t==='line'||t==='area'){
    cfg={type:'line',data:{labels,datasets:series.map((s,i)=>({label:s.name,data:s.data,borderColor:CC[i%CC.length],backgroundColor:CC[i%CC.length]+(t==='area'?'28':'10'),borderWidth:2,pointRadius:2,fill:t==='area',tension:.4}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:lo(series.length>1)},scales:SO}};
  } else {
    cfg={type:'bar',data:{labels,datasets:series.map((s,i)=>({label:s.name,data:s.data,backgroundColor:CC[i%CC.length]+'33',borderColor:CC[i%CC.length],borderWidth:1}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:lo(series.length>1)},scales:SO}};
  }
  cbChartInst=new Chart(canvas,cfg);
}

// ── manual table ──
function meRender(){
  const wrap=document.getElementById('meTableWrap');if(!wrap)return;
  let h='<table class="me-table"><thead><tr>';
  meCols.forEach((c,ci)=>{
    h+='<th><div class="th-wrap"><input type="text" value="'+esc(c)+'" onchange="meCols['+ci+']=this.value" placeholder="Col '+(ci+1)+'">';
    if(meCols.length>1)h+='<button class="th-del" onclick="meDelCol('+ci+')">×</button>';
    h+='</div></th>';
  });
  h+='<th style="width:24px"></th></tr></thead><tbody>';
  meRows.forEach((row,ri)=>{
    h+='<tr>';
    meCols.forEach((_,ci)=>{h+='<td><input type="text" value="'+esc(row[ci]||'')+'" onchange="meRows['+ri+']['+ci+']=this.value" placeholder="—"></td>';});
    h+='<td class="rdel"><button class="rdel-btn" onclick="meDelRow('+ri+')">×</button></td></tr>';
  });
  h+='</tbody></table>';
  wrap.innerHTML=h;
}
function meAddColumn(){meCols.push('Col '+(meCols.length+1));meRows=meRows.map(r=>[...r,'']);meRender();}
function meAddRow(){meRows.push(meCols.map(()=>''));meRender();}
function meDelCol(ci){if(meCols.length<=1)return;meCols.splice(ci,1);meRows=meRows.map(r=>{r.splice(ci,1);return r;});meRender();}
function meDelRow(ri){if(meRows.length<=1)return;meRows.splice(ri,1);meRender();}
function meClear(){meCols=['Label','Value'];meRows=[['',''],['',''],['','']];meRender();['cbSuggestion','cbChartTypePicker','cbChartCard'].forEach(id=>{document.getElementById(id).style.display='none';});}
function cbSyncManual(){
  const tbl=document.querySelector('.me-table');if(!tbl)return;
  tbl.querySelectorAll('thead input').forEach((inp,ci)=>{if(meCols[ci]!==undefined)meCols[ci]=inp.value||meCols[ci];});
  tbl.querySelectorAll('tbody tr').forEach((tr,ri)=>{tr.querySelectorAll('td input').forEach((inp,ci)=>{if(meRows[ri])meRows[ri][ci]=inp.value;});});
}


// ── error detection ──
let rawErrors=[];
function detectRawErrors(){
  rawErrors=[];
  const seen=new Set();
  const numericCols=new Set();
  headers.forEach(h=>{
    const vals=rawData.map(r=>r[h]).filter(v=>v!==''&&v!=null);
    const nums=vals.filter(v=>!isNaN(parseFloat(v))&&isFinite(v));
    if(nums.length/Math.max(vals.length,1)>.7)numericCols.add(h);
  });
  rawData.forEach((row,ri)=>{
    const k=JSON.stringify(row);
    if(seen.has(k)){rawErrors.push({row:ri+2,type:'Duplicate Row',column:'(all)',value:'Exact duplicate',original:row});}
    else seen.add(k);
    headers.forEach(h=>{
      const v=row[h];
      if(v===''||v===null||v===undefined){rawErrors.push({row:ri+2,type:'Missing Value',column:h,value:'(empty)',original:row});}
      else{
        const sv=String(v);
        if(sv!==sv.trim())rawErrors.push({row:ri+2,type:'Whitespace Issue',column:h,value:JSON.stringify(sv),original:row});
        if(numericCols.has(h)&&(isNaN(parseFloat(v))||!isFinite(v)))rawErrors.push({row:ri+2,type:'Type Mismatch',column:h,value:sv,original:row});
      }
    });
  });
  const bar=document.getElementById('errReportBar');
  if(rawErrors.length){
    bar.style.display='flex';
    document.getElementById('errReportLabel').textContent=rawErrors.length+' issue'+(rawErrors.length!==1?'s':'')+' found in '+rawData.length+' rows';
  } else bar.style.display='none';
}

function buildErrorMap(){
  const map={};const dupRows=new Set();const seen=new Set();
  const numericCols=new Set();
  headers.forEach(h=>{
    const vals=rawData.map(r=>r[h]).filter(v=>v!==''&&v!=null);
    const nums=vals.filter(v=>!isNaN(parseFloat(v))&&isFinite(v));
    if(nums.length/Math.max(vals.length,1)>.7)numericCols.add(h);
  });
  rawData.forEach((row,ri)=>{const k=JSON.stringify(row);if(seen.has(k))dupRows.add(ri);else seen.add(k);});
  rawData.forEach((row,ri)=>{
    map[ri]={};
    headers.forEach(h=>{
      const errs=[];const v=row[h];
      if(dupRows.has(ri))errs.push('err-duplicate');
      if(v===''||v===null||v===undefined)errs.push('err-missing');
      else{const sv=String(v);if(sv!==sv.trim())errs.push('err-whitespace');if(numericCols.has(h)&&(isNaN(parseFloat(v))||!isFinite(v)))errs.push('err-typemismatch');}
      map[ri][h]=errs;
    });
  });
  return{map,dupRows};
}

function showErrorPreview(){
  const sec=document.getElementById('errorPreviewSection');
  sec.style.display='block';sec.scrollIntoView({behavior:'smooth',block:'nearest'});
  const{map,dupRows}=buildErrorMap();
  let html='<table><thead><tr><th style="font-family:\'Space Mono\',monospace;font-size:9px;color:var(--muted);padding:9px 8px">#</th>'+
    headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>';
  rawData.slice(0,200).forEach((row,ri)=>{
    html+='<tr'+(dupRows.has(ri)?' class="err-dup-row"':'')+'>';
    html+='<td style="font-family:\'Space Mono\',monospace;font-size:9px;color:var(--muted);padding:8px;text-align:right;min-width:32px">'+(ri+2)+'</td>';
    headers.forEach(h=>{
      const errs=map[ri][h]||[];
      const v=row[h];
      const dv=v===''||v===null||v===undefined?'(empty)':String(v).slice(0,40);
      const errClass=errs.length?' err-cell '+errs.join(' '):'';
      const label=errs.map(e=>e==='err-missing'?'Missing':e==='err-duplicate'?'Duplicate row':e==='err-whitespace'?'Whitespace':'Type mismatch').join(', ');
      const tip=label?'<span class="err-cell-tooltip">⚠ '+label+'</span>':'';
      html+='<td class="'+errClass+'" title="'+esc(label||String(v||''))+'">'+esc(dv)+tip+'</td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('errorPreviewTable').innerHTML=html;
}

async function downloadRawWithErrorSheet(){
  if(!rawErrors.length){alert('No errors found in this file.');return;}
  const{map,dupRows}=buildErrorMap();
  const ERR_STYLES={'err-missing':{fill:'FFFFE0E0',font:'FFC0392B',label:'Missing value'},'err-duplicate':{fill:'FFFFF3CD',font:'FF856404',label:'Duplicate row'},'err-whitespace':{fill:'FFEDE9FE',font:'FF5B21B6',label:'Whitespace issue'},'err-typemismatch':{fill:'FFFFD6D6',font:'FF991B1B',label:'Type mismatch'}};
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('Original Data (Errors Highlighted)');
  const hdr=ws.addRow(['#',...headers]);
  hdr.eachCell(c=>{c.font={bold:true,color:{argb:'FF00F5C4'},name:'Consolas',size:10};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0D0D1F'}};});
  ws.getColumn(1).width=6;headers.forEach((_,ci)=>{ws.getColumn(ci+2).width=16;});
  rawData.forEach((row,ri)=>{
    const exRow=ws.addRow([ri+2,...headers.map(h=>{const v=row[h];return(v===''||v===null||v===undefined)?'':v;})]);
    headers.forEach((h,ci)=>{
      const cell=exRow.getCell(ci+2);const errs=map[ri][h]||[];
      if(errs.length){
        const p=['err-missing','err-typemismatch','err-duplicate','err-whitespace'];
        const top=p.find(e=>errs.includes(e))||errs[0];
        const st=ERR_STYLES[top];
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:st.fill}};
        cell.font={color:{argb:st.font},name:'Consolas',size:9};
        cell.note={texts:[{font:{size:9},text:'⚠ '+errs.map(e=>ERR_STYLES[e]?.label||e).join(' + ')}]};
      } else{cell.font={color:{argb:'FFCCCCEE'},name:'Consolas',size:9};}
    });
    exRow.getCell(1).font={color:{argb:'FF666688'},size:8,name:'Consolas'};
  });
  ws.views=[{state:'frozen',ySplit:1}];
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='error_report_'+fileName.replace(/\.[^.]+$/,'')+'.xlsx';a.click();URL.revokeObjectURL(url);
}

// ── sample data ──
function loadSampleData(){
  fileName='sample_sales_data.csv';
  rawData=[
    {Region:'North',Product:'Widget A',Sales:1200,Units:34,Date:'2024-01-15',Rep:'Alice'},
    {Region:'South',Product:'Widget B',Sales:850,Units:21,Date:'2024-01-16',Rep:'Bob'},
    {Region:'North',Product:'Widget A',Sales:1200,Units:34,Date:'2024-01-15',Rep:'Alice'},
    {Region:'East',Product:'Gadget X',Sales:'',Units:15,Date:'2024-01-17',Rep:'Carol'},
    {Region:'West',Product:'Gadget Y',Sales:600,Units:12,Date:'2024-01-18',Rep:'  Dave  '},
    {Region:'East',Product:'Gadget X',Sales:910,Units:25,Date:'2024-01-19',Rep:'Carol'},
    {Region:'South',Product:'Widget B',Sales:'N/A',Units:8,Date:'2024-01-20',Rep:'Bob'},
    {Region:'North',Product:'Gadget Z',Sales:2100,Units:55,Date:'2024-01-21',Rep:'Alice'},
    {Region:'West',Product:'Widget A',Sales:780,Units:'',Date:'2024-01-22',Rep:'Eve'},
    {Region:'East',Product:'Gadget Y',Sales:1340,Units:31,Date:'2024-01-23',Rep:'Carol'},
    {Region:'North',Product:'Gadget X',Sales:990,Units:27,Date:'2024-01-24',Rep:'Alice'},
    {Region:'South',Product:'Widget A',Sales:430,Units:11,Date:'2024-01-25',Rep:'Bob'},
  ];
  headers=Object.keys(rawData[0]);
  document.getElementById('fileIconEl').textContent='📄';
  document.getElementById('fileNameEl').textContent='sample_sales_data.csv (demo)';
  document.getElementById('fileMetaEl').textContent=rawData.length+' rows · '+headers.length+' columns';
  document.getElementById('fileInfoArea').style.display='block';
  document.getElementById('onboardGrid').style.display='none';
  document.getElementById('cleaningResults').style.display='none';
  detectRawErrors();
}

async function saveDatasetAnalysis(){
  if(!window.DataStudioAPI||!cleanedData.length)return;
  try{
    const payload={
      fileName,
      originalRows:rawData.length,
      rows:cleanedData.slice(0,500),
      cleaningOptions:{...cleanOpts}
    };
    const result=await window.DataStudioAPI.analyzeDataset(payload);
    console.info('Dataset analysis saved:',result.dataset&&result.dataset.id);
  }catch(err){
    console.warn('Dataset analysis was not saved:',err.message);
  }
}
// ── contact modal ──
function openContact(){document.getElementById('contactModal').style.display='flex';document.body.style.overflow='hidden';}
function closeContact(){document.getElementById('contactModal').style.display='none';document.body.style.overflow='';}
async function submitContact(){
  const name=document.getElementById('cName').value.trim();
  const email=document.getElementById('cEmail').value.trim();
  const message=document.getElementById('cMsg').value.trim();
  if(!name||!email){alert('Please fill in your name and email.');return;}
  try{
    if(window.DataStudioAPI){
      await window.DataStudioAPI.submitContact({name,email,message,source:'portfolio-contact'});
    }
    alert('Thanks '+name+'! I\'ll get back to you at '+email+' shortly.');
    closeContact();
    document.getElementById('cName').value='';document.getElementById('cEmail').value='';document.getElementById('cMsg').value='';
  }catch(err){
    console.error(err);
    alert('Your message could not be sent right now. Please email hello@example.com directly.');
  }
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeContact();});

async function loadSignedInUser(){
  if(!window.DataStudioAPI)return;
  try{
    const result=await window.DataStudioAPI.me();
    const user=result.user||{};
    const label=document.getElementById('signedInUser');
    if(label)label.textContent=user.name||user.email||'Signed in';
  }catch(err){
    window.location.href='/login';
  }
}

async function logoutUser(){
  try{
    if(window.DataStudioAPI)await window.DataStudioAPI.logout();
  }finally{
    window.location.href='/login';
  }
}
// init
loadSignedInUser();
meRender();
cbPopulateColPicker();





