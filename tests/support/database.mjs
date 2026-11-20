import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(fs.readFileSync(new URL('../../migrations/0001_access.sql',import.meta.url),'utf8'));
 // Synchronous execution within a batch matches the platform transaction boundary.
 const db={prepare(text){let args=[];return {bind(...values){args=values;return this;},statement(){return [text,args];},async first(){return sqlite.prepare(text).get(...args)||null;},async all(){return {results:sqlite.prepare(text).all(...args)};},async run(){return {meta:{changes:sqlite.prepare(text).run(...args).changes}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>{const [text,args]=s.statement();return {meta:{changes:sqlite.prepare(text).run(...args).changes}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};return {db,sqlite};
}
