export function auditStatement(db,{requestId=null,event,actor,kind='reviewer',details={}},conditional=false){
  const text='INSERT INTO access_events(request_id,event,actor,actor_kind,details_json,created_at) '+(conditional?'SELECT ?,?,?,?,?,? WHERE changes()=1':'VALUES(?,?,?,?,?,?)');
  return db.prepare(text).bind(requestId,event,actor,kind,JSON.stringify(details),new Date().toISOString());
}
