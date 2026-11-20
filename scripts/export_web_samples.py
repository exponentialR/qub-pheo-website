"""Export validated source samples for the browser; never modifies the inputs.

Run with the existing viewer validation environment (h5py/OpenCV/numpy) and
--viewer-root pointing to the pinned source checkout. No inference is run.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

LIMIT = 8_000_000_000
REVISION = 'aa5a5f76ff5ebae65c273ebb34b4a7ceef7e8b11'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n')


def export(source, target, viewer_root):
    # The historical working tree has a different preprocessing package.
    sys.path[:] = [str(viewer_root.resolve())]+[p for p in sys.path if p and Path(p).resolve() != Path.cwd()]
    from preprocessing.ul_ur_landmarks.viewer import DatasetCollection
    from preprocessing.ul_ur_landmarks.aerial import video_timing
    import numpy as np
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=viewer_root, text=True).strip()
    if revision != REVISION: raise ValueError('Unexpected viewer version')
    manifest = json.loads((source/'sample_manifest.json').read_text())
    records = {r['video_relative_path']: r for r in manifest['records']}
    groups = {g['clip_key']: g for g in manifest['groups']}
    if target.exists(): raise FileExistsError('Use a new export directory; do not overwrite a verified export')
    target.mkdir(parents=True)
    (target/'INCOMPLETE').write_text('Export in progress. Not for public distribution.\n')
    collection = DatasetCollection(source/'videos', source/'landmarks')
    catalog = dict(schema='qub-pheo-web-1', viewer_reference_commit=revision,
                   source_manifest_sha256=sha(source/'sample_manifest.json'),
                   coordinate_system='original_source_image_pixels',
                   preview_transform='H.264 yuv420p, width 864; all source frames and relative PTS preserved; audio omitted',
                   timing='Relative clip time. No new physical synchronisation. Lower legacy landmarks use video row PTS.',
                   access='EULA-controlled; selection is not anonymous publication permission', groups=[])
    checks = []
    for index, row in enumerate(collection.rows):
        clips, errors = collection.loaded_views(index)
        if errors or len(clips) != 5: raise ValueError(errors)
        record0 = records['videos/'+next(iter(row['views'].values()))['relpath']]
        group = dict(groups[record0['clip_key']]); group.pop('status', None)
        group['id'] = f'sample-{index+1:02d}'; group['views'] = {}
        for camera, clip in clips.items():
            record = records['videos/'+row['views'][camera]['relpath']]
            video = source/record['video_relative_path']; landmark = source/record['landmark_relative_path']
            if sha(video) != record['video_sha256'] or sha(landmark) != record['landmark_sha256']:
                raise ValueError('Source changed since validation')
            relative = Path(group['id'])/camera
            directory = target/relative; directory.mkdir(parents=True)
            output = directory/'preview.mp4'
            subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(video),'-map','0:v:0',
                            '-vf','scale=864:-2','-c:v','libx264','-preset','fast','-crf','23',
                            '-pix_fmt','yuv420p','-vsync','0','-an','-movflags','+faststart',
                            '-threads','2',str(output)], check=True)
            pts, width, height = video_timing(output)
            source_pts, _, _ = video_timing(video)
            if len(pts) != len(clip.times) or len(pts) != len(source_pts): raise ValueError('Lost or duplicated frames')
            delta = float(np.max(np.abs(pts-source_pts)))
            landmark_delta = float(np.max(np.abs(pts-clip.times)))
            if max(delta, landmark_delta) > 2: raise ValueError('Preview timing drift exceeds 2 ms')
            # Full decode catches encoder/truncation errors, not only metadata errors.
            subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(output),'-f','null','-'], check=True)
            chunks = []
            for start in range(0,len(clip.times),30):
                name = f'frames-{start:06d}.json'
                frames = [clip.frame(i,include_image=False) for i in range(start,min(start+30,len(clip.times)))]
                write_json(directory/name, dict(start=start,frames=frames))
                if (directory/name).stat().st_size > 4_000_000: raise ValueError('Oversized landmark chunk')
                chunks.append(dict(start=start,count=len(frames),path=(relative/name).as_posix()))
            group['views'][camera] = dict(video=(relative/'preview.mp4').as_posix(),
                width=clip.source['width'],height=clip.source['height'],preview_width=width,preview_height=height,
                timestamps_ms=clip.times.tolist(),chunks=chunks,frames=len(clip.times),
                source_video=record['video_relative_path'],source_landmarks=record['landmark_relative_path'],
                source_video_sha256=record['video_sha256'],source_landmarks_sha256=record['landmark_sha256'],
                match_basis=record['match_basis'])
            checks.append(dict(sample=group['id'],camera=camera,frames=len(pts),pts_error_ms=delta,
                               landmark_pts_error_ms=landmark_delta,full_preview_decode='passed'))
            print(group['id'],camera,'exported',len(pts),'frames',flush=True)
        catalog['groups'].append(group)
        for clip in collection.cache.values(): clip.close()
        collection.cache.clear()
    if len(catalog['groups']) != 20: raise ValueError('Expected all 20 sample groups')
    write_json(target/'catalog.json',catalog)
    write_json(target/'verification.json', dict(views=checks,original_files_modified=False,
        source_checksums_verified=200,publication_permission='Not granted by this export',uploaded=False))
    (target/'README.txt').write_text('QUB-PHEO browser samples. EULA-controlled.\n'
        'Select this folder in the web explorer; files stay on your computer.\n'
        '100 H.264 previews with saved timestamp-indexed landmark chunks.\n'
        'All source frames retained. Pixel coordinates refer to original source dimensions.\n'
        'Audio is omitted from previews. Original MP4/HDF5 sources are unchanged.\n'
        'Validity, confidence and actor semantics come from the pinned existing readers.\n'
        'Null confidence remains unknown; AV generic boxes are not object class labels.\n'
        'Landmark presence is not an accuracy assessment. Relative timing does not establish new camera calibration.\n'
        'These examples are a coverage-first demonstration, not an evaluation split.\n')
    (target/'INCOMPLETE').unlink()
    payload = sorted(p for p in target.rglob('*') if p.is_file())
    (target/'checksums.sha256').write_text(''.join(sha(p)+'  '+p.relative_to(target).as_posix()+'\n' for p in payload))
    result = dict(status='complete',groups=20,views=100,hard_limit_bytes=LIMIT,
                  total_bytes=sum(p.stat().st_size for p in target.rglob('*') if p.is_file()),
                  payload_sha256_verified=True)
    for _ in range(3):
        write_json(target/'COMPLETE.json',result)
        result['total_bytes']=sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
    write_json(target/'COMPLETE.json',result)
    if result['total_bytes'] >= LIMIT: raise ValueError('Export exceeds storage budget')
    for line in (target/'checksums.sha256').read_text().splitlines():
        expected, path=line.split('  ',1)
        if sha(target/path) != expected: raise ValueError('Export checksum verification failed')
    print(json.dumps(result),flush=True)


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--target',type=Path,required=True)
    p.add_argument('--viewer-root',type=Path,required=True)
    a=p.parse_args();export(a.source,a.target,a.viewer_root)
