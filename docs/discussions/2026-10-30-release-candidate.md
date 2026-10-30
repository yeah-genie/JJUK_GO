# 공개 준비 단계로 전환 (2026-10-30)

## 사용자 결정 (원문 요약)
- 신호 예측은 **기능 개선을 멈춘다.** 공식 일별 기록이 최소 28일치 쌓이는 11/10~11/15 무렵에 다시 잰다: 전체 기록 일수, 방향 매칭 성공률, 시간대별 패턴 생성 가능 비율, QA 경로에서 예상 신호 대기가 표시되는 비율. 그 전까지는 threshold·로직 튜닝 금지, 수집 파이프라인 유지만.
- 그동안 앱을 완성한다. 우선순위: ① 서울 실제 OD 30~50개 고정 회귀 QA(이상한 우회·경로·경사·계단 사례 제거) ② 검색→비교→선택→걷기→도착 흐름 ③ 익명 사용 로그(route_search, alternative_available, time_delta, improved_factors, selected_route, walking_started) ④ 대안 없음·신호 정보 없음·검색 실패·지원 지역 밖 등 빈/오류 상태 ⑤ 새 기능 추가 금지(그늘·공사·날씨·조명 등).
- 추가 요청: 추천 품질 기준("대안 없음"이 잘못된 추천보다 낫다), 문구는 실제 비교값으로 자동 생성, 로그는 개인정보 최소화(좌표·궤적 저장 안 함), 경로 계산 시간 median/p95, `docs/RELEASE_CHECKLIST.md`.
- Vercel: `data` 브랜치 커밋이 `[vercel skip]`에도 배포됨 → Ignored Build Step으로 막고 실제로 확인. 앱 production 배포에는 영향 없어야 함.

## 한 것
- **Vercel:** Vercel은 배포하는 커밋 안의 `vercel.json`을 읽는다. data 브랜치에는 이 파일이 없어서 앱 설정이 적용되지 않았다(추정 → 아래로 확인). data 브랜치에 `{"git":{"deploymentEnabled":false},"ignoreCommand":"exit 0"}`를 넣고, 수집기가 매번 이 파일을 유지하게 했다. 앱 `vercel.json`에도 `ignoreCommand`(`VERCEL_GIT_COMMIT_REF=data`면 exit 0, 아니면 exit 1)와 `deploymentEnabled.data=false`를 넣었다.
  - **확인:** GitHub 커밋 상태로 봤다. 바꾸기 전 data 커밋(ff23cc9 02:56)은 "Deployment has completed", 바꾼 뒤 data 커밋(107db94, ef2f514 03:12)은 Vercel 상태가 아예 없음. 같은 시각 앱 커밋 5e66f02는 배포 성공.
- **추천 품질 기준:** `altRejectReason` — 너무 돌아감·사실상 같은 길·개선 부족·개선 대비 시간 과다·다른 요소 악화면 대안 없음. 기준은 `RELEASE_CHECKLIST.md`.
- **문구:** 문구 숫자를 비교표에 보이는 반올림 값끼리의 차이로 만든다(예: 급경사 137→0m는 표에 140→0m라 "급경사 140m"). "+32초로 계단 1구간을 피할 수 있어요" 형식.
- **익명 로그:** 앱 `logEvent` + `/api/event`(허용 칸만). 좌표·장소 이름·궤적·기기 ID 없음, 길 찾기마다 새 임의 값. 설정에서 끌 수 있음. 저장소(Upstash Redis)는 연결 전이라 아직 저장 안 됨.
- **빈/오류 상태:** 지원 지역 밖, 검색 목록 실패(다시 시도), 검색 결과 없음, 신호 정보 없음 문구, 오류마다 다음 행동 버튼.
- **도착:** 도착지 근처가 2번 연속 잡히면 위 카드가 '도착'으로 바뀌고 버튼이 '도착 · 기록 보기'로.
- **재평가 준비:** `scripts/signal_readiness.cjs`, 11/12 10:07(KST)에 다시 재도록 예약.

## 사용자 확인이 필요한 것
- Vercel 프로젝트에 저장소(Upstash Redis) 연결: 연결해야 사용 기록이 쌓인다.
- Actions → official-history 한 번 실행.
