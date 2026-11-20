import test from 'node:test';import assert from 'node:assert/strict';
import {bodyGeometry} from '../public/landmarks.js';
const pose=n=>({xy:Array.from({length:n},(_,i)=>[i*10,i*5]),valid:Array(n).fill(true),confidence:Array(n).fill(null)});
test('COCO WholeBody renderer selects 17 body joints, not its 68 face or 42 hand points',()=>{const g=bodyGeometry({pose:pose(133)});assert.equal(g.nodes.length,17);assert.equal(g.segments.length,16);assert.equal(g.total,17);assert(g.nodes.every(p=>p.index<17));});
test('MediaPipe uses its own 33-joint connectivity',()=>{const g=bodyGeometry({pose:pose(33),pose_topology:'mediapipe_pose_33'});assert.equal(g.total,33);assert(g.segments.some(([a,b])=>a[0]===110&&b[0]===230));assert(!g.segments.some(([a,b])=>a[0]===50&&b[0]===110));});
test('missing and non-finite joints never form skeleton edges',()=>{const p=pose(133);p.valid[5]=false;p.xy[7]=null;p.xy[9]=[NaN,2];const g=bodyGeometry({pose:p});assert(!g.nodes.some(n=>[5,7,9].includes(n.index)));assert(g.segments.every(edge=>edge.every(xy=>xy.every(Number.isFinite))));assert(!g.segments.some(edge=>edge.some(xy=>xy[0]===50)));});
test('AV has no fabricated body pose; confidence stays unknown',()=>{assert.deepEqual(bodyGeometry({kind:'legacy_aerial'}),{nodes:[],segments:[],total:0,topology:'not supplied'});assert(bodyGeometry({pose:pose(133)}).nodes.every(n=>n.confidence===null));});
