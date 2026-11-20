const encoder=new TextEncoder();
export function base64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decode64(value){if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid token encoding');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
export async function sha256(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value)),x=>x.toString(16).padStart(2,'0')).join('');}
export async function requireReviewer(request,env,fetcher=fetch,now=Date.now()){
  let stage='CONFIG';try{
  const issuer=env.ACCESS_ISSUER,audience=env.ACCESS_AUDIENCE,emails=(env.APPROVER_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!audience||!emails.length)throw Error('Reviewer authentication is not configured');
  const token=request.headers.get('Cf-Access-Jwt-Assertion')||'';
  if(token.length>16000)throw Error('Invalid reviewer token');
  const pieces=token.split('.');if(pieces.length!==3)throw Error('Reviewer sign-in required');
  stage='TOKEN_DECODE';const header=JSON.parse(new TextDecoder().decode(decode64(pieces[0]))),claims=JSON.parse(new TextDecoder().decode(decode64(pieces[1])));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)throw Error('Invalid reviewer token');
  stage='KEY_FETCH';const response=await fetcher(issuer+'/cdn-cgi/access/certs',{redirect:'manual'});
  if(!response.ok)throw Error('Reviewer signing keys unavailable');
  stage='KEY_PARSE';const jwks=await response.json(),jwk=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(!jwk)throw Error('Unknown reviewer signing key');
  stage='KEY_IMPORT';const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  stage='SIGNATURE';if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode64(pieces[2]),encoder.encode(pieces[0]+'.'+pieces[1])))throw Error('Invalid reviewer signature');
  stage='CLAIMS';const seconds=now/1000;
  if(claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(audience)||!Number.isFinite(claims.exp)||claims.exp<=seconds||claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds+30)||claims.iat!==undefined&&(!Number.isFinite(claims.iat)||claims.iat>seconds+30)||!emails.includes(claims.email?.toLowerCase()))throw Error('Reviewer identity or token validity rejected');
  return {email:claims.email.toLowerCase(),subject:claims.sub||null};
  }catch(error){error.code='AUTH_'+stage;throw error;}
}
export function requireSameOrigin(request){const origin=new URL(request.url).origin;if(request.headers.get('Origin')!==origin){const error=Error('Same-origin request required');error.status=403;throw error;}}
