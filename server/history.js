import {sha256} from './auth.js';
import {auditStatement} from './audit.js';

function invalid(message,status=400){const error=Error(message);error.status=status;throw error;}
function field(form,name,max,{required=false}={}){
  const value=String(form.get(name)||'').trim();
  if(value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)||(required&&!value))invalid('Invalid '+name);
  return value;
}
function date(form,name){
  const value=field(form,name,10);if(!value)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid('Invalid '+name);
  const parsed=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalid('Invalid '+name);
  return value;
}
export function historicalMetadata(row){if(!row)return null;const {signature_bytes,...metadata}=row;return metadata;}

// An evidence archive, deliberately without a Google client or delivery method.
export class HistoricalArchive {
  constructor(db){this.db=db;}
  get(id){return this.db.prepare('SELECT * FROM historical_records WHERE id=?').bind(id).first();}
  async list(){return (await this.db.prepare('SELECT id,applicant_name,document_date,approved_by,shared_by,original_filename,imported_at FROM historical_records ORDER BY COALESCE(document_date,\'\') DESC,imported_at DESC LIMIT 250').all()).results;}
  async events(id){return (await this.db.prepare("SELECT * FROM access_events WHERE json_extract(details_json,'$.historicalId')=? ORDER BY id").bind(id).all()).results;}
  async contacts(id){
    const event=await this.db.prepare("SELECT actor,created_at,details_json FROM access_events WHERE event='historical_contacts_recorded' AND json_extract(details_json,'$.historicalId')=? ORDER BY id DESC LIMIT 1").bind(id).first();
    if(!event)return null;
    const details=JSON.parse(event.details_json);return {contacts:details.contacts,source:details.source,recorded_by:event.actor,recorded_at:event.created_at,verified:false};
  }
  async recordContacts(id,value,actor){
    if(!await this.get(id))invalid('Historical record not found',404);
    if(!Array.isArray(value.contacts)||value.contacts.length<1||value.contacts.length>5)invalid('Provide between one and five contact addresses');
    const contacts=value.contacts.map(c=>{
      if(!['institutional','alternate'].includes(c?.kind)||typeof c.email!=='string')invalid('Invalid contact classification');
      const email=c.email.trim().toLowerCase();
      if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\x00-\x1f\x7f]/.test(email))invalid('Invalid contact email');
      return {kind:c.kind,email};
    }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.email.localeCompare(b.email));
    if(new Set(contacts.map(c=>c.email)).size!==contacts.length)invalid('Duplicate contact email');
    const source=typeof value.source==='string'?value.source.trim():'';
    if(!source||source.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source))invalid('Contact source is required');
    const previous=await this.contacts(id);
    if(previous&&JSON.stringify(previous.contacts)===JSON.stringify(contacts)&&previous.source===source)return {annotation:previous,replayed:true,permissionsChanged:false};
    await auditStatement(this.db,{event:'historical_contacts_recorded',actor:actor.email,details:{historicalId:id,contacts,source,mailboxOwnershipVerified:false,driveAccountVerified:false,permissionsChanged:false}}).run();
    return {annotation:await this.contacts(id),replayed:false,permissionsChanged:false};
  }
  async import(form,actor){
    if(form.get('historical_confirmed')!=='yes')invalid('Confirm that this is a historical record, not a new approval or delivery');
    const values={
      applicant_name:field(form,'name',200,{required:true}),
      recipient_email:field(form,'email',254).toLowerCase()||null,
      institution:field(form,'institution',300)||null,
      document_date:date(form,'document_date'),
      approved_by:field(form,'approved_by',200,{required:true}),
      approval_date:date(form,'approval_date'),
      shared_by:field(form,'shared_by',200,{required:true}),
      sharing_date:date(form,'sharing_date'),
      source_reference:field(form,'source_reference',2000,{required:true}),
      notes:field(form,'notes',2000)
    };
    if(values.recipient_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.recipient_email))invalid('Invalid historical email');
    const file=form.get('signed_eula');
    if(!file||typeof file.arrayBuffer!=='function'||file.size<100||file.size>1_000_000)invalid('An original PDF of at most 1 MB is required');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')invalid('The attachment must be a PDF');
    const filename=String(file.name||'');
    if(!filename||filename.length>255||/[\x00-\x1f\x7f]/.test(filename))invalid('Invalid original filename');
    const hash=await sha256(bytes),now=new Date().toISOString(),id=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare('INSERT INTO historical_records(id,applicant_name,recipient_email,institution,document_date,approved_by,approval_date,shared_by,sharing_date,source_reference,notes,original_filename,signature_sha256,signature_bytes,imported_by,imported_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM access_requests)+(SELECT count(*) FROM historical_records)<250 ON CONFLICT(signature_sha256) DO NOTHING').bind(id,...Object.values(values),filename,hash,bytes.buffer,actor.email,now),
      auditStatement(this.db,{event:'historical_record_imported',actor:actor.email,details:{historicalId:id,documentSha256:hash,originalFilename:filename,...values,attributionBasis:'Historical approval and sharing reported by the importing administrator; not new authenticated decisions',permissionsChanged:false}},true)
    ]);
    const row=await this.db.prepare('SELECT * FROM historical_records WHERE signature_sha256=?').bind(hash).first();
    if(!row)invalid('Document capacity reached',429);
    for(const key of ['applicant_name','recipient_email','institution','document_date','approved_by','approval_date','shared_by','sharing_date']){
      if(row[key]!==values[key])invalid('This document already exists with different historical details; original record preserved',409);
    }
    return {record:historicalMetadata(row),replayed:row.id!==id,permissionsChanged:false};
  }
}
