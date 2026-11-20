// Same nearest-PTS rule as the pinned research viewer; no extrapolation.
export function frameAtTime(times, ms) {
  if (!times.length || !Number.isFinite(ms)) return null;
  const intervals = times.slice(1).map((v, i) => v-times[i]).sort((a,b)=>a-b);
  const n=intervals.length;
  const median=n ? (intervals[Math.floor((n-1)/2)]+intervals[Math.floor(n/2)])/2 : 1;
  if (ms < times[0]-median/2 || ms > times.at(-1)+median/2) return null;
  let lo=0,hi=times.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(times[m]<ms)lo=m+1;else hi=m;}
  const options=[lo-1,lo].filter(i=>i>=0&&i<times.length);
  return options.reduce((a,b)=>Math.abs(times[a]-ms)<=Math.abs(times[b]-ms)?a:b);
}
export function safePath(path) {
  return typeof path==='string' && path.length>0 && !path.startsWith('/') &&
    !path.includes('\\') && !path.includes('%') && !path.includes(':') &&
    path.split('/').every(p=>p!=='' && p!=='.' && p!=='..') && /^[\w./-]+$/.test(path);
}
export function validateCatalog(catalog) {
  if(catalog?.schema!=='qub-pheo-web-1'||!Array.isArray(catalog.groups)||!catalog.groups.length||catalog.groups.length>20)throw Error('Unsupported sample catalog');
  const ids=new Set();
  for(const group of catalog.groups){
    if(!/^sample-\d{2}$/.test(group.id)||ids.has(group.id))throw Error('Invalid sample ID');ids.add(group.id);
    if(!Number.isFinite(group.common_preview_end_ms)||group.common_preview_end_ms<=0)throw Error('Invalid preview window');
    for(const camera of ['CAM_UL','CAM_UR','CAM_AV','CAM_LL','CAM_LR']){
      const view=group.views?.[camera];
      if(!view||!safePath(view.video)||view.width<=0||view.height<=0||view.width>10000||view.height>10000)throw Error('Invalid view');
      const times=view.timestamps_ms;
      if(!Array.isArray(times)||!times.length||times.length>3000||times.some((t,i)=>!Number.isFinite(t)||(i&&t<=times[i-1])))throw Error('Invalid timestamps');
      let start=0;
      for(const chunk of view.chunks){if(chunk.start!==start||!safePath(chunk.path)||chunk.count<1||chunk.count>30)throw Error('Invalid chunk');start+=chunk.count;}
      if(start!==times.length)throw Error('Incomplete landmark coverage');
    }
  }
  return catalog;
}
