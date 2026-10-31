# 코덱스(GPT)에게: 다음에 하면 좋은 일 (2026-10-31, Claude 작성)

이 문서는 제안이다. 사용자가 순서와 범위를 정한다.

## 지금 상태
- 공개 화면: https://jjukgo.vercel.app → `/reference-ui/`. 코덱스가 만든 새 화면이 바탕이다. 옛 화면은 `/classic`.
- 작업·배포 브랜치는 `ccr-94bac9df-i81579` 하나다. push하면 바로 Vercel에 배포된다.
- 역할: 사용자가 "UI 디자인은 지피티, 그 밖은 Claude"로 정했다(10/31). 다만 10/31 저녁에는 사용자 요청으로 Claude가 결과·걷기·요약 화면의 **구조**를 지도 앱 형식으로 바꿨다. **모양 다듬기는 코덱스 몫**으로 남겼다.
- 사용자가 원하는 방향(10/31): "네이버나 카카오 같은 UI나 기능에 보행신호 남은시간, 신호대기까지 따져 길고르기를 추가하는 느낌", "카카오나 네이버 맵의 장점은 따와". 로고는 바꾸지 않는다. 색은 원래 색(남색·노랑)을 쓴다.

## 10/31 저녁 Claude가 바꾼 것 (모양은 거칠다)
- 파일: `docs/prototype/reference-ui/ui.js`, `ui.css`, `signal-evidence.js`, `naver-map.js`. 빌드는 `python3 scripts/build_reference_ui.py`. `ui.js`는 따로 불러오는 파일이다.
- **결과 화면**(`refResult`, CSS `.ma-result`·`.ma-top`·`.ma-sheet`·`.ma-card`·`.ma-dep`):
  - 위: 출발·도착 막대
  - 아래 경로 카드: 총 시간 = 걷기 + 예상 신호 대기, 도착 시각, 🚦 신호 대기·신호 수
  - 출발 시각 칩: 지금 / 5·10·15분 뒤, 바꾸면 신호 대기를 다시 계산
  - 공유, 조건
  - 다른 후보 길은 회색 선
- **걷기 화면**(`refNav`, `.ma-turn`·`.ma-banner`·`.ma-navbottom`·`.ma-bar`):
  - 위 방향 카드: 가까운 꺾기나 횡단보도
  - 신호 띠: 300~60m는 "도착하면 약 N초 대기", 60m 안은 "N초 뒤 초록불/빨간불". 초록이 건너기에 짧으면 "다음 초록을 기다려요"
  - 아래 막대: 남은 시간(신호 대기 포함)·도착 시각·일시정지·종료(확인)
  - 지도가 내 위치를 따라감(손으로 움직이면 멈춤)
  - 화면 꺼짐 방지(Wake Lock), 음성 자동 안내
- **요약**(`refSummaryReal`, `.ma-sumsig`): 걸은 시간·거리·멈춘 시간(실측), 이 길의 신호(출발 전 예상). 걸은 기록이 0이면 요약을 띄우지 않는다.
- 회의·결정 근거:
  - `docs/discussions/2026-10-31-bmad-playtest.md`
  - `docs/discussions/2026-10-31-user-pain-list.md`
  - `docs/discussions/2026-10-31-vs-naver-kakao.md`
  - `docs/discussions/2026-10-31-bmad-meeting-2.md`

## 코덱스에게 제안하는 일 (중요한 순서)
1. **새 화면 모양 다듬기.** 결과 카드, 위 방향 카드, 신호 띠, 아래 막대, 요약 화면. 지금은 기능만 맞춘 거친 모양이다. 지도 앱처럼 익숙하되 쭉고 색과 로고에 맞게.
   - 구조와 아래 "건드리지 않을 것"의 ID는 유지한다.
   - 신호 띠가 이 앱의 첫인상이다. 숫자(초)가 가장 먼저 눈에 들어와야 하고, 색만으로 상태를 말하지 않는다(원·글자·모양을 함께).
2. **결과 화면 아래 시트를 끌어서 높이 바꾸기(3단).** 지금은 내용 높이에 맞춘 고정 시트다(`refFitSheet`). 360×640에서 지도가 작다.
3. **확인 창을 앱 안 시트로.** 종료, 먼 길(5km 넘음) 확인이 지금은 브라우저 `confirm()`이다.
4. **홈을 지도 우선 화면으로.**
   - 지도 + 위 검색창 + 집·회사 즐겨찾기 + 최근 목적지. 네이버·카카오의 기본 형태다.
   - 출발지는 위치 권한이 있으면 이미 '내 위치'로 자동으로 들어간다.
5. **검색.**
   - 주소 표시: 검색 자료 `search.json`에 주소가 없어 자료 확인이 먼저 필요하다.
   - 오타 제안, 서울 밖 장소 즉시 안내, '장소' 탭 필터, Enter.
   - 거리·분류 표시는 됐다.
6. **경로 상세 목록.** 꺾는 지점·횡단보도를 순서대로 보여 주고, 횡단보도마다 도착 때 예상 신호를 붙인다. 엔진의 `routeGuidance`, `route.x`, `SIG.verdict`를 쓰면 된다.
7. **신호 아이콘 정리.**
   - 결과 화면은 '도착할 때' 기준 색이고, 걷는 중은 '지금' 기준이다. 차이를 보여 주는 범례 한 줄이 필요하다.
   - '모름'(회색·시계)도 범례에 넣는다.
   - 출발 표시와 신호 아이콘이 겹치는 곳(혜화역)도 손본다.
8. **네이버 지도 위에서 실제로 확인.** Claude 작업 환경에서는 네이버 지도가 뜨지 않아 기본 지도로만 봤다. 아래를 확인해 주면 좋다.
   - 회색 대안 길(`altCoords`)
   - 신호 창 위치(지도를 150px 내림)
   - 내 위치 따라가기, 지도를 끌면 멈추는지
9. **뒤로가기·새로고침.** 안드로이드·브라우저 뒤로가기를 누르면 앱 밖으로 나간다. 걷는 중 새로고침하면 기록이 사라진다(history 처리).

## 건드리지 않을 것 (정직·안전 규칙)
- 금지어: 뛰세요 / 안전 / 보장 / 무장애
- 예측에는 '(예상)'을 붙인다. 신호는 실시간이 아니다(과거 기록 패턴). 실시간 API(10381)는 승인 전이다.
- 모르는 값은 지어내지 않는다('모름', '이 시간대 신호 기록 없음').
- 서두름 방지: 초록이 건너기에 짧으면 숫자보다 "다음 초록을 기다려요"를 보여 준다.
- 신호 신뢰 판정(`trustedPlan`, `planConfidence`, `signal-evidence.js`의 qualified 조건)은 바꾸지 않는다.
- `ui.js`의 1초 갱신이 쓰는 ID는 지우지 않는다(이름을 바꾸면 갱신 코드도 같이 고친다):
  - 걷기 화면: `#ref-next-distance`, `#ref-instruction`, `#ref-turn-icon`, `#ref-signal-banner`, `#ref-banner-main`, `#ref-banner-sub`, `#ref-next-summary`, `#ref-left`, `#ref-time`, `#ref-arrival`, `#ref-speed`, `.ref-reroute`, `.next-crossing`, `.ma-end`, `.ma-bar-copy>span`
  - 경로 카드: `data-ref-route`
  - 출발 시각 칩: `data-ref-dep`
  - 버튼 동작: `data-ref-action`(start, pause, finish, recenter, layers, share, conditions, reroute, swap-find)
- 비밀 키는 저장소에 넣지 않는다(네이버 Client ID는 Vercel 환경변수 `NAVER_MAP_CLIENT_ID`).
- 모델 이름은 커밋·문서에 쓰지 않는다.

## 돌려 볼 시험
```bash
python3 scripts/build_reference_ui.py
node scripts/check_reference_ui.cjs && node scripts/check_walk_logic.cjs && node scripts/check_app_shell.cjs
node scripts/preview.cjs &   # http://127.0.0.1:8771/reference-ui/index.html?from=37.5446,127.0560&to=37.5444,127.0374&fn=성수역&tn=서울숲
```
- 신호 패턴이 있는 시각(평일 13~15시)으로 시계를 고정해야 초읽기가 보인다. 가짜 GPS와 시계 고정 예시는 이 문서와 함께 올린 `scripts/play_reference_walk.cjs`에 있다.
- 엔진(`docs/prototype/src/app.js`)을 바꾸면 `python3 scripts/build_prototype.py`도 돌린다. CI가 `docs/prototype/index.html`이 빌드 결과와 같은지 검사한다.
