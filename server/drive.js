import {base64url} from './auth.js';
const encoder=new TextEncoder();
function failure(code,message){const error=Error(message);error.code=code;return error;}
export function serviceKeyPem(value,expectedEmail){
  // Accept the original Google download or its extracted PEM value. Never use
  // a JSON credential to change the server-configured service identity.
  let key=typeof value==='string'?value.trim():'';
  try{
    if(key.startsWith('{')){
      const data=JSON.parse(key);
      if(data.type!=='service_account'||data.client_email!==expectedEmail||typeof data.private_key!=='string')throw Error('Service identity mismatch');
      key=data.private_key;
    }else if(key.startsWith('"'))key=JSON.parse(key);
  }catch{throw failure('PRIVATE_KEY_FORMAT','Saved private key format or service identity was rejected');}
  if(typeof key!=='string')throw failure('PRIVATE_KEY_FORMAT','Saved private key format was rejected');
  key=key.replaceAll('\\n','\n').trim();
  if(!key.startsWith('-----BEGIN PRIVATE KEY-----')||!key.endsWith('-----END PRIVATE KEY-----'))throw failure('PRIVATE_KEY_FORMAT','Saved private key must contain its complete PEM value or original Google service-account JSON');
  return key;
}
export class DriveDelivery {
  constructor(config,fetcher=fetch){this.config=config;this.fetcher=(...args)=>fetcher(...args);}
  timeout(){const ms=Math.min(20000,(this.deadline||Date.now()+90000)-Date.now());if(ms<=0)throw Error('Drive delivery deadline exceeded');return AbortSignal.timeout(ms);}
  async token(){
    const c=this.config;if(!c.clientEmail||!c.privateKey||!c.folderId||!c.releaseId)throw Error('Drive delivery is not configured');
    this.stage='PRIVATE_KEY_FORMAT';const keyPem=serviceKeyPem(c.privateKey,c.clientEmail);
    this.stage='PRIVATE_KEY_DECODE';const pem=keyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
    const bytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
    this.stage='PRIVATE_KEY_IMPORT';const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const now=Math.floor(Date.now()/1000);
    const data=base64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})))+'.'+base64url(encoder.encode(JSON.stringify({iss:c.clientEmail,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300})));
    this.stage='GOOGLE_SIGN';const assertion=data+'.'+base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(data)));
    this.stage='GOOGLE_AUTH_FETCH';const response=await this.fetcher('https://oauth2.googleapis.com/token',{signal:this.timeout(),method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'manual'});
    if(!response.ok)throw failure('GOOGLE_AUTH_'+response.status,'Google service authentication failed');
    this.stage='GOOGLE_AUTH_RESPONSE';const value=await response.json();if(typeof value.access_token!=='string'||!value.access_token)throw Error('Google returned no access token');return value.access_token;
  }
  async api(path,token,options={}){
    this.stage='API_FETCH';const response=await this.fetcher('https://www.googleapis.com/drive/v3/'+path,{...options,signal:this.timeout(),headers:{Authorization:'Bearer '+token,'content-type':'application/json',...options.headers},redirect:'manual'});
    if(!response.ok)throw failure('DRIVE_HTTP_'+response.status,'Drive request failed ('+response.status+')');return response.json();
  }
  async inspect(){
    this.stage='CONFIG';try{
    // Read-only live verification: never create, update or delete a permission.
    const c=this.config;this.deadline=Date.now()+90000;
    const token=await this.token(),folder=encodeURIComponent(c.folderId);
    const meta=await this.api('files/'+folder+'?supportsAllDrives=true&fields=id,name,mimeType,trashed,capabilities(canShare)',token);
    if(meta.id!==c.folderId||meta.mimeType!=='application/vnd.google-apps.folder'||meta.trashed||!meta.capabilities?.canShare)throw failure('FOLDER_NOT_SHAREABLE','Approved release folder is unavailable or cannot be shared');
    let page,permissionCount=0,restricted=true,serviceRole=null;const seen=new Set();
    do{
      const query=new URLSearchParams({supportsAllDrives:'true',fields:'nextPageToken,permissions(type,role,emailAddress,deleted)',pageSize:'100'});
      if(page)query.set('pageToken',page);
      const data=await this.api('files/'+folder+'/permissions?'+query,token);
      for(const permission of data.permissions||[]){
        if(permission.deleted)continue;
        permissionCount++;
        if(['anyone','domain'].includes(permission.type))restricted=false;
        if(permission.type==='user'&&permission.emailAddress?.toLowerCase()===c.clientEmail.toLowerCase())serviceRole=permission.role;
      }
      page=data.nextPageToken;
      if(page&&seen.has(page))throw Error('Drive permission pagination repeated');
      seen.add(page);
    }while(page);
    return {folderId:meta.id,folderName:meta.name||null,canShare:true,restricted,serviceRole,permissionCount,permissionsChanged:false};
    }catch(error){if(!error.code)error.code='DRIVE_'+this.stage;throw error;}
  }
  async grant({email,releaseId}){
    const c=this.config;if(releaseId!==c.releaseId||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Release or recipient rejected');
    this.deadline=Date.now()+90000;const token=await this.token(),folder=encodeURIComponent(c.folderId);
    const meta=await this.api('files/'+folder+'?supportsAllDrives=true&fields=id,name,mimeType,trashed,capabilities(canShare),modifiedTime',token);
    if(meta.id!==c.folderId||meta.mimeType!=='application/vnd.google-apps.folder'||meta.trashed||!meta.capabilities?.canShare)throw failure('FOLDER_NOT_SHAREABLE','Approved release folder is unavailable or cannot be shared');
    let page,seen=new Set();
    do{
      const query=new URLSearchParams({supportsAllDrives:'true',fields:'nextPageToken,permissions(id,type,role,emailAddress,deleted)',pageSize:'100'});if(page)query.set('pageToken',page);
      const data=await this.api('files/'+folder+'/permissions?'+query,token);
      for(const p of data.permissions||[]){
        if(!p.deleted&&p.type==='user'&&p.emailAddress?.toLowerCase()===email.toLowerCase()&&['reader','commenter','writer','organizer','fileOrganizer','owner'].includes(p.role))return {folderId:c.folderId,folderModifiedTime:meta.modifiedTime||null,permissionId:p.id,existing:true,role:p.role,notification:'No new permission or notification; matching access already exists'};
      }
      page=data.nextPageToken;if(page&&seen.has(page))throw Error('Drive permission pagination repeated');seen.add(page);
    }while(page);
    const permission=await this.api('files/'+folder+'/permissions?supportsAllDrives=true&sendNotificationEmail=true&fields=id,type,role,emailAddress',token,{method:'POST',body:JSON.stringify({type:'user',role:'reader',emailAddress:email})});
    if(!permission.id||permission.type!=='user'||permission.role!=='reader'||permission.emailAddress?.toLowerCase()!==email.toLowerCase())throw failure('PERMISSION_NOT_CONFIRMED','Drive permission response did not confirm the requested recipient and role');
    return {folderId:c.folderId,folderModifiedTime:meta.modifiedTime||null,permissionId:permission.id,existing:false,role:'reader',notification:'Drive sharing notification requested; inbox receipt is not independently verified'};
  }
}
