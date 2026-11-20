// Match the body topologies used by the pinned QUB-HRI research viewer.
export const COCO_BODY_EDGES=[[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
export const MP_BODY_EDGES=[[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32]];
export function bodyGeometry(frame){
  if(!frame?.pose)return {nodes:[],segments:[],total:0,topology:'not supplied'};
  const mp=frame.pose_topology==='mediapipe_pose_33';
  const total=mp?33:17,pose=frame.pose,edges=mp?MP_BODY_EDGES:COCO_BODY_EDGES;
  const nodes=[];
  for(let i=0;i<Math.min(total,pose.xy.length);i++){
    const xy=pose.xy[i];
    if(pose.valid?.[i]&&xy?.length===2&&xy.every(Number.isFinite))nodes.push({xy,index:i,confidence:pose.confidence?.[i]??null});
  }
  const byIndex=new Map(nodes.map(p=>[p.index,p]));
  return {nodes,segments:edges.filter(([a,b])=>byIndex.has(a)&&byIndex.has(b)).map(([a,b])=>[byIndex.get(a).xy,byIndex.get(b).xy]),total,topology:mp?'MediaPipe 33':'COCO body 17'};
}
