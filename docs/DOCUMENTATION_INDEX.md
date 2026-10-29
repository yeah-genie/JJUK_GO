# 현재 문서 안내

2026-10-29 사용자 승인: 아스팔트 시안으로 Vercel 앱 수정, 자동 걸음 맞춤 기본, 생략 가능한 첫 설문과 보조기 질문, Claude 인수인계, 불필요한 문서 정리.

현재 개발자는 아래 순서로 읽는다.

1. [HANDOFF](HANDOFF.md): 실제 구현·배포 상태와 남은 검증.
2. [PRODUCT_DEFINITION](PRODUCT_DEFINITION.md): 서두르지 않아도 되는 길이라는 제품 방향.
2-1. [MVP_PLAN](MVP_PLAN.md): MVP 범위(MVP-0/MVP-1), 그늘로 벤치마크, 사용자 결정. 팀 회의 원문은 `../reports/team-2026-10-29/`.
2-2. [SERVICE_STRATEGY](SERVICE_STRATEGY.md): 그늘로 벤치마킹 토론 결과(재현 가능/불가, 현실성 판정, 포지셔닝, Threads 조각 전략, 중단 기준, 사용자 결정 5개).
3. [PRODUCT_SPEC](PRODUCT_SPEC.md): 화면·상태·저장·실패 처리 계약.
4. [DESIGN_SYSTEM](DESIGN_SYSTEM.md): 승인 이미지, 색·밀도·컴포넌트와 화면 크기 기준.
5. [구현 검증](../reports/ASPHALT_IMPLEMENTATION.md), [보행 확장 데이터·속도 조사](../reports/보행%20확장%20데이터와%20개인%20속도.md).

`discussions/`, `reference/`, `experiments/`, 과거 날짜의 보고서는 당시 판단과 검증의 기록이다. 현재 동작이나 요구사항의 근거로 덮어쓰지 않는다. 자료의 관측일과 기록일을 구분한다.

## 이번에 삭제한 문서와 이유

| 삭제 파일 | 이유·대체 |
|---|---|
| UI_UPDATE.md | 출발 추천·도착 마감 중심의 완료 기록. 현재 화면은 PRODUCT_SPEC/DESIGN_SYSTEM, 과거 검증 이력은 Git과 discussion에 남긴다. |
| NIGHT_PLAN.md | 지난 밤의 임시 계획·실행 기록이며 현재와 반대인 밝은 지도·가짜 내 위치 지침을 포함한다. 실제 데이터/평가 원본 experiments는 유지한다. |
| UX.md | 시간 막대·예측 신호 통과·큰 공유 카드 등 폐기된 화면 명세. 현재 디자인으로 대체한다. |
| POSITIONING.md | 미확정이었던 포지셔닝 제안. 이후 사용자와 정한 PRODUCT_DEFINITION으로 대체한다. |

옛 문서는 Git 이력에서 복구할 수 있다. 데이터 스키마, 출처·라이선스, 질문/답변, 조사 증거는 지우지 않는다.

## 보관 문서 (2026-10-29 두 번째 정리)

현재 기준이 아닌 계획 문서 8개(`PROPOSAL`, `FIRST_DEMO_PLAN`, `PRODUCT_DIRECTION`, `PRODUCT_TEAM_BRIEF`, `PRODUCT_REVIEW`, `WALKING_DEMO`, `BMAD_TEAM`, `CODEX_QUESTIONS_2026-10-29`)는 지우지 않고 [archive/](archive/README.md)로 옮겼다. 고유 조사·검증 내역이 섞여 있어 기록으로 보존하지만, 이 문서들로 새 기능을 다시 도입하지 않는다. 같은 정리에서 참조 없는 옛 스크립트(`scripts/build_map_data.py`)와 이전 UI 스크린샷도 삭제했다(목록은 archive/README).
