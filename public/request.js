const $=id=>document.getElementById(id);let config,widget,submissionKey=crypto.randomUUID();
function message(text){$('request-message').textContent=text;}
async function showReceipt(id,token){
 $('request-form').hidden=true;$('receipt').hidden=false;
 const url=new URL(location.href);url.hash=new URLSearchParams({id,token}).toString();history.replaceState(null,'',url);
 const a=document.createElement('a');a.href=url;a.textContent='Private status link — bookmark this page';$('receipt-link').replaceChildren(a);
 async function refresh(){try{const r=await fetch('/api/access/status/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Status unavailable');$('receipt-status').textContent='Status: '+data.status.replaceAll('_',' ');message(data.status==='delivered'?'Approved: Drive access has been confirmed.':data.status==='pending'?'Pending administrator review. No Drive access has been granted.':data.status==='denied'?'This request was not approved. Contact the team if you need clarification.':'Approval recorded; Drive delivery is not yet confirmed.');if(data.access_url&&!document.getElementById('approved-drive-link')){const u=new URL(data.access_url);if(u.origin==='https://drive.google.com'&&u.pathname.startsWith('/drive/folders/')){const a=document.createElement('a');a.id='approved-drive-link';a.href=u.href;a.textContent='Open your approved dataset on Drive ↗';a.className='button';$('receipt').append(a);}}}catch(e){$('receipt-status').textContent=e.message;}}
 $('refresh-status').onclick=refresh;await refresh();
}
async function start(){
 const fragment=new URLSearchParams(location.hash.slice(1));if(fragment.has('id')&&fragment.has('token')){message('Your private request receipt.');return showReceipt(fragment.get('id'),fragment.get('token'));}
 try{const response=await fetch('/api/access/config',{cache:'no-store'});config=await response.json();if(!response.ok||!config.enabled){message('Online requests are not enabled.');$('fallback').hidden=false;return;}
 $('agreement-link').href=config.agreement.url;$('request-form').elements.agreement_version.value=config.agreement.version;
 $('request-form').hidden=false;message('Your request remains pending until an administrator approves it.');
 let tries=0;const timer=setInterval(()=>{if(window.turnstile){clearInterval(timer);widget=window.turnstile.render('#bot-check',{sitekey:config.turnstile_site_key,action:'eula-request',callback:()=>{$('submit-request').disabled=false;},'expired-callback':()=>{$('submit-request').disabled=true;}});}else if(++tries>50){clearInterval(timer);message('Bot verification could not load. Please use the existing email process.');$('fallback').hidden=false;}},200);
 }catch{message('Online requests are currently unavailable.');$('fallback').hidden=false;}
}
$('request-form').addEventListener('submit',async event=>{event.preventDefault();const file=event.currentTarget.elements.signed_eula.files[0];if(!file||file.size>config.max_pdf_bytes){message('Attach a signed PDF of at most 1 MB.');return;}$('submit-request').disabled=true;message('Submitting your request…');try{const r=await fetch('/api/access/requests',{method:'POST',headers:{'Idempotency-Key':submissionKey},body:new FormData(event.currentTarget)});const data=await r.json();if(!r.ok)throw Error(data.error||'Submission was not confirmed');message(data.replayed?'Existing submission recovered.':'Request recorded; no Drive access has been granted.');await showReceipt(data.id,data.receipt_token);}catch(e){message(e.message);if(window.turnstile)window.turnstile.reset(widget);}});
start();
