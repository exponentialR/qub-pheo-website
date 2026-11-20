import {accessApi} from './http.js';
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/access/')||path.startsWith('/api/review/')){const result=await accessApi(request,env);if(result)return result;}
 if(path.startsWith('/api/'))return Response.json({error:'Research media access requires the existing EULA process.'},{status:503,headers:{'cache-control':'no-store'}});
 return env.ASSETS.fetch(request);
}};
