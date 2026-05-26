document.addEventListener('mousemove',e=>{const g=document.getElementById('glow');if(g){g.style.left=e.clientX+'px';g.style.top=e.clientY+'px';}});
const fmtDate=value=>value?new Date(value).toLocaleString():'';
const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function request(url){const res=await fetch(url);const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||'Request failed');return body;}
function stat(label,value,sub){return `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${sub||''}</small></div>`;}
async function loadAdmin(){
  try{
    const data=await request('/api/admin/stats');
    document.getElementById('storageMode').textContent=data.storeMode.toUpperCase();
    document.getElementById('statsGrid').innerHTML=[
      stat('Users',data.totals.users,`${data.recent.users7d} new this week`),
      stat('Logins',data.totals.logins,`${data.totals.appVisits} workspace visits`),
      stat('Datasets',data.totals.datasets,`${data.recent.datasets7d} this week`),
      stat('Contacts',data.totals.contacts,`${data.recent.contacts7d} this week`)
    ].join('');
    document.getElementById('usersTable').innerHTML=(data.latestUsers||[]).map(u=>`<tr><td>${esc(u.name||'--')}</td><td>${esc(u.email||'--')}</td><td>${esc(u.provider)}</td><td>${u.loginCount||0}</td><td>${esc(fmtDate(u.lastSeenAt))}</td></tr>`).join('')||'<tr><td colspan="5">No users yet</td></tr>';
    document.getElementById('contactsList').innerHTML=(data.latestContacts||[]).map(c=>`<div class="item"><strong>${esc(c.name)}</strong><span>${esc(c.email)}</span><span>${esc(c.message||'No message')}</span></div>`).join('')||'<div class="empty">No contacts yet</div>';
    document.getElementById('datasetsList').innerHTML=(data.latestDatasets||[]).map(d=>`<div class="item"><strong>${esc(d.fileName)}</strong><span>${d.cleanedRows||0} rows · ${d.summary?.columnCount||0} columns</span><span>${esc(fmtDate(d.createdAt))}</span></div>`).join('')||'<div class="empty">No datasets yet</div>';
  }catch(err){
    if(err.message.includes('Login'))location.href='/login';
    else document.getElementById('statsGrid').innerHTML=`<div class="empty">${esc(err.message)}</div>`;
  }
}
async function exportData(){
  const data=await request('/api/admin/export');
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='datastudio-admin-export.json';a.click();URL.revokeObjectURL(url);
}
async function logoutAdmin(){await fetch('/auth/logout',{method:'POST'});location.href='/login';}
loadAdmin();
