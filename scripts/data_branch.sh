#!/usr/bin/env bash
# 수집 데이터는 코드와 분리된 `data` 브랜치에 쌓는다.
#   scripts/data_branch.sh checkout          # ./datastore 에 data 브랜치 준비 (없으면 새로 만듦)
#   scripts/data_branch.sh push "메시지"      # ./datastore 변경사항 커밋 후 push
# GitHub Actions에서 GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수를 사용한다.
set -euo pipefail

DIR=datastore
BRANCH=data
REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

case "${1:-}" in
  checkout)
    if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
      git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$DIR"
    else
      mkdir -p "$DIR"
      git -C "$DIR" init --quiet -b "$BRANCH"
      git -C "$DIR" remote add origin "$REMOTE"
      printf '# 쭉고 수집 데이터\n\n자동 수집기가 관리하는 브랜치입니다. 구조는 main 쪽 docs/DATA_COLLECTION.md 참고.\n' > "$DIR/README.md"
    fi
    ;;
  push)
    cd "$DIR"
    git config user.name "jjukgo-collector"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add -A
    if git diff --cached --quiet; then
      echo "변경 없음"
      exit 0
    fi
    # 수집 데이터 커밋은 앱 배포(Vercel)를 만들지 않는다. 5분마다 push하면 하루 배포 한도(100회)를 다 써서
    # 정작 앱 수정본이 배포되지 못했다(2026-10-29). Vercel은 커밋 메시지의 [skip ci] / [vercel skip]을 보고 배포를 건너뛴다.
    git commit --quiet -m "[skip ci] [vercel skip] ${2:-data update}"
    for attempt in 1 2 3 4; do
      if git push --quiet origin "HEAD:$BRANCH"; then
        exit 0
      fi
      sleep $((2 ** attempt))
      git pull --quiet --rebase origin "$BRANCH"
    done
    echo "push 실패" >&2
    exit 1
    ;;
  *)
    echo "usage: $0 checkout|push [message]" >&2
    exit 2
    ;;
esac
