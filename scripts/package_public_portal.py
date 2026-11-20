"""Package only Sam's explicitly approved 20 preview examples and website files."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

REPO=Path(__file__).resolve().parents[1]
SITE_FILES={'index.html','style.css','app.js','timing.js','landmarks.js','mark.svg','404.html','_headers','_routes.json','_worker.js'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True,help='Verified web-v1 export, kept outside Git')
    parser.add_argument('--out',type=Path,default=REPO/'dist',help='Ignored deployment output directory')
    args=parser.parse_args()
    SOURCE=args.source.resolve()
    OUT=args.out.resolve()
    source_catalog=SOURCE/'catalog.json'
    catalog=json.loads(source_catalog.read_text())
    groups=catalog['groups']
    assert len(groups)==20 and {g['id'] for g in groups}=={f'sample-{i:02d}' for i in range(1,21)}
    assert len({g['participant'] for g in groups})==20
    expected={}
    for line in (SOURCE/'checksums.sha256').read_text().splitlines():
        h,p=line.split('  ',1);expected[p]=h
    assert digest(source_catalog)==expected['catalog.json']
    paths=set();views=0;chunks=0
    for group in groups:
        assert set(group['views'])=={'CAM_AV','CAM_UL','CAM_UR','CAM_LL','CAM_LR'}
        for camera,view in group['views'].items():
            views+=1
            assert view['video']==f"{group['id']}/{camera}/preview.mp4"
            paths.add(view['video'])
            start=0
            for chunk in view['chunks']:
                assert chunk['start']==start and 0<chunk['count']<=30
                assert chunk['path']==f"{group['id']}/{camera}/frames-{start:06d}.json"
                start+=chunk['count'];paths.add(chunk['path']);chunks+=1
            assert start==view['frames']
    assert views==100 and chunks==790 and len(paths)==890
    for p in paths:
        assert not PurePosixPath(p).is_absolute() and '..' not in PurePosixPath(p).parts
        assert digest(SOURCE/p)==expected[p],p
    catalog['access']='Public playback of these 20 selected examples authorised by Sam on 18 November 2026. Full dataset still requires the official EULA and Sean McLoone approval.'
    catalog['publication_scope']={'groups':20,'videos':100,'landmark_chunks':790,
        'source_catalog_sha256':digest(source_catalog),'source_export_total_bytes':422235349,
        'original_hdf5_included':False,'full_dataset_access_changed':False}
    OUT.mkdir(parents=True,exist_ok=True)
    public_catalog=OUT/'catalog.json'
    public_catalog.write_text(json.dumps(catalog,separators=(',',':'),allow_nan=False)+'\n')
    entries={name:REPO/'public'/name for name in SITE_FILES}
    entries.update({'samples/v1/'+p:SOURCE/p for p in paths})
    entries['samples/v1/catalog.json']=public_catalog
    assert len(entries)==901 and max(p.stat().st_size for p in entries.values())<25*1024*1024
    total=sum(p.stat().st_size for p in entries.values());assert total<8_000_000_000
    archive=OUT/'qub-pheo-public-samples.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=4) as z:
        for name,p in sorted(entries.items()):z.write(p,name)
    rows=[dict(path=name,bytes=p.stat().st_size,sha256=digest(p)) for name,p in sorted(entries.items())]
    with zipfile.ZipFile(archive) as z:
        assert set(z.namelist())==set(entries)
        for row in rows:assert hashlib.sha256(z.read(row['path'])).hexdigest()==row['sha256']
    report=dict(status='verified',approval='Sam explicitly approved public playback of all 20 selected examples',
        groups=20,videos=100,landmark_chunks=790,files=len(entries),total_bytes=total,
        archive_bytes=archive.stat().st_size,archive_sha256=digest(archive),
        all_archive_entries_verified=True,contains_original_hdf5=False,contains_unselected_participants=False,
        full_dataset_on_drive=True,full_dataset_eula_approval_unchanged=True,files_manifest=rows)
    (OUT/'publication-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print({k:v for k,v in report.items() if k!='files_manifest'},flush=True)


if __name__=='__main__':main()
