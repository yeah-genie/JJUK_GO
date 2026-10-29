# Winston(아키텍트) 측정 스크립트 (2026-10-29)

`reports/team-2026-10-29/08_Architect_Winston_plan.md`의 측정(요일·방향 대응·횡단 길이·경로 시험)을 만든 임시 스크립트와 결과 일부다.

- 스크립트에는 이 세션의 임시 경로(`/tmp/claude-0/.../scratchpad/team/winston2/`)가 하드코딩돼 있다. 그대로는 돌아가지 않고, **방법을 읽는 용도**다. 입력은 `official-history/20261027.csv.gz`, `docs/prototype/seoul/`의 그래프·신호 파일, Codex 브랜치의 `docs/prototype/src/app.js`다.
- `xday.py`: 다른 날 패턴을 10/27(화) 관측에 대어 적중률을 잰다(결과 `xday_result.csv`). `xlen.py`/`dist.py`: 횡단 길이 분포. `harness.cjs`: 앱 소스를 Node VM에 올려 실제 서울 데이터로 경로를 계산. `cross*.cjs`/`snap1.cjs`: 방향 대응 비교와 경로 스냅샷.
- 표본이 작다(하루, 7~45경로). 방향성 확인 수준이며 통계적 결론이 아니다.
