// Public assets are static. Protected media stays unavailable until real grants
// and a private storage binding are configured; no client flags confer access.
export default {
  async fetch(request, env) {
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/'))return new Response(JSON.stringify({error:'Research media access is not enabled on this prototype. Follow the official EULA and Seán’s approval process.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
    return env.ASSETS.fetch(request);
  }
};
