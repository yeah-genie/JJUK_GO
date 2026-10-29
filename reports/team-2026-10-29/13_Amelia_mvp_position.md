# 13 · Amelia(Dev) — MVP 구현 가능성과 스토리 계획

2026-10-29 · 코드·다른 파일 수정 없음(이 문서만 저장). 표기: **[확인]** 내가 파일을 열거나 실행해 본 것 / **[추정]** 이어 붙인 것 / **[모름]**. 크기 S/M/L은 서로 비교한 상대 추정이며 시간 약속이 아니다. 제안은 모두 사용자 승인 전이다.

## 1. 결론

코드는 **"화면을 더 얹기엔 충분히 건강하지만, 숫자를 열기엔 아직 아니다"**. 4종 Node 시험과 pytest 59개는 모두 통과했고(재실행 [확인]) Playwright 화면 시험도 두 뷰포트에서 통과했다(2분 13초 [확인]). 그러나 MVP를 가로막는 것은 화면이 아니라 두 가지다. (a) **gate를 열 근거 구조가 코드에 없다**: 횡단 길이는 `e.len`(차선 환산 추정), 녹색 창은 `win` 하나(고정녹색/점멸 미분리), 방향은 `dir` 코드뿐이고 `marginCellText`(screens.js:67)는 근거를 입력받지 않는 문자열 분기다. (b) **화면 시험이 CI 밖에 있다**(.github/workflows/ci.yml에 check_screens 없음). 그래서 Sally 18프레임 중 아직 없는 것(위치 사전 시트, 계산 기준·조건 조정 시트, 지도에서 도착 고르기, 인라인 미확인 펼침, 횡단 상세)은 대부분 S~M이고, 병렬로 쪼갤 수 있다. 반면 gate 개방은 데이터·현장 검증이 막혀 있어 L이며, 사용자 결정(아래 §7) 없이는 시작할 수 없다. 제 권고: **1묶음에서 토대(CI 편입·gate 근거 구조·정리)를 먼저 세우고, 2묶음에서 숫자와 무관한 화면 갭을 병렬로 메우고, gate 개방은 '표시 전용'으로 3묶음에서 증거 플래그 뒤에 붙인다.** 경로 선택 비용에는 여유를 넣지 않는다(§6).

## 2. 코드 상태 (직접 점검)

### 2-1. 크기와 책임 분리 [확인: wc, grep]

| 파일 | 줄 | 바이트 | 책임 | 판단 |
|---|---|---|---|---|
| docs/prototype/src/app.js | 1089 | 73KB | 데이터 로드(19), 지형(36-47), 신호(57-100), 그래프·탐색(101-276), 지도 스타일(329-396), 지도·시트(397-548), 상태·계산(547-606), GPS(608-695), 걷기(699-885), 검색(895-975), 화면 전환(989-1089) | 한 파일에 전부. 전역 `state`(547), `REAL`(56, computeTrip에서 재할당), `BASE`·`SPEED` 변경 |
| screens.js | 123 | 14KB | 설문·설정·홈·결과·상세 렌더 + 클릭 위임 | 줄이 매우 촘촘(한 줄에 여러 문장) |
| walking-profile.js | 128 | 7.8KB | 프로필 저장·걸음 학습 | 순수 함수가 많아 시험이 가장 잘 붙는 부분 |
| walk-card.js / external-search.js | 36 / 15 | 4.4KB / 1.4KB | 인증 카드 SVG / 공개 검색 | 작고 독립적 |
| asphalt.css | 49 | 20.7KB | 전체 스타일 | 한 줄 규칙이 길다 |
| template.html | 169 | 15KB | 화면 골격 9개 `s-*` | |
| 산출물 docs/prototype/index.html | | 203KB | 위 전부를 문자열 치환으로 합침 | CI가 `git diff --exit-code`로 동기화 확인(ci.yml) |

빌드(scripts/build_prototype.py, 30줄)는 `/*WALKING_PROFILE*/`, `/*ASPHALT_UI*/`, `/*APP_JS*/` 자리표시를 치환하고 walk-card·external-search는 뒤에 이어 붙인다. 모듈이 아니라 **단일 classic script**라서 파일 간 의존이 전역 이름과 합치는 순서에 있다.

### 2-2. 시험의 범위와 불안정한 곳 [확인]

| 시험 | 방식 | 범위 | 약점 |
|---|---|---|---|
| tests/*.py (pytest 59) | 파이썬 | 수집·주기·보행 구간·재생 | 앱 JS와 무관 |
| check_profile.cjs (33줄) | Node VM | 설문·장비·걸음 학습·이상치·정지·공백·개인정보·초기화·카드 SVG | 강함. 순수 함수 대상 |
| check_walk_logic.cjs (139줄) | Node VM + 가짜 DOM(15-25줄) | `sigWait`·`known`·경로 예산·투영·GPS·`state.same` | app.js 전체를 vm에 올림 → 전역 이름 변경에 민감 |
| check_app_shell.cjs (15줄) | 정규식 | DOM id 유일성, `$("id")` 대상 존재, 폐기 컨트롤 부재 | 구조만. 동작 없음 |
| check_places.cjs (4줄) | handler 직접 호출 | 검증·서울 범위·캐시·429 | 프런트-API 계약 시험 없음 |
| **check_screens.cjs (289줄)** | Playwright 2뷰포트(390x844, 360x640) | 홈 지도 단색 아님(A), 설정 스크롤(B), 결과 구조(C), 설문 장식(D), 상태 6종(E) | **CI에 없음**(ci.yml에 단계가 없고 playwright 없으면 SKIP, 첫 줄 주석). `wait(` 25회 고정 대기, 시작 로고 3.2초(app.js 마지막 부분), 전체 2분 13초. 8771 포트·`/opt/node-tools` 경로 가정 |

768x1024·가로·200% 글 확대·키보드 이동은 어느 시험에도 없다([확인]: check_screens VIEWPORTS 두 개뿐). 실제 휴대전화 시험은 0회(brief).

### 2-3. 배포 [확인]

- vercel.json: `framework:null`, `buildCommand:""`, `outputDirectory:"docs/prototype"`. 빌드를 Vercel이 하지 않으므로 **커밋된 index.html이 곧 배포물**이다. CI의 diff 검사가 유일한 방어.
- api/places.js(28줄): Photon 조회, 서울 bbox 필터, 모듈 전역 `cache`(최대 100)와 `lastRequest` 500ms 스로틀. 서버리스 인스턴스별 메모리라 **한 사용자의 연속 검색이 같은 인스턴스를 쓰는 다른 사용자에게 429를 줄 수 있다** [추정, 코드상 전역 변수이므로]. Photon 공개 서버는 SLA가 없다.
- 정적 데이터 docs/prototype/seoul 96MB(signal-hours 30M, tiles 40M, graph 26M) + 저장소 pack 64MB [확인: du, count-objects]. 서울 밖·신규 구역 확장 때 배포·clone 비용이 커진다.

## 3. 기술 부채 Top 5 (MVP 전에 정리)

| # | 부채 | 근거(파일·줄·재현) | 정리 방향 | 크기 |
|---|---|---|---|---|
| 1 | **gate 근거 구조 없음** | `marginCellText`(screens.js:67)는 `ps.kind`만 본다. 근거 필드가 전혀 안 흐른다: 횡단 길이는 그래프 간선 `e.len`(app.js:115)이며 PRODUCT_SPEC §6-4가 말한 "차선 환산 추정", 녹색 창은 신호 대역의 `win` 하나(signal-hours/08.json의 `"win":[[102.0,133.0]]` 등 [확인]), `MIN_GREEN=8`(app.js:75)·`UNKNOWN_SIG_COST=45`(app.js:7)는 매직 상수. `signalPlan`은 `dir`이 `undefined`면 `Object.values(band.legs)[0]`, 즉 **임의의 첫 방향**을 돌려준다(app.js:62; `known()`의 기본 인자 경로). 지금은 숫자가 없어서 안 드러난다 | 신호·간선·속도·날짜를 받아 `{state, seconds?, reason[]}`를 돌려주는 순수 함수 하나(근거 기본값 false, fail-closed)를 세우고 `dir===undefined`는 null 취급 | M |
| 2 | **화면 시험이 CI 밖·느림·고정 대기** | ci.yml: pytest, build diff, profile, walk_logic, app_shell, places만. check_screens.cjs 25개 `wait(`, 로고 3.2초, 실행 2m13s [재현: `node scripts/check_screens.cjs`]. 설정·결과 회귀(예: Amelia 10번 보고서 A의 지도 단색)가 push 후에야 발견 | 시험 전용 진입(프로필 시드 + `#splash-skip` 클릭)으로 로고 대기 제거, 고정 `wait`를 `untilTrue`로, 390x844 한 뷰포트부터 CI 편입, 768과 200% 확대는 별도 단계 | M |
| 3 | **단일 파일·전역 상태·치환 빌드** | app.js 1089줄, 최상위 함수 약 88개, 전역 `state`(547)·`REAL`(56)·`BASE`·`SPEED`. 시험이 이 전역을 직접 만진다(check_screens.cjs openTrip이 `state`·`BASE=31200`을 페이지에 주입; check_walk_logic.cjs 58-61). 한 줄이 최대 676자(app.js), screens.js는 한 줄에 여러 문장이라 diff·리뷰가 어렵다 | 지금 ES 모듈 전환은 하지 않는다(배포가 빌드 없는 정적). 대신 (a) 신호·탐색·계산 같은 **순수 부분을 파일로 분리**(`signal.js`, `search.js`)하고 build의 치환 목록만 늘리기, (b) 새 코드는 줄바꿈 포맷 | L(점진) |
| 4 | **죽은/이중 경로와 문서-코드 불일치** | `#layer-toggle`이 template.html:32와 screens.js:119에 남아 있는데 PRODUCT_SPEC 머리말은 "횡단 정보 켜기/끄기를 없앤다"고 한다(DOM 존재는 [확인], 화면 노출 여부는 CSS가 absolute 배치하므로 보일 것으로 [추정]). `DEADLINE_KEY`(app.js:15)·`state.deadline`(547·1080)·`DEMO_MODE=false`(26)·`show()`의 `me/signal/depart` 옛 이름 매핑(993-995)·`SCREENS`의 `detail`/`done`/`search`. 참고: `"gentle"` 후보는 죽은 코드가 아니라 `refreshSims`(590)가 쓴다 | 위 항목 제거와 check_app_shell의 "폐기 컨트롤" 목록 확장. 제거 전 PRODUCT_SPEC 해시·`#me` 호환(§2)은 유지 | S |
| 5 | **배포·API의 보이지 않는 결합** | vercel buildCommand 빈 값 → 커밋된 index.html이 배포물, 동기화 방어는 CI diff 하나. `api/places.js`의 인스턴스 전역 스로틀·캐시(위 §2-3), 프런트 `external-search.js`와의 계약 시험 없음. innerHTML 사용 app.js 9곳·screens.js 8곳은 `esc()` 호출에 의존(app.js:432·549·928 등은 확인, 나머지 전수는 [모름]) | (a) 공개 검색 응답을 프런트가 받는 모양과 한 시험으로 묶기, (b) 스로틀을 IP 없이도 공정하게(클라이언트 쪽 디바운스 + 서버는 캐시만), (c) innerHTML 사용처 전수 점검 시험(정규식으로 템플릿 보간에 `esc(`가 있는지) | M |

Top 5 밖 메모: `index.html`이 203KB 단일 파일이라 PR diff가 크다(CI가 막아 주긴 함). 96MB 정적 데이터는 MVP 범위(서울)에서는 유지.

## 4. MVP 후보 기능 스토리표

### 4-1. 현재 구현과 Sally 18프레임의 갭 [확인: grep, 보고서 10]

| 프레임 | 현재 앱 | 갭 |
|---|---|---|
| 설문 2/2 (select, none) | 구현됨, check_screens E가 문구·복수·없음 배타·미선택 단언 | 없음(768 확인만) |
| 위치 권한 사전 시트 (`location-ask`) | 없음. "허용할 때 연결해요" 문구가 코드에 없음 [확인] | 있음 |
| 위치 거부 (`location-denied`) | 구현됨(E) | 없음 |
| 학습 부족 결과 | 구현됨(E) | 열 머리 `시간 · 임시 기준` 표기 여부 확인 |
| 계산 기준 시트 | 펼침 패널(`calc-basis`→`result-options`) 있음, 태그 모양 구분(실선/점선/파선) 없음 | 패널을 시트·태그로 |
| 조건 조정 시트 | 있는 것은 설정 화면 이동(C 시험: 조건 조정→설정→복귀) | 결과 위 시트로(이동 없이) |
| 걷는 중 | 구현됨 | 지도 칩 `다음 횡단 정보 없음 · 120m`, 문구 점검 |
| 직접 정하기 | 구현됨(E) | 없음 |
| 초기화 확인 | 구현됨(E) | 없음 |
| 정보 없는 횡단 펼침 | 링크가 `detail` 화면으로 이동 | 인라인 펼침+지도 `?` 강조 |
| 횡단 상세 | `renderDetail`(screens.js:100)은 목록용 | 프레임의 지도·세 줄(초록/건너는 시간/여유)은 gate 뒤 |
| 측정 중지 | 구현됨(E) | 속 빈 점+점선 원 `마지막 위치` 시각 |
| 검색 결과·빈 결과 | 목록과 "공개 검색" 있음 | `지도에서 도착 고르기`가 코드에 없음, 빈 결과 문구가 프레임과 다름 |
| 360 변형 3장 | 시험 뷰포트가 이미 360x640 | 새 화면 추가마다 같은 단언 |

### 4-2. 스토리 (ID는 이 문서 안에서만 쓰는 임시 번호)

AC는 "검사 가능한 문장"으로 적었다. 의존 기호: `→`는 앞서 끝나야 함.

| ID | 스토리 | 수용 기준(AC) | 의존 | 크기 | 검증 (추가 위치) |
|---|---|---|---|---|---|
| T1 | 화면 시험 CI 편입·가속 | AC1 ci.yml에 Playwright 설치+check_screens(390x844) 단계. AC2 로고 대기 없이 홈 도달. AC3 고정 `wait` 제거. AC4 playwright 없으면 로컬 SKIP, CI는 FAIL | 없음 | M | check_screens.cjs 수정 자체 |
| T2 | 정리: 죽은 코드·layer-toggle·옛 이름 | AC1 `#layer-toggle` 제거(또는 PRODUCT_SPEC 머리말 정정, 사용자 확인). AC2 `DEADLINE_KEY`·`state.deadline`·`DEMO_MODE` 제거. AC3 `show()` 옛 이름 매핑 중 `#me`만 유지 | 없음(T1과 병렬) | S | check_app_shell.cjs의 폐기 id 목록 확장, VM: `show('signal')`→`detail/home` 단언 유지 |
| T3 | gate 평가 함수와 증거 구조 | AC1 `marginFor()`가 증거 하나라도 false/미상이면 `{state:'hidden', reason}`. AC2 증거 기본값 false, 일반 모드에서 숫자 없음. AC3 `?demo=1`+예시 표식에서만 fixture 허용. AC4 음수 여유는 부호 유지. AC5 `dir===undefined`는 null | 없음 | M | **Node VM**: check_walk_logic.cjs에 표 기반 케이스(속도 없음/길이 추정/점멸 미분리/음수/지원 밖 날짜). 일반 모드 페이지에 `~숫자초` 정규식 0 (Playwright E) |
| T4 | 계산 기준 시트 | AC1 시트에 5행(걸음 속도/신호 시간/방향/횡단 길이/계단·경사), 각 행 상태는 글자+테두리 모양(실선/점선/파선). AC2 값은 상태에서 계산(하드코딩 금지). AC3 실시간 아님 문구. AC4 360x640 내부 스크롤 | → T3(상태 소스) | M | VM: `basisRows(state)` 순수 함수. Playwright: 열기·닫기·포커스 |
| T5 | 조건 조정 시트 | AC1 결과에서 이동 없이 시트(계단, 더 걸어도 되는 시간). AC2 취소는 원래 경로 유지, 적용은 재계산 후 복귀. AC3 설문 추정과 사용자가 직접 바꾼 값 구분 문구. AC4 오래된 응답이 선택 경로를 덮지 않음 | 없음 | M | Playwright(C 갱신: 기존 "조건 조정→설정→복귀" 단언을 시트 기준으로 교체). VM: 최신 요청만 반영(`tripRequest` 경쟁) |
| T6 | 위치 권한 사전 시트 | AC1 `내 위치로 출발` 누른 뒤에만 시트, 가짜 경로·걷기 시작 없음. AC2 `위치 허용하기`/`지도에서 출발 선택`. AC3 거부 시 기존 거부 화면 | 없음 | S | Playwright: context permissions 거부·허용 두 경우(E의 거부 시험에 단계 추가) |
| T7 | 지도에서 도착(출발) 고르기 | AC1 검색 화면과 빈 결과 모두에 `지도에서 도착 고르기`. AC2 지도 탭 위치에 확인 칸, 보행로와 35m 초과 시 기존 오류. AC3 검색·조건 편집을 막지 않음 | 없음(`onMapClick` app.js:460 재사용) | M | Playwright: 지도 클릭→결과. VM: 스냅 35m 한계(이미 walk_logic에 snap 단언) |
| T8 | 정보 없는 횡단 인라인 펼침 | AC1 `정보 없는 횡단 N곳`을 눌러 이름+이유(`신호 기록 없음`·`횡단 길이 미확인`). AC2 지도의 `?`와 같은 점. AC3 N=0이면 숨김(기존 유지). AC4 이유는 `xing`의 실제 필드에서 | 없음 | S~M | VM: `unknownReasons(sim)`. Playwright C: 펼침 후 CTA 가림 0 |
| T9 | 걷는 중 보강 | AC1 `다음 횡단 정보 없음 · Nm` 칩(N=경로 진행 위치에서 다음 횡단까지). AC2 끊김 시 `마지막 위치` 속 빈 점. AC3 종료 시 watch 해제(기존) | 없음 | M | VM: `nextCrossing(route, progress)`(`projectOnRoute` app.js:670 옆). Playwright E(측정 중지) 확장 |
| T10 | 검색 빈 결과 문구 정합 | AC1 프레임 문구와 PRODUCT_SPEC §9 일치. AC2 공개 검색 버튼 유지(명시 버튼에서만 조회, GPS 미전송 유지) | T7 | S | check_places(변화 없음) + Playwright 검색 시나리오 1개 |
| T11 | 지도 층 개선 | AC1 `이력 있음`(실선 노랑+표식)/`미확인`(회색 점선+?) 두 스타일이 지도에서 구별. AC2 범례 한 번. AC3 녹색 체크·안전 표현 없음. AC4 줌에 따라 겹치지 않음 | 없음 | M | Playwright: `map.queryRenderedFeatures`로 두 층 피처 수>0과 스타일 속성 단언. 단색 비율(A의 `dominantShare` 재사용) |
| T12 | 횡단 상세(프레임 `crossing-detail`) | AC1 gate 통과 횡단만 열림, 아니면 `자료 확인 중`. AC2 초록 길이/건너는 시간/여유 세 줄과 근거 4줄. AC3 시안용 예시 띠는 `?demo=1`에서만 | → T3 | M | VM(T3 표 재사용) + Playwright(demo 모드) |
| T13 | 신호 방향 매칭 검증(데이터) | AC1 샘플 N곳(숫자는 사용자/PM이 정함)에서 `dir` 코드와 물리 방향 현장·위성 대조표. AC2 불일치율 산출, 기준 미달이면 gate 증거 false 유지 | 사용자 결정 D1 | L | pytest(대조 CSV 형식)+현장 사진 목록. 앱 시험 아님 |
| T14 | 횡단 길이 확정(데이터) | AC1 OA-21209(`tbTraficCrsng`) 전체 수령(인증키 필요)과 간선 매칭률. AC2 매칭된 곳만 `lengthSource='official'` | 사용자 결정 D2 | L | pytest(매칭), VM(T3에서 `official`만 통과) |
| T15 | 점멸 의미 분리(데이터) | AC1 `win`을 고정녹색/점멸로 쪼개는 필드 또는 정의 문서 근거. AC2 별표 2에 따라 "녹색 점멸에 새로 횡단 시작 금지" 구간은 완료 가능 시간에만 포함 | T13·T14와 병렬 가능 | L | pytest(수집 데이터에서 분리 가능성), VM(T3) |
| T16 | 여유 표시 개방(표시 전용) | AC1 증거 3종(T13-15) 모두 true인 횡단만 숫자. AC2 경로 대표값=확인된 횡단 중 최소 + 모름 N곳 병기. AC3 경로 **선택 비용은 변경 없음**. AC4 승인 시안의 `~12초` 문자열 일반 모드 0 | → T3, T13-15 | M | VM 표(혼합 모름/음수), Playwright C/E 갱신(`cov-text` 문구 변경 포함) |
| T17 | 첫 화면 가치(숫자 없이) | AC1 홈에서 이력 지도층이 보이고 한 줄로 쓰는 순간을 말한다(문구는 사용자 결정 D3). AC2 `계산 준비 중`이 아니라 지금 확인된 사실(예: 이 길의 횡단 N곳 중 이력 M곳)을 제시 | T11, 사용자 결정 D3 | S~M | Playwright E |

## 5. 병렬 묶음과 순서

묶음 안의 항목은 서로 다른 파일 영역이라 병렬 가능하다. 묶음 사이는 의존이 있다.

- **1묶음 (토대)**: T1(시험 인프라) · T2(정리) · T3(gate 평가 함수) · T14·T13의 데이터 수령 요청 시작(사용자 키·현장). 충돌 지점: T2와 T3가 같은 app.js 신호부(56-100)를 만지므로 T2는 신호 코드를 건드리지 않게 범위를 제한한다.
- **2묶음 (숫자와 무관한 화면 갭, 전부 병렬)**: T5(조건 조정 시트) · T6(위치 사전 시트) · T7→T10(지도 선택→검색 정합) · T8(미확인 펼침) · T9(걷는 중) · T11(지도 층) · T4(계산 기준 시트, T3 뒤). 충돌 지점: T4·T5·T8이 모두 결과 화면 시트 높이 로직 `fitResultSheet`(screens.js:71)를 쓰므로 그 함수의 시험(360x640에서 두 버튼 화면 안, C 시험)을 먼저 고정하고 묶음 시작.
- **3묶음 (gate, 증거가 있을 때만)**: T13·T14·T15 데이터 → T16 표시 개방 → T12 횡단 상세 → T17 첫 화면 문구 확정. T13-15가 막히면 3묶음 전체가 `정직한 비개방 MVP`로 끝난다(§7 D1).
- **4묶음 (출시 전 확인)**: 768x1024·가로·200% 글 확대 시험(PRODUCT_SPEC §10-9), 실제 휴대전화 보행 시험(0회). 4묶음은 코드가 아니라 사람 일이며 gate를 여는 어떤 결정보다 먼저 일부(위치·학습)라도 해야 한다.

## 6. 그늘로에서 배울 기능 중 현재 구조로 가장 싼 것 3개

그늘로가 이미 하는 것이라 **차별점이 아니라 완성도**로만 쓴다(Mary 5-2).

1. **경로 행의 속성 칩** (횡단 N / 계단 N구간 / 오르막 Nm / 지하도 있음): 데이터가 이미 계산돼 있다 — `route.x.length`, `r.stairs`, `r.rise`, `r.under.length`, `sim.knownN/unknownN`(app.js buildRoute·simulate). `route-facts` 문구(screens.js:95 근처)를 칩 3-4개로 바꾸는 렌더 변경뿐이다. 크기 S. 검증: VM `routeChips(r, sim)` + Playwright C. 두 후보가 같은 시간이어도 칩이 달라 보이게 하는 그늘로의 패턴 그대로.
2. **출발 시각 고르기**: `state.dep`과 `data-dep` 처리, 시각 변경 시 두 길을 다시 찾는 `refreshSims` 경로가 이미 있다(app.js:584-). 신호는 24시간 파일이 있으나(`signal-hours/00..23.json` [확인]) 근거 질 차이는 시간대마다 다르므로(Mary: 08~10시 중심) **이력 밖 시각은 '모름'으로** 보여야 한다. 크기 S~M. 검증: VM(`known` 경계는 check_walk_logic.cjs에 이미 있음)+Playwright. 주의: 지원 밖 시각에 숫자가 새지 않는 것이 AC.
3. **계단 3단 (피할래요 / 균형 / 괜찮아요)**: 지금은 불리언 `avoidSteps`(app.js:176 `e.cls===3 && readProfile().avoidSteps → continue`)지만 탐색에는 이미 가중치 모드 `"gentle"`(weight 3, app.js:183)이 있다. '균형'은 계단을 막지 않고 비용만 올리는 모드로 대응된다. 프로필 스키마 변경(`avoidSteps` → 3값) 마이그레이션이 붙어 크기 M. 검증: check_profile.cjs에 구버전 불리언 → 3값 매핑, check_walk_logic.cjs에 모드별 경로 단언.

고려했지만 뺀 것: 경사 그래프(지형 자료 해상도 약 120m [확인: README], 막대 그래프를 믿을 근거 약함), 무더위쉼터·그늘(범위 밖).

## 7. 위험: gate 개방이 기존 시험·UI에 미치는 영향

[확인: 코드] 현재 여유 숫자는 **표시 경로에서만 막혀 있고 계산 경로는 이미 신호 이력을 쓴다**. 즉 숫자를 열어도 `sigWait`·`search`·`simulate`는 이미 돈다. 영향은 다음과 같다.

| 항목 | 영향 | 대응 |
|---|---|---|
| 경로 선택 비용 | `jjuk` 후보는 `wait+assumedWait+stops*15+stairMeters*2+rise*8`로 고르며(app.js:591) **여유를 쓰지 않는다**. 여기에 여유를 넣으면 `state.same`(app.js:604)이 뒤집혀 `check_screens` C(같은 후보=서대문역→청계광장, 다른 후보=종각역→혜화역)와 `check_walk_logic.cjs` 58-61의 `state.same`·`stairs` 단언이 함께 깨진다. 이름 `여유 있는 길`의 의미(검증된 여유 주장 아님, PRODUCT_SPEC §6)도 바뀐다 | **T16 AC3: 표시 전용**, 비용 변경은 별도 스토리·별도 사용자 승인(D4) |
| `MIN_GREEN=8` | `sigWait`의 대기 의미용이다(app.js:87-95). 여유 계산에 재사용하면 대기 시간(ETA)과 여유(완료 가능성)가 한 상수에 묶인다 | 여유는 별도 함수·별도 상수, `MIN_GREEN`은 그대로 |
| 방향 모호성 | `signalPlan(id,t,undefined)`이 임의의 첫 방향을 돌려줘(app.js:62) 숫자가 한 방향의 값으로 나갈 수 있다 | T3 AC5로 `undefined`→null, 기존 `known('test',28800,null)===false` 단언(check_walk_logic.cjs 28줄)과 일치 |
| 속도 변경 | 여유는 속도에 직접 의존. `tripKeyNow`(app.js:550)에 `SPEED`는 있으나 수동/자동/임시 근거 종류는 없다 | 키에 근거 종류(estimated/manual/provisional)를 넣어 임시 기본 1.0m/s가 개인 여유로 새지 않게 |
| 문구 | `cov-text`("건널 여유는 표시하지 않아요", screens.js ~95)·`marginCellText`·계산 기준 패널 문구·`result-safety`가 모두 "닫힘"을 전제로 쓰여 있다 | T16에서 상태별 문구 표를 한 곳으로 모으고 E 시험의 문구 단언을 같이 갱신 |
| 시험 | check_screens E의 "학습 부족 → 계산 준비 중, 숫자 초 없음"은 그대로 유효(속도가 없으니 여전히 숨김). 새로 필요: 증거 true일 때만 숫자, 음수 부호, 혼합 모름(최솟값 + `모름 N곳`), `?demo=1` 외 일반 모드에 `~12초` 0 | T3의 VM 표 + E 한 시나리오 |
| 데이터 질 | 방향 대응 가정 셀 82.6%만 평일끼리 95% 이상 일치(brief)이므로 **개방하면 일부 횡단은 틀린 숫자**가 된다. 그래서 신호 단위 `holdout_accuracy`/`observed_samples`([확인]: signal-hours 필드)를 증거에 써야 한다 | T13 기준 미달 횡단은 숨김 유지 |

## 8. 다른 역할 입장에 대해 예상되는 반대·충돌 2개와 내 대응

1. **PM(John) 또는 Sally: "gate가 닫힌 채로는 MVP가 아니다, 먼저 열자 / 먼저 18프레임을 다 만들자."**
   내 대응: 둘 다 아니다. 닫힌 채 출시하는 것은 가능하지만(2묶음만으로 '정직한 비개방 MVP') 가치가 약하고, 연 채 출시하려면 T13-15의 데이터가 필요해 L이다. 둘을 순서로 풀자는 것이 내 제안: 2묶음(화면)과 3묶음(데이터)을 **병렬로 시작**하고, 데이터가 기준을 못 넘으면 닫힌 상태로 출시한다. 18프레임 전부가 아니라 **13개 항목 중 숫자와 무관한 8개(T4-T11)**가 MVP, `crossing-detail`(T12)은 gate 뒤.
2. **Winston(아키텍트): "지금 모듈화·번들러·프레임워크 전환부터."**
   내 대응: 반대. 배포가 빌드 없는 정적이고(vercel.json), 시험이 전역에 붙어 있으며(§2-2), 전환 자체가 L이라 화면 갭·데이터가 밀린다. 순수 부분 분리(T3의 `marginFor`, `basisRows`, `routeChips`)를 **새 코드부터** 지키고 기존은 건드릴 때만 옮기는 점진 분리를 제안. 단 `esc()` 전수 점검과 CI 화면 시험(T1)은 아키텍처 논의와 무관하게 먼저.

## 9. 다른 역할에게 묻고 싶은 것 2개

1. **Winston에게**: gate 증거(`direction/length/flash/date` 4종)를 앱이 읽을 정적 파일(예: 신호별 `evidence.json`)로 둘지, 현재 `signal-hours/NN.json` 각 대역에 필드를 추가할지. 전자는 파일이 하나 늘고 후자는 30MB 샤드가 커진다. 선택이 T3 AC와 T13-15 산출물 형식을 정한다.
2. **Sally에게**: 계산 기준 시트의 5행 태그(실선/점선/파선)와 지도의 `이력 있음`/`미확인` 스타일이 같은 모양 언어인가. 같다면 CSS 토큰 하나로 T4·T11을 묶을 수 있다. 또한 T6(위치 사전 시트)에서 브라우저 권한창이 이미 뜨는 환경에서 시트가 한 번 더 막는 것이 이득인지(클릭 한 번 추가) 판단해 달라.

## 10. 사용자에게 필요한 결정 (최대 5개)

- **D1 · gate 개방 시도 여부와 기준.** (a) 방향·길이·점멸을 현장/공공자료로 검증해 숫자를 열려는 시도를 MVP 범위에 넣을 것인가, (b) 숫자 없는 MVP로 먼저 내보내고 개방은 이후로 미룰 것인가. 넣는다면 통과 기준(표본 수, 불일치율)을 누가 정하는가. 제 추천은 (b)를 기본, (a)는 병렬 시도.
- **D2 · 열린데이터광장 인증키(OA-21209 전체)를 사용자가 발급해 줄 수 있는가.** 없으면 T14는 시작할 수 없다. 키는 환경변수로만 두고 저장소에는 넣지 않는다.
- **D3 · 한 줄 약속에 '쓰는 순간'을 넣을지(Mary H1).** T17의 문구가 이것에 달렸다. 제 입장은 문구 자체보다 "숫자 없이도 오늘 보이는 사실"(횡단 N곳 중 이력 M곳)을 첫 화면에 둘 수 있다는 구현 가능성만 보장.
- **D4 · `여유 있는 길` 이름의 의미.** 현재 선택 기준은 대기+계단+오르막이다(app.js:591). 나중에 여유를 비용에 넣어 이름 그대로가 되게 할지(경로·시험 영향 큼), 이름만 선택지 이름으로 유지할지.
- **D5 · 시험 책임의 선.** CI에 Playwright를 넣는 비용(설치·시간)을 감수할지, 로컬 시험 + PR 체크리스트로 둘지. 제 추천은 390x844 한 뷰포트만 CI에 편입(T1).

## 11. 검증 상태 (내가 실행한 것)

- `node scripts/check_app_shell.cjs` / `check_profile.cjs` / `check_walk_logic.cjs` / `check_places.cjs`: 모두 PASS [확인].
- `python3 -m pytest -q`: 59 passed [확인].
- `node scripts/check_screens.cjs`: 2분 13초, 오류 없이 종료, 마지막 단계(360x640 측정 중지)까지 출력 [확인; 종료 코드와 SKIP 여부는 `real` 시간 출력으로 확인했고 실패 문구는 없었다].
- 실제 휴대전화·Safari·공개 배포 주소 확인은 하지 않았다 [모름].
- 출력 보관: `/tmp/claude-0/-home-user-DeeplearningApplication1/81d85301-0811-5800-b421-2042850d1c0b/scratchpad/team/amelia3/screens.out`.
