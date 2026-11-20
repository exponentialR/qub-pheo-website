import {auditStatement} from './audit.js';
// Approval/delivery core. The intake adapter must supply verified agreement
// evidence according to the signing process confirmed by the dataset owner.
export class ApprovalService {
  constructor(db,drive,{reviewerEmails,releaseId,agreementVersion,agreementSha256}){this.db=db;this.drive=drive;this.policy={reviewerEmails:(reviewerEmails||[]).filter(Boolean).map(x=>x.toLowerCase()),releaseId,agreementVersion,agreementSha256};}
  async get(id){return this.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();}
  async decide(id,actor,{decision,note,signatureChecked,identityChecked}){
    if(!this.policy.reviewerEmails.includes(actor.email?.toLowerCase()))throw Error('Only the configured reviewer can decide');
    if(!['approve','deny'].includes(decision))throw Error('Invalid decision');
    const row=await this.get(id);if(!row)throw Error('Request not found');
    if(row.release_id!==this.policy.releaseId||row.agreement_version!==this.policy.agreementVersion||!this.policy.agreementSha256||row.agreement_sha256!==this.policy.agreementSha256)throw Error('Release or agreement changed; request needs review under current policy');
    if(decision==='approve'&&(!signatureChecked||!identityChecked||!row.signature_reference||!row.signature_sha256))throw Error('Signature and institutional identity verification required');
    const status=decision==='approve'?'approved':'denied',now=new Date().toISOString(),reviewNote=String(note||'').trim().slice(0,2000);
    await this.db.batch([
      this.db.prepare("UPDATE access_requests SET status=?,reviewer_email=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").bind(status,actor.email.toLowerCase(),now,reviewNote,id),
      auditStatement(this.db,{requestId:id,event:status,actor:actor.email.toLowerCase(),details:{from:row.status,to:status,note:reviewNote,release:row.release_id,agreement:row.agreement_version,signatureHash:row.signature_sha256,signatureChecked:!!signatureChecked,identityChecked:!!identityChecked}},true)
    ]);
    const updated=await this.get(id);
    if(updated.status!==status&&!(decision==='approve'&&['delivering','delivered','delivery_error'].includes(updated.status)))throw Error('Request has already received a different decision');
    return updated;
  }
  async recoverInterruptedDelivery(id,actor){
    if(!this.policy.reviewerEmails.includes(actor.email?.toLowerCase()))throw Error('Only the configured reviewer can recover delivery');
    // Every external HTTP call has a 20s timeout. Five minutes ensures a prior
    // invocation has ended; the next grant attempt always lists permissions first.
    const cutoff=new Date(Date.now()-300000).toISOString();
    const [result]=await this.db.batch([this.db.prepare(`UPDATE access_requests SET status='delivery_error',delivery_claim=NULL,delivery_error='Interrupted delivery; reconcile before retry' WHERE id=? AND status='delivering' AND delivery_started_at<? AND reviewer_email IN (${this.policy.reviewerEmails.map(()=>'?').join(',')}) AND release_id=? AND agreement_version=?`).bind(id,cutoff,...this.policy.reviewerEmails,this.policy.releaseId,this.policy.agreementVersion),auditStatement(this.db,{requestId:id,event:'interrupted_delivery_recovered',actor:actor.email.toLowerCase()},true)]);
    if(result.meta.changes!==1)throw Error('No expired delivery claim can be recovered');
    return this.get(id);
  }
  async deliver(id,actor){
    if(!this.policy.reviewerEmails.includes(actor.email?.toLowerCase()))throw Error('Only the configured reviewer can deliver');
    const row=await this.get(id);if(!row)throw Error('Request not found');
    if(row.release_id!==this.policy.releaseId||row.agreement_version!==this.policy.agreementVersion||!this.policy.agreementSha256||row.agreement_sha256!==this.policy.agreementSha256||!this.policy.reviewerEmails.includes(row.reviewer_email))throw Error('Current approved release and reviewer required');
    if(row.status==='delivered')return row;
    if(!['approved','delivery_error'].includes(row.status))throw Error('An approved, unclaimed request is required');
    const claim=crypto.randomUUID(),now=new Date().toISOString();
    const [,lock]=await this.db.batch([
      this.db.prepare("INSERT INTO release_delivery_locks(release_id,claim,expires_at) VALUES(?,?,?) ON CONFLICT(release_id) DO UPDATE SET claim=excluded.claim,expires_at=excluded.expires_at WHERE expires_at<?").bind(row.release_id,claim,new Date(Date.now()+300000).toISOString(),now),
      this.db.prepare("UPDATE access_requests SET status='delivering',delivery_claim=?,delivery_started_at=?,delivery_error=NULL WHERE id=? AND status IN ('approved','delivery_error') AND changes()=1").bind(claim,now,id),
      auditStatement(this.db,{requestId:id,event:'delivery_started',actor:actor.email.toLowerCase(),details:{from:row.status,attempt:claim,release:row.release_id}},true)
    ]);
    if(lock.meta.changes!==1){await this.db.prepare('DELETE FROM release_delivery_locks WHERE release_id=? AND claim=?').bind(row.release_id,claim).run();throw Error('Delivery is already in progress for this request or release');}
    try{
      const result=await this.drive.grant({email:row.recipient_email,releaseId:row.release_id});
      await this.db.batch([
        this.db.prepare("UPDATE access_requests SET status='delivered',permission_id=?,granted_folder_id=?,existing_permission=?,delivered_at=?,delivery_claim=NULL WHERE id=? AND status='delivering' AND delivery_claim=?").bind(result.permissionId,result.folderId||null,result.existing?1:0,new Date().toISOString(),id,claim),
        auditStatement(this.db,{requestId:id,event:result.existing?'existing_access_confirmed':'drive_reader_granted',actor:actor.email.toLowerCase(),details:{folderId:result.folderId||null,folderModifiedTime:result.folderModifiedTime||null,permissionId:result.permissionId,role:result.role||'reader',existing:result.existing,notification:result.notification||'unknown',attempt:claim}},true),
        this.db.prepare('DELETE FROM release_delivery_locks WHERE release_id=? AND claim=?').bind(row.release_id,claim)
      ]);
      return await this.get(id);
    }catch(error){
      const code=/^[A-Z][A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:'DELIVERY_UNCONFIRMED';
      // Reconcile permission state before issuing a subsequent create. Do not
      // include external response bodies, tokens or private keys in the ledger.
      await this.db.batch([
        this.db.prepare("UPDATE access_requests SET status='delivery_error',delivery_error=?,delivery_claim=NULL WHERE id=? AND delivery_claim=?").bind(code,id,claim),
        auditStatement(this.db,{requestId:id,event:'delivery_not_confirmed',actor:actor.email.toLowerCase(),details:{attempt:claim,error:code}},true),
        this.db.prepare('DELETE FROM release_delivery_locks WHERE release_id=? AND claim=?').bind(row.release_id,claim)
      ]);
      throw Error('Drive delivery was not confirmed; request remains approved for a reconciled retry');
    }
  }
}
