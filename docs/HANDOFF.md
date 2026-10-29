# 쭉고 인수인계

최종 갱신: 2026-10-29. 현재 작업: `codex/asphalt-onboarding`, Claude 기본 브랜치 `ccr-94bac9df-i81579`의 0c4f772에서 시작했다. 사용자 승인: 최신 네 화면 느낌으로 Vercel 수정·자동 걸음 기본·보조기 설문·불필요 문서 정리. 이전 ‘Codex 코드 참고만’ 상태 이후 사용자가 이 구현을 명시적으로 요청했다.

먼저 [문서 안내](DOCUMENTATION_INDEX.md), [제품 정의](PRODUCT_DEFINITION.md), [화면/상태 명세](PRODUCT_SPEC.md), [디자인 시스템](DESIGN_SYSTEM.md), [구현·검증](../reports/ASPHALT_IMPLEMENTATION.md)을 읽는다. 실제 완료와 설계 목표를 구분한다.

## 구현

- 실제 OSM 지도·검색·시간 예산·검출 계단/지형 추정·GPS 엔진을 선택적으로 가져와 아스팔트 화면에 연결했다. 자료 ZIP은 추가하지 않았다.
- 선택 설문 2단계: 상대 걸음, 이동 보조기(복수). 건너뛰기. 설문/장비를 고정 속도로 바꾸지 않는다.
- 자동 맞춤 기본, 측정 전에는 숫자 대신 상태. 수동 슬라이더는 설정 하위. 요약만 기기에 저장하며 저장 OFF·학습 초기화·직접값 사용을 지원한다.
- 횡단 방향/실제 길이/점멸이 함께 검증되지 않았으므로 횡단 여유 숫자는 현재 표시하지 않는다. 승인 이미지의 12초는 미래 예시다. 과거 이력은 현재 초록 신호가 아니다.
- 계단 회피는 알려진 계단을 실제 경로 탐색에서 제외한다. 미확인 물리 장벽과 엘리베이터 운영은 보장하지 않는다.
- 독립 그냥 걷기·운동 기록·공유 카드, 출발 카운트다운·시간 막대는 제거했다. API 수집은 재활성화하지 않았다.

## 실행·검증

`python scripts/build_prototype.py` → `docs/prototype/index.html`. `node scripts/preview.cjs`는 127.0.0.1:8771에서 로컬 미리보기. `node scripts/check_profile.cjs`, `node scripts/check_walk_logic.cjs`가 핵심 시험이다. Python 엔진은 별도 `python -m pytest -q`로 확인한다.

자동 학습은 사용자 시작 길 안내 중 유효 GPS만 이용하고 종료할 때 반영한다. 낮은 정확도나 짧은 걷기에는 속도를 확정하지 않는다. 실제 야외 휴대전화/보조기/저속 보행과 현장 신호 검증은 미완료다. 브라우저 권한·운영체제 위치·내장 브라우저 제약을 구분한다. 잠금/백그라운드 추적을 약속하지 않는다.

## 문서 정리

삭제 네 파일과 대체 이유는 문서 안내에 있다. 자료/라이선스·질문답변·실험·대화 기록은 보존했다. 이전 HANDOFF는 [reference/HANDOFF_BEFORE_ASPHALT.md](reference/HANDOFF_BEFORE_ASPHALT.md)로 보존했다. 과거 수집 성공/배포 번호를 현재 상태로 읽지 않는다.

## 최종 동기화·배포

- [PR #4](https://github.com/yeah-genie/JJUK_GO/pull/4) 병합 완료. 기본 브랜치 `ccr-94bac9df-i81579`, 병합 commit `2fcd6ad453d09f4de1522a5cbc8fb018ee86f55e`. 앱 구현 `3a94c0e`, CI 폰트 수정 `83c2bda`.
- Vercel 운영 프로젝트 `jjukgo` / `prj_rhMUEQmYTvE5MyHqnuhVAhgXt7MH`, 배포 `dpl_5SDDbVDzxf9M7Uq9NVed4MfjYwnq` READY. Git 소스는 위 병합 commit이며 대표 주소 [jjukgo.vercel.app](https://jjukgo.vercel.app/) 연결 확인. 보안 보호 설정은 변경하지 않았다.
- 운영 주소에서 로그인 없이 새 설문 → 건너뛰기 → 미측정 홈 → 실제 지도/서대문역–청계광장 예시 경로를 확인. 브라우저 오류 로그 없음. [실제 운영 화면](../reports/ui/asphalt-implementation/production.png).
- GitHub 최신 head `83c2bda`의 두 test check와 Vercel check 전부 success. 첫 CI의 한글 폰트 누락은 fonts-nanum 설치로 해결했다. 로컬 59개 시험 + Node 3종도 통과.
- 최종 인수인계 문서만 덧붙이는 커밋은 동일 앱 산출물로 다시 배포될 수 있다. 위 식별자는 실제 확인한 앱 배포이며 문서 커밋 자체를 뜻하지 않는다.

## Claude가 이어서 할 일

1. 실제 휴대전화에서 위치 허용/거부, 느린 보행과 정지·실내·끊김을 시험해 자동 학습 임계치를 검증한다. 이번 브라우저 시험이 실외 GPS 정확도 검증을 대신하지 않는다.
2. 횡단 방향·길이·초록/점멸 정의·요일을 대조하고 현장 표본으로 검증하기 전 여유 숫자 gate를 열지 않는다.
3. 계단·엘리베이터·보도 접근성 공공데이터를 그래프에 연결할 때 실제 출입구·단절·운영 상태와 갱신일을 검증한다. 자료가 있다는 이유로 무장애 통행으로 표시하지 않는다.
4. UI를 새로 발명하지 말고 승인 시안과 현재 DESIGN_SYSTEM/PRODUCT_SPEC을 이어간다. 큰 카운트다운·시간 막대·운동 기록·기본 수동 속도 칩을 되살리지 않는다.

## 2026-10-29 화면 차이 수정(Amelia, 로컬 커밋·미push)

홈 지도 빈 위쪽(컨테이너를 시트 위까지만), 결과 구조(두 행·계산 기준·정보 없는 횡단 N곳·조건 조정/걷기 시작), 설문 장식, 초기화 확인을 시안·명세에 맞췄다. 브라우저 시험 `node scripts/check_screens.cjs`(Playwright 필요, CI 제외). 상세·한계: [reports/team-2026-10-29/10_Dev_Amelia_asphalt_screens.md](../reports/team-2026-10-29/10_Dev_Amelia_asphalt_screens.md).
