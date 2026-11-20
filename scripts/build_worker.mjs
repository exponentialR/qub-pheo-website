import {build,version} from 'esbuild';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const result=await build({entryPoints:['server/worker.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/worker/_worker.js',metafile:true});
const inputs={};for(const name of Object.keys(result.metafile.inputs))inputs[name]=digest(await fs.readFile(name));
await fs.writeFile('dist/worker/build-manifest.json',JSON.stringify({esbuild:version,bundle_sha256:digest(await fs.readFile('dist/worker/_worker.js')),input_sha256:inputs},null,2)+'\n');
