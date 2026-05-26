document.addEventListener('mousemove',e=>{const g=document.getElementById('glow');if(g){g.style.left=e.clientX+'px';g.style.top=e.clientY+'px';}});

(async function(){
  const box=document.getElementById('configBox');
  const users=document.getElementById('metricUsers');
  const params=new URLSearchParams(location.search);
  const error=params.get('error');
  try{
    const res=await fetch('/api/auth/config');
    const cfg=await res.json();
    const google=document.querySelector('.auth-btn.google');
    const apple=document.querySelector('.auth-btn.apple');
    if(google&&!cfg.googleConfigured){google.classList.add('disabled');google.removeAttribute('href');google.setAttribute('aria-disabled','true');}
    if(apple&&!cfg.appleConfigured){apple.classList.add('disabled');apple.removeAttribute('href');apple.setAttribute('aria-disabled','true');}
    if(error){
      box.innerHTML='Login is not ready yet: <code>'+error.replace(/_/g,' ')+'</code>';
    }else if(cfg.googleConfigured||cfg.appleConfigured){
      box.classList.add('ready');
      box.textContent='Login is configured. Choose an available provider to continue.';
    }else{
      box.innerHTML='Login UI is ready. Configure Google or Apple credentials before production by setting environment variables, then run <code>npm start</code>.';
    }
    if(users)users.textContent=cfg.totalUsers||0;
  }catch(err){
    box.textContent='Could not check login configuration.';
  }
})();
