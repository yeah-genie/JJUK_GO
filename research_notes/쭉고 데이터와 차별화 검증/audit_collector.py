"""Read-only audit of a fetched data-branch snapshot. Never calls the TData API."""
import csv
import gzip
import io
import json
import statistics
import subprocess
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

KST = timezone(timedelta(hours=9))
sha = subprocess.check_output(['git', 'rev-parse', 'origin/data'], text=True).strip()
def blob(path):
    return subprocess.check_output(['git', 'show', f'{sha}:{path}'])
def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
def local(value):
    return value.astimezone(KST).isoformat()

calls = list(csv.DictReader(io.StringIO(blob('meta/call_log.csv').decode())))
ok = [r for r in calls if r['outcome'] == 'ok']
last_bad_index = max(i for i, r in enumerate(calls) if r['outcome'] != 'ok')
recovery = calls[last_bad_index + 1:]
gaps = [(utc(b['utc'])-utc(a['utc'])).total_seconds() for a,b in zip(recovery,recovery[1:])]
success_gaps = [((utc(b['utc'])-utc(a['utc'])).total_seconds(), a['utc'], b['utc']) for a,b in zip(ok,ok[1:])]
tree = subprocess.check_output(['git','ls-tree','-r','--name-only',sha],text=True).splitlines()
parts = sorted(p for p in tree if p.startswith('segments/2026/10/28/') and p.endswith('.csv.gz'))
recent = []
for p in parts[-5:]:
    rows = list(csv.DictReader(io.StringIO(gzip.decompress(blob(p)).decode())))
    recent.append({'path':p,'rows':len(rows),'first':rows[0] if rows else None,'last':rows[-1] if rows else None})
summary = {
    'checked_at_kst': local(datetime.now(timezone.utc)), 'snapshot_sha': sha,
    'outcomes':dict(Counter(r['outcome'] for r in calls)),
    'first_logged_at_kst':local(utc(calls[0]['utc'])),
    'last_success_at_kst':local(utc(ok[-1]['utc'])),
    'last_failed_at_kst':local(utc(calls[last_bad_index]['utc'])),
    'recovery_first_at_kst':local(utc(recovery[0]['utc'])),
    'recovery_successes':len(recovery),
    'recovery_gap_s':{'min':min(gaps),'median':statistics.median(gaps),'max':max(gaps)},
    'largest_success_gap':max(success_gaps),
    'last_successes':ok[-5:],
    'usage':json.loads(blob('meta/usage/2026-10-28.json')),
    'last_fetch_kst':{k:local(datetime.fromtimestamp(v,timezone.utc)) for k,v in json.loads(blob('meta/last_fetch.json')).items()},
    'segment_files_today':len(parts), 'recent_segments':recent,
}
out = Path(__file__).with_name('collector_snapshot.json')
out.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(out.read_text(encoding='utf-8'))
