"""qa_routes.cjs 결과(results.json)를 쉬운 표로 정리한다: 대안 비율, 이상 표시, 계산 시간 median/p95.

  python3 scripts/qa_report.py <results.json> > reports/qa/QA_날짜.md
"""
import json
import statistics
import sys


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def main():
    rows = json.load(open(sys.argv[1], encoding='utf-8'))
    ok = [r for r in rows if not r.get('error')]
    alt = [r for r in ok if r.get('alt')]
    print(f'# 회귀 QA 결과\n\n- 출발·도착 {len(rows)}곳 · 길 찾기 성공 {len(ok)}곳 · 쭉고 길 있음 {len(alt)}곳 ({len(alt) / max(1, len(ok)):.0%})')
    flagged = [r for r in rows if r.get('flags')]
    print(f'- 이상 표시 {len(flagged)}곳\n')
    for name, key in (('후보 탐색만(route_ms)', 'route_ms'), ('지도 조각 받기 포함(trip_ms)', 'trip_ms'), ('화면 열기~결과(load_ms)', 'load_ms')):
        xs = [r[key] for r in ok if r.get(key)]
        if xs:
            slow = max(ok, key=lambda r: r.get(key) or 0)
            print(f'- {name}: median {statistics.median(xs):.0f}ms · p95 {pct(xs, .95):.0f}ms · 최대 {max(xs)}ms ({slow["id"]} {slow["fn"]}→{slow["tn"]})')
    print('\n| id | 출발→도착 | 직선 | 빠른 길 | 쭉고 길 | 문구 | 대안 없는 이유(후보 수) | 계산 ms | 이상 |\n|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        f, j = r.get('fast') or {}, r.get('jjuk') or {}
        fast = f'{f["walk_s"] // 60}분 {f["meters"]}m 신호{f["sig"]} 계단{f["stairs"]} 오르막{f["gain_m"]}m 급경사{f["steep8_m"]}m' if f else '-'
        jj = f'+{j["walk_s"] - f["walk_s"]}초 신호{j["sig"]} 계단{j["stairs"]} 오르막{j["gain_m"]}m 급경사{j["steep8_m"]}m' if j else '-'
        why = ', '.join(f'{k} {v}' for k, v in (r.get('rejected') or {}).items())
        text = r['error']['title'] if r.get('error') else (r.get('line') or '')
        print(f'| {r["id"]} | {r["fn"]}→{r["tn"]} | {r.get("straight_m", "")}m | {fast} | {jj} | {text} | {why} | {r.get("trip_ms") or r.get("route_ms")} | {"; ".join(r.get("flags") or [])} |')


if __name__ == '__main__':
    main()
