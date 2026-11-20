import {requireReviewer,requireSameOrigin,sha256,base64url} from './auth.js';
import {DriveDelivery} from './drive.js';
import {ApprovalService} from './approval.js';
import {auditStatement} from './audit.js';
import {HistoricalArchive,historicalMetadata} from './history.js';
import AGREEMENT from '../config/agreement.json' with {type:'json'};
export {AGREEMENT};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PDF=1_000_000;
const HEADERS={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'};
function json(value,status=200){return Response.json(value,{status,headers:HEADERS});}
function bad(message,status=400){const e=Error(message);e.status=status;throw e;}
function policy(env){return {reviewerEmails:(env.APPROVER_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),releaseId:env.RELEASE_ID,agreementVersion:AGREEMENT.version,agreementSha256:AGREEMENT.sha256};}
export function readiness(env){
 const review=!!(env.ACCESS_DB&&env.ACCESS_ISSUER&&env.ACCESS_AUDIENCE&&policy(env).reviewerEmails.length&&env.RELEASE_ID);
 const delivery=review&&env.DELIVERY_ENABLED==='true'&&env.SCOPE_CONFIRMED==='true'&&!!(env.DRIVE_FOLDER_ID&&env.GOOGLE_CLIENT_EMAIL&&env.GOOGLE_PRIVATE_KEY);
 const intake=delivery&&env.REQUESTS_ENABLED==='true'&&!!(env.TURNSTILE_SECRET_KEY&&env.TURNSTILE_SITE_KEY&&env.INTAKE_RATE_SECRET&&env.PUBLIC_ORIGIN);
 return {review,delivery,intake};
}
function safeRow(row){if(!row)return null;const {signature_bytes,receipt_hash,submission_key,delivery_claim,...rest}=row;return rest;}
function text(form,name,min,max){const value=String(form.get(name)||'').trim();if(value.length<min||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))bad('Invalid '+name);return value;}
async function boundedBody(request,limit){
 const reader=request.body?.getReader();if(!reader)bad('Request body required');const chunks=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();bad('Submission too large',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function receiptToken(id,key,secret){
 const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return base64url(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(id+'|'+key)));
}
async function submit(request,env,fetcher){
 if(!readiness(env).intake)bad('Online requests are not enabled. Please use the existing EULA email process.',503);
 const capacity=await env.ACCESS_DB.prepare('SELECT (SELECT count(*) FROM access_requests)+(SELECT count(*) FROM historical_records) AS total').first();if(capacity.total>=250)bad('Online request capacity reached; please use the email process.',429);
 requireSameOrigin(request);if(new URL(request.url).origin!==env.PUBLIC_ORIGIN)bad('Unexpected request origin',403);
 const bytes=await boundedBody(request,MAX_PDF+40000);
 const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')||''},body:bytes}).formData();
 const submissionKey=request.headers.get('Idempotency-Key');if(!UUID.test(submissionKey||''))bad('A valid submission key is required');
 const name=text(form,'name',2,200),email=text(form,'email',5,254).toLowerCase(),institution=text(form,'institution',2,300),purpose=text(form,'purpose',20,4000);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))bad('A valid institutional email is required');
 if(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','hotmail.com','outlook.com','live.com','icloud.com','aol.com','proton.me','protonmail.com'].includes(email.split('@')[1]))bad('The official EULA requires an institutional email');
 if(form.get('agreement_version')!==AGREEMENT.version||form.get('acknowledged')!=='yes')bad('Please read the current official agreement and attach its completed signed PDF');
 const file=form.get('signed_eula');if(!file||typeof file.arrayBuffer!=='function'||file.size<100||file.size>MAX_PDF)bad('A signed PDF of at most 1 MB is required');
 const pdf=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-')bad('The attachment must be a PDF');
 const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{redirect:'manual',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:String(form.get('cf-turnstile-response')||'')}),signal:AbortSignal.timeout(15000)});
 const challenge=await response.json();if(!response.ok||!challenge.success||challenge.hostname!==new URL(env.PUBLIC_ORIGIN).hostname||challenge.action!=='eula-request')bad('Bot verification failed; please try again',403);
 const signatureHash=await sha256(pdf),keyHash=await sha256(submissionKey);
 const prior=await env.ACCESS_DB.prepare('SELECT id,recipient_email,signature_sha256,release_id,agreement_version,status FROM access_requests WHERE submission_key=?').bind(keyHash).first();
 if(prior){if(prior.recipient_email!==email||prior.signature_sha256!==signatureHash||prior.release_id!==env.RELEASE_ID||prior.agreement_version!==AGREEMENT.version)bad('Submission key was used for different request details',409);return json({id:prior.id,receipt_token:await receiptToken(prior.id,submissionKey,env.INTAKE_RATE_SECRET),status:prior.status,replayed:true});}
 const id=crypto.randomUUID(),token=await receiptToken(id,submissionKey,env.INTAKE_RATE_SECRET),now=new Date().toISOString(),day=now.slice(0,10);
 const bucket=await sha256(env.INTAKE_RATE_SECRET+'|'+day+'|'+(request.headers.get('CF-Connecting-IP')||'unknown'));
 const receiptHash=await sha256(token);
 await env.ACCESS_DB.batch([
  env.ACCESS_DB.prepare("INSERT INTO intake_rate_buckets(bucket,day,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<5").bind(bucket,day),
  env.ACCESS_DB.prepare("INSERT INTO access_requests(id,recipient_email,applicant_name,institution,intended_use,release_id,agreement_version,signature_reference,signature_sha256,signature_bytes,receipt_hash,agreement_sha256,created_at,submission_key) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1 AND (SELECT count(*) FROM access_requests)+(SELECT count(*) FROM historical_records)<250").bind(id,email,name,institution,purpose,env.RELEASE_ID,AGREEMENT.version,'uploaded-pdf:'+id,signatureHash,pdf.buffer,receiptHash,AGREEMENT.sha256,now,keyHash),
  auditStatement(env.ACCESS_DB,{requestId:id,event:'request_submitted',actor:email,kind:'applicant_claimed',details:{signatureHash,agreementSha256:AGREEMENT.sha256,release:env.RELEASE_ID,institutionalIdentityVerified:false}},true)
 ]);
 const row=await env.ACCESS_DB.prepare('SELECT id FROM access_requests WHERE id=?').bind(id).first();if(!row)bad('Request capacity or daily limit reached. Please use the existing email process.',429);
 return json({id,receipt_token:token,status:'pending',message:'Request recorded for human review. No Drive access has been granted.'},201);
}
async function requestJson(request){const bytes=await boundedBody(request,10000);if(!request.headers.get('content-type')?.startsWith('application/json'))bad('JSON required',415);return JSON.parse(new TextDecoder().decode(bytes));}
export async function accessApi(request,env,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;
 try{
  if(path==='/api/access/config'&&request.method==='GET')return json({enabled:readiness(env).intake,agreement:AGREEMENT,turnstile_site_key:readiness(env).intake?env.TURNSTILE_SITE_KEY:null,max_pdf_bytes:MAX_PDF});
  if(path==='/api/access/requests'&&request.method==='POST')return await submit(request,env,fetcher);
  if(path.startsWith('/api/access/status/')&&request.method==='GET'){
   const id=path.split('/').at(-1),token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!UUID.test(id)||!token||!env.ACCESS_DB)bad('Receipt not found',404);
   const row=await env.ACCESS_DB.prepare('SELECT status,created_at,reviewed_at,delivered_at,granted_folder_id FROM access_requests WHERE id=? AND receipt_hash=?').bind(id,await sha256(token)).first();if(!row)bad('Receipt not found',404);const {granted_folder_id,...state}=row;if(row.status==='delivered'&&granted_folder_id)state.access_url='https://drive.google.com/drive/folders/'+encodeURIComponent(granted_folder_id);return json(state);
  }
  if(!path.startsWith('/api/review/'))return null;
  if(!readiness(env).review)bad('Private review dashboard is not configured',503);
  let actor;try{actor=await requireReviewer(request,env,fetcher);}catch(error){
   const reasons={'Reviewer authentication is not configured':'AUTH_CONFIG','Reviewer sign-in required':'AUTH_TOKEN_MISSING','Invalid reviewer token':'AUTH_TOKEN_INVALID','Reviewer signing keys unavailable':'AUTH_KEYS_UNAVAILABLE','Unknown reviewer signing key':'AUTH_KEY_UNKNOWN','Invalid reviewer signature':'AUTH_SIGNATURE_INVALID','Reviewer identity or token validity rejected':'AUTH_CLAIMS_REJECTED'};
   bad('Authorised administrator sign-in required ('+(reasons[error.message]||(/^AUTH_[A-Z_]+$/.test(error.code||'')?error.code:'AUTH_VALIDATION_ERROR'))+')',401);
  }
  if(path==='/api/review/historical'||path.startsWith('/api/review/historical/')){
   const archive=new HistoricalArchive(env.ACCESS_DB);
   if(path==='/api/review/historical'){
    if(request.method==='GET')return json({records:await archive.list(),actor:actor.email});
    if(request.method!=='POST')bad('Method not allowed',405);
    requireSameOrigin(request);
    const bytes=await boundedBody(request,MAX_PDF+40000);
    const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')||''},body:bytes}).formData();
    const result=await archive.import(form,actor);return json(result,result.replayed?200:201);
   }
   const match=path.match(/^\/api\/review\/historical\/([^/]+)(?:\/(evidence|contacts))?$/);
   if(!match||!UUID.test(match[1]))bad('Not found',404);
   const [,id,action]=match,row=await archive.get(id);if(!row)bad('Not found',404);
   if(action==='contacts'&&request.method==='POST'){
    requireSameOrigin(request);return json(await archive.recordContacts(id,await requestJson(request),actor));
   }
   if(request.method!=='GET')bad('Historical records cannot grant or retry access',405);
   if(action==='evidence'){
    if(await sha256(new Uint8Array(row.signature_bytes))!==row.signature_sha256)bad('Historical PDF integrity check failed',500);
    await auditStatement(env.ACCESS_DB,{event:'historical_eula_downloaded',actor:actor.email,details:{historicalId:id,documentSha256:row.signature_sha256}}).run();
    return new Response(new Uint8Array(row.signature_bytes),{headers:{...HEADERS,'content-type':'application/octet-stream','content-disposition':`attachment; filename="historical-eula-${id}.pdf"`,'content-security-policy':"sandbox; default-src 'none'"}});
   }
   await auditStatement(env.ACCESS_DB,{event:'historical_record_viewed',actor:actor.email,details:{historicalId:id}}).run();
   return json({record:historicalMetadata(row),contact_annotation:await archive.contacts(id),events:await archive.events(id),actor:actor.email});
  }
  const service=new ApprovalService(env.ACCESS_DB,new DriveDelivery({clientEmail:env.GOOGLE_CLIENT_EMAIL,privateKey:env.GOOGLE_PRIVATE_KEY,folderId:env.DRIVE_FOLDER_ID,releaseId:env.RELEASE_ID},fetcher),policy(env));
  if(path==='/api/review/connection-check'&&request.method==='POST'){
   requireSameOrigin(request);
   if(!env.GOOGLE_CLIENT_EMAIL||!env.GOOGLE_PRIVATE_KEY||!env.DRIVE_FOLDER_ID)bad('Drive credentials are not configured',503);
   try{
    const drive=await service.drive.inspect();
    await auditStatement(env.ACCESS_DB,{event:'drive_connection_checked',actor:actor.email,details:{release:env.RELEASE_ID,...drive}}).run();
    return json({drive,configuration:readiness(env)});
   }catch(error){
    const code=/^[A-Z][A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:'CONNECTION_UNCONFIRMED';
    await auditStatement(env.ACCESS_DB,{event:'drive_connection_failed',actor:actor.email,details:{release:env.RELEASE_ID,error:code}}).run();
    return json({error:'Drive connection check failed: '+code+'. No permissions were changed.'},502);
   }
  }
  if(path==='/api/review/requests'&&request.method==='GET'){
   const result=await env.ACCESS_DB.prepare('SELECT id,recipient_email,applicant_name,institution,status,created_at,reviewer_email,reviewed_at FROM access_requests ORDER BY created_at DESC LIMIT 250').all();
   return json({requests:result.results,actor:actor.email,delivery_enabled:readiness(env).delivery});
  }
  if(path==='/api/review/audit'&&request.method==='GET'){
   const id=url.searchParams.get('request');if(id&&!UUID.test(id))bad('Invalid request ID');
   const numeric=(name,fallback)=>{const raw=url.searchParams.get(name);if(raw===null)return fallback;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))bad('Invalid audit cursor');return Number(raw);};
   const max=(await env.ACCESS_DB.prepare('SELECT COALESCE(MAX(id),0) AS value FROM access_events').first()).value;
   const after=numeric('after',0),through=Math.min(numeric('through',max),max);if(after>through)bad('Invalid audit range');
   const query=id?env.ACCESS_DB.prepare('SELECT * FROM access_events WHERE request_id=? AND id>? AND id<=? ORDER BY id LIMIT 501').bind(id,after,through):env.ACCESS_DB.prepare('SELECT * FROM access_events WHERE id>? AND id<=? ORDER BY id LIMIT 501').bind(after,through);
   const result=await query.all(),events=result.results.slice(0,500);
   if(after===0)await auditStatement(env.ACCESS_DB,{event:'audit_exported',actor:actor.email,details:{request:id,snapshotThrough:through}}).run();
   return json({events,through,next_cursor:result.results.length>500?events.at(-1).id:null});
  }
  const match=path.match(/^\/api\/review\/requests\/([^/]+)(?:\/(evidence|decision|retry))?$/);if(!match||!UUID.test(match[1]))bad('Not found',404);
  const [,id,action]=match,row=await service.get(id);if(!row)bad('Not found',404);
  if(request.method==='GET'&&!action){const events=await env.ACCESS_DB.prepare('SELECT * FROM access_events WHERE request_id=? ORDER BY id LIMIT 5000').bind(id).all();await auditStatement(env.ACCESS_DB,{requestId:id,event:'request_viewed',actor:actor.email}).run();return json({request:safeRow(row),events:events.results,actor:actor.email,delivery_enabled:readiness(env).delivery});}
  if(request.method==='GET'&&action==='evidence'){
   if(!row.signature_bytes)bad('Signed PDF unavailable',404);
   if(await sha256(new Uint8Array(row.signature_bytes))!==row.signature_sha256){await auditStatement(env.ACCESS_DB,{requestId:id,event:'evidence_integrity_error',actor:actor.email}).run();bad('Signed PDF integrity check failed',500);}
   await auditStatement(env.ACCESS_DB,{requestId:id,event:'signed_eula_downloaded',actor:actor.email,details:{signatureHash:row.signature_sha256}}).run();
   return new Response(new Uint8Array(row.signature_bytes),{headers:{...HEADERS,'content-type':'application/octet-stream','content-disposition':`attachment; filename="signed-eula-${id}.pdf"`,'content-security-policy':"sandbox; default-src 'none'"}});
  }
  if(request.method!=='POST')bad('Method not allowed',405);requireSameOrigin(request);
  if(action==='decision'){
   const value=await requestJson(request);if(value.decision==='approve'&&!readiness(env).delivery)bad('Drive delivery must be configured before approval',503);
   const result=await service.decide(id,actor,value);
   if(value.decision==='approve'){try{return json({request:safeRow(await service.deliver(id,actor))});}catch{return json({request:safeRow(await service.get(id)),message:'Approval saved; Drive delivery requires reconciliation or retry.'},202);}}
   return json({request:safeRow(result)});
  }
  if(action==='retry'){
   if(row.status==='delivered')return json({request:safeRow(row)});
   if(!['approved','delivery_error','delivering'].includes(row.status))bad('Only an approved request can be retried',409);
   if(!readiness(env).delivery)bad('Drive delivery is not enabled',503);
   if(row.status==='delivering')await service.recoverInterruptedDelivery(id,actor);
   try{return json({request:safeRow(await service.deliver(id,actor))});}catch{return json({request:safeRow(await service.get(id)),message:'Delivery not confirmed; check the audit trail.'},202);}
  }
  bad('Not found',404);
 }catch(error){return json({error:error.status?error.message:'The operation could not be completed. No new approval should be assumed.'},error.status||400);}
}
