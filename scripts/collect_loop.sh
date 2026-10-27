#!/usr/bin/env bash
# 정해진 시간(분) 동안 5분마다 한 번씩 수집하고, 매번 data 브랜치에 저장한다.
#   scripts/collect_loop.sh 50
# API가 키 전체에 300초 1회로 제한하므로 호출 사이를 305초 띄운다.
set -uo pipefail

MINUTES=${1:-50}
GAP=305
end=$((SECONDS + MINUTES * 60))

while :; do
  started=$SECONDS
  PYTHONPATH=src python -m jjukgo.collect once --data-dir datastore || echo "::warning::수집 실패 (다음 회차에 다시 시도)"
  bash scripts/data_branch.sh push "collect $(date -u +%Y-%m-%dT%H:%MZ)" || echo "::warning::저장 실패 (다음 회차에 다시 시도)"
  wait=$((GAP - (SECONDS - started)))
  [ "$wait" -lt 0 ] && wait=0
  [ $((SECONDS + wait)) -ge "$end" ] && break
  sleep "$wait"
done
