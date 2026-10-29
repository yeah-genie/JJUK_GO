# 04. 구현 보고 (Amelia, 시니어 개발자)

- 브랜치 codex/refine-time-results. 범위: Winston 결함 1~5·7·8, Sally 발견 1~6. 순서는 red(시험 먼저) → green → 화면 확인.
- 소스: `docs/prototype/src/app.js`, `docs/prototype/src/template.html` (빌드 산출물 `docs/prototype/index.html`은 `python3 scripts/build_prototype.py`로 재생성해 같이 커밋).
- 시험: `scripts/check_walk_logic.cjs`(결함별 구역 W1~W8, S2~S6b 추가), `scripts/check_prototype_ui.cjs`(CSS·구조 검사 추가), `scripts/check_pace_browser.cjs`(재연결·90% 미만·?demo=1·pagehide·포커스 추가).
- 캡처: `/tmp/claude-0/-home-user-DeeplearningApplication1/81d85301-0811-5800-b421-2042850d1c0b/scratchpad/team/amelia/` 의 `base-*`(수정 전), `final-*`(수정 후), 390x844·360x640 각 7화면.

## 1. 먼저 실패를 확인한 시험 (red)

`node scripts/check_walk_logic.cjs` 를 새 시험만 넣은 상태로 실행하면 11개 구역이 모두 실패했다(`resumeTrack is not defined`, `dur is not defined`, `walks={"a":1}` 예외, 걸린 시간 불일치, `pagehide` 핸들러 없음 등). 구현 뒤 전부 통과.

## 2. Winston 결함

| 항목 | 고친 곳 | 방법 | 시험 |
|---|---|---|---|
| 1 재연결이 기록을 쪼갬 | `app.js` `resumeTrack`, `renderWalk(demo, resume)`, `[data-gps-retry]` | 재연결은 `endWalk()`를 부르지 않고 같은 `walkTrack`을 유지한다. 아직 세지 않은 마지막 걸음만 더하고 앵커를 비워 끊긴 사이를 잇지 않는다. 기록은 걷기 화면을 떠나거나 '걷기 끝내기'일 때만 마무리. 시연 버튼은 이전처럼 마무리 | W1, 브라우저(같은 객체, 기록 건수 불변, 두 걷기=두 건) |
| 2 시계 통일 | `newTrack`/`trackAdd`/`trackElapsedS`/`finishTrack(tr, info, now)` | `start`는 첫 위치 시각, 끝낼 때 `end=max(end, 끝낸 시각)`. 화면(`walkStats`)과 기록이 같은 `trackElapsedS` 구간을 쓴다 | W2 |
| 3 저장값 손상 | `paceProfile`, `loadWalks`, `walkSpeed`, `endWalk` | `pace`는 객체·범위(0.5~2.2)·유한수 검증, 벗어나면 기본값. `walks`는 배열·필드 검증 후 걸러냄. 자동 모드도 `clampSpeed`. `endWalk`는 `try/catch/finally`로 예외가 나도 화면 전환이 막히지 않고 `stopGPS()`를 부른다 | W3 (`walks`=`{"a":1}`, `5`, `"abc"`, `[null]` 등, `pace.speed`=`"abc"`/100/-1/null, finishTrack 예외) |
| 4 저장 실패 문구 | `store.set`이 true/false 반환, `finishTrack`이 `rec.unsaved`, `arrivalCopy`, `renderMe`(`#me-save`) | 저장 못 하면 도착 카드 힌트와 내 걸음 문구가 모두 '이 기기에 저장하지 못했어요(사생활 보호 모드일 수 있어요)'로 바뀌고 '이 기기에만 저장해요'는 나오지 않는다 | W4 |
| 5 pagehide | `addEventListener("pagehide", …)` | `endWalk(); stopGPS();`만 한다. sessionStorage·초안 키·좌표 저장 없음 | W5, 브라우저(키 목록에 draft 없음, sessionStorage 0, 좌표 없음) |
| 7 접근성 | `renderMe`, 클릭 처리, `setText`, `gpsStatus`, `template.html` | 속도 칩을 누른 뒤 같은 칩에 포커스 복원. 기록 지우기는 첫 누름 '한 번 더 누르면 지워져요'(5초), 두 번째에 삭제, 삭제 뒤 포커스는 '그냥 걷기 시작'으로. `#pace-chips`에 `role="group"`·`aria-label="길찾기에 쓸 속도"`. 걷기 중 위쪽 카드·상태 줄은 값이 바뀔 때만 쓰고, GPS 상태 문구에서 매초 바뀌던 갱신 시각을 빼고 오차를 5m 단위로 | W7, 브라우저, `check_prototype_ui` |
| 8 기록 의미 | `finishTrack`, `homePaceSub`, `renderMe` | 경로 걷기에서 걸은 거리가 경로의 90% 미만이면 `arrived:false`, 도착지 이름(`to`)을 붙이지 않고 목록에는 '도중에 끝냄'. 개수는 목록 줄 수 기준으로 표시(`pace.walks` 35와 목록 30 불일치 해소). 프리셋에 없는 모드는 'undefined' 대신 '직접 고름 · 3.6km/h' | W8 |

결함 8의 속도 학습 제외 대신 '도중에 끝냄' 표시를 골랐다. 도중에 끝낸 기록의 속도는 그대로 평균에 섞인다(아래 한계).

## 3. Sally 발견

| 항목 | 방법 | 결과 |
|---|---|---|
| 1 버튼 잘림 | 원인은 시트 높이를 한 번만 계산해 상태 줄·글줄 변화 뒤 버튼 줄이 시트 밖으로 밀리는 것이었다(`snaps('home').mid=328`, 실제 `h=310`). 홈·걷기의 버튼 줄을 `.sheet-footer`로 빼고, `snaps`가 본문+버튼 줄 높이를 재며, `ResizeObserver`로 내용이 바뀌면 다시 맞춘다. 작은 화면 시트 상한 .5→.72 | 버튼 bottom: 390x844에서 832(전 850/860), 360x640에서 628(전 646/654). 뷰포트 이하 |
| 2 결과 위계 | 설명 카드를 흰 면·노랑 좌측 바로 낮추고 문구 `같은 길이에요` / `2분 더 걸어도 덜 힘든 길이 없어요.`. 경로 카드 시간 36px, 이름 `추천`. 메타 줄 `08:40 예시 · 4.0km/h · 신호 45초/곳 가정`(`resultNote`). `계산 기준`, `더 걸어도 되는 시간`, 칩 `+0분`. 같은 띄어쓰기 오류가 있던 `곳당45초`, `연결35m`, `약120m`도 같이 고침 | S2, 화면 확인 |
| 3 표기 통일 | 시간은 `dur`(`2분 01초`, `1시간 05분`), 속도는 km/h(걷기 화면 `속도`, 도착 카드 `평균 속도`, 기록표 `속도`). 90% 미만이면 제목 `걷기 · 서대문역에서 130m`, 줄 `예상 30분 00초 · 실제 2분 00초(130m 구간)`, 힌트 '도중에 끝낸 걷기 기록이에요'. 카드 어디에도 '도착'이 없다 | S3, 브라우저 |
| 4 내 걸음 줄 | 노랑 좌측 바 4px, 라벨 15px/700, 최소 높이 52px. 문구 `기록 없음 · 보통 속도` / `기록 N번 · 내 속도` | S4, 화면 확인 |
| 5 터치 타깃·글씨 | `.icon-btn` 44x44, `.chip`·`.link-btn`·`.trip-pt`·`[data-time-step]`·시각 입력·`.gc-row .use` 최소 높이 44, 지도 버튼 44, 손잡이 영역 확대. 보조 글씨 12.5px 이상(스케일 막대 포함). 멈춤 열에 `회` | `check_prototype_ui`(CSS 검사), 캡처 측정에서 두 해상도 모두 44 미만 0건·12.5px 미만 0건 |
| 6 걷기 화면 | 그냥 걷기: 위 카드가 걸은 거리, 아래는 시간·속도 두 칸(거리 중복 제거), 설명은 한 문장. 경로 걷기: 이름 없는 안내(`다음 안내 503m`만 있던 카드)는 만들지 않고 위 카드를 '남은 거리'로. 신호 문구는 첫 5초만 노랑, 이후 회색 `실시간 신호 정보 없음`. `움직임 시연` 칩은 `?demo=1`일 때만 | S6·S6b, 브라우저(5초 뒤 문구, 시연 칩 유무) |

스크롤바: 두 해상도 7화면 모두 막대 0개, 가로 넘침 없음(캡처 스크립트 측정과 `check_pace_browser`의 스크롤바 검사).

## 4. 실제 실행한 검증 (마지막 수정 뒤)

| 명령 | 결과 |
|---|---|
| `python3 scripts/build_prototype.py` | 생성(index.html 203,735자), 소스와 동기화 |
| `node scripts/check_walk_logic.cjs` | 통과 (exit 0) |
| `node scripts/check_prototype_ui.cjs` | 통과 (exit 0) |
| `python3 -m pytest -q` | 64 passed |
| `node scripts/check_pace_browser.cjs` (서버 `docs/prototype`, 8766) | 3회 연속 통과 (exit 0 ×3) |
| `node scripts/check_walk_browser.cjs` | 실패. `check_walk_browser.cjs:78` `waitForFunction` 30초 초과. 수정 전(`git stash`로 되돌린 상태)에도 같은 줄에서 같은 실패. 시험 GPS 위치가 보행로 35m 밖이라는 기존 문제이며 이번에 고치지 않음 |

중간에 `check_pace_browser`가 한 번 실패한 일이 있었다. 내가 새로 넣은 `elapsedS` 상한(125초)이 시험 가짜 시계에 실제 대기 시간이 더해지는 것을 계산하지 않아서였고, 상한을 150초로 고쳤다(제품 결함 아님).

## 5. 하지 않은 것

- John 1번(MIN_GREEN), 3번(35m 연결 제한), 4번(지형 미확인 0비용), Winston 결함 6(속도 추정 임계값): 지시대로 건드리지 않음.
- Winston 5의 초안 저장(15줄 추가안)은 하지 않았다. pagehide 저장만 했다.
- Winston 7의 `#me-speed` 라이브 영역(`role="status"`)은 하지 않았다(지시 목록에 없음).
- Winston 4의 `walks`·`pace` 한 키 합치기는 하지 않았다. 둘 중 하나만 저장되면 `unsaved`로만 알린다.
- Sally 4의 선택 항목(홈에 `그냥 걷기` 보조 버튼 직접 노출), 6의 `위치 다시 연결`을 오류 때만 보이게 하는 것, `이 구간도 필요해요` 등 '한국어 문구 메모'(기록 날짜 형식 포함)는 지시 범위 밖이라 하지 않았다.
- 결과 화면 작은 화면(높이 700 미만)에서 시트 중간 높이를 .68→.62로 낮췄다(지도 버튼이 위쪽 출발·도착 막대와 겹치던 것을 해소). 대신 경로 카드 아래 내용은 스크롤로 본다. 보고서에 없던 조정이라 알려 둔다.

## 6. 남은 한계

- 도중에 끝낸 기록(90% 미만)의 속도는 여전히 내 걸음 속도 평균에 섞인다. 표시만 구분했다.
- 걸은 거리 판정은 GPS로 센 `meters` 기준이다. GPS가 끊기면 실제보다 적게 세어 90% 미만으로 나올 수 있다(경로 투영 진행률은 쓰지 않았다).
- 걸린 시간은 첫 위치부터 끝낸 시각까지의 벽시계다. 화면이 숨겨진 동안도 포함된다(John 2번의 '숨긴 시간 제외'는 범위 밖). 재연결 사이 끊긴 시간도 같은 걷기라 포함된다.
- pagehide가 오지 않는 강제 종료·탭 폐기(OS가 죽이는 경우)에서는 진행 중 기록이 여전히 사라진다.
- 지도 위 숫자 표식(`.m-sig` 11px)과 지도 저작권 표기(10px), 숨겨진 `.badge`는 12.5px 미만이다. 지도 표식 크기는 건드리지 않았다.
- 웹 폰트(Black Han Sans)가 차단된 시험 환경의 대체 글꼴로만 레이아웃을 확인했다. 실제 글꼴에서 도착 카드 3열 숫자 폭, 큰 글씨 설정(200%), 실제 기기 safe-area, 스크린 리더 낭독은 확인하지 못했다.
- 실제 휴대전화로 걸어 본 결과는 없다. 모든 GPS 시험은 가짜 위치다.
