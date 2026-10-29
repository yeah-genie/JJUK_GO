# 03. 적대적 코드 리뷰: 걸음 속도 추정·걷기 기록 (Winston, 시스템 아키텍트)

- 대상: 커밋 c692c0f (`docs/prototype/src/app.js` '내 걸음' 절, `template.html`), 브랜치 codex/refine-time-results
- 방법: 코드는 수정하지 않았다. Node VM과 Playwright(가짜 geolocation, 시계 이동)로 직접 돌려 재현된 것만 "확인"으로 적었다.
- 재현 스크립트(임시): `/tmp/claude-0/-home-user-DeeplearningApplication1/81d85301-0811-5800-b421-2042850d1c0b/scratchpad/team/winston/` 의 `vm1.cjs`, `pw1.cjs`, `pw2.cjs`
- 줄 번호는 `docs/prototype/src/app.js` 기준이며 따로 적은 것만 `template.html`이다.

Winston의 한 줄 평: 구조는 단순하고 좌표를 저장하지 않는 원칙도 지켜졌다. 다만 "걷기 한 번 = 기록 한 건"이라는 가정이 세 군데에서 새고(재연결, 시간 경계, 새로고침), 저장소를 신뢰하는 쪽의 방어가 반쪽이다. 트레이드오프를 같이 적는다.

---

## 확인된 결함 (심각도 순, 8건)

### 1. [중간-높음] "위치 다시 연결"이 걷기 한 번을 두 기록으로 쪼갠다 (확인)
- 재현: 경로 걷기에서 fix 50개(100초) 진행, `[data-gps-retry]` 클릭, 다시 fix 50개(100초), "걷기 끝내기".
- 기대: 기록 1건(약 200초, 약 240m), 도착 카드에 전체 걸린 시간.
- 실제: `walks`에 `{elapsedS:100,m:116}`, `{elapsedS:100,m:99}` 두 건이 쌓이고 `pace.walks=2`. 도착 카드는 `예상 23:39 · 실제 1:40 · 120m`으로 마지막 조각만 보여 준다. 속도 학습도 두 번 일어난다.
- 이 경로가 흔한 이유: 앱이 "30초 넘게 위치 갱신이 없어요. 다시 연결해 주세요"(1054행)라고 직접 안내하고 그 칩이 항상 보인다.
- 원인: 1308행 `[data-gps-retry]` → `renderWalk()` → 965행 `endWalk()`가 진행 중인 기록을 마감하고, 1023행에서 새 `walkTrack`을 만든다. `state.lastWalk`도 마지막 조각으로 덮인다.
- 수정(최소): `renderWalk(demo, keepTrack)`처럼 재연결일 때는 `endWalk()`를 건너뛰고 기존 `walkTrack`을 유지한 채 `watchPosition`만 다시 건다. 또는 `walkTrack.anchor = null`만 하고 같은 트랙을 이어 간다. 시연 버튼은 지금처럼 마감해도 된다.

### 2. [중간] 기록의 "걸린 시간"이 실제 걸은 구간과 어긋난다 (확인)
- 재현 A (VM): GPS 첫 fix가 60초 늦게 오고 이후 100초 걸음 → `elapsedS=160`, `moveS=100`.
- 재현 B (VM): 마지막 fix 이후 40초 동안 fix가 없다가 140초 시점에 끝내기 → `elapsedS=100` (눌러서 끝낸 시점과 40초 차이).
- 기대/실제: 걷는 중 화면 `w-time`은 `Date.now()-start`(957행)를 쓰는데 기록은 `tr.end-tr.start`(105행)라서, 끝내기 직전 화면에 보이던 시간과 도착 카드 시간이 서로 다르다. 권한 팝업·GPS 잠금 시간은 걸린 시간에 들어가고, 마지막 fix 뒤 시간은 빠진다.
- 원인: `newTrack`이 화면을 연 시각을 `start`로 잡고(36-38행), `end`는 fix 시각으로만 갱신한다(41행). 시계 기준이 둘이다.
- 수정(최소): `start`를 첫 유효 fix 시각으로 지연 설정(`if(!tr.anchor) tr.start = fix.timestamp`)하고, 끝낼 때 `tr.end = Math.max(tr.end, Date.now())`로 맞추거나, 화면 표시도 `tr.end` 기준으로 통일한다. 둘 중 하나로 통일하는 것이 핵심이다.

### 3. [중간] localStorage 값이 깨지면 끝내기 버튼이 죽고 GPS는 계속 돈다 (확인, 조건: 값 손상)
- 재현(브라우저): `jjukgo:walks='{"a":1}'` 상태에서 그냥 걷기 후 `#walk-done` 클릭.
  - 첫 클릭: 화면이 `#walk`에 머문다. `walkTrack=null`, GPS 구독은 살아 있고, 기록은 사라진다. pageerror `store.get is not a function or its return value is not iterable`.
  - 두 번째 클릭: `walkTrack`이 이미 null이라 `endWalk`가 조용히 반환하고 그제야 `#me`로 간다. 기록은 없다.
  - `walks=5`도 같은 오류(VM). `walks=[null]`이면 저장은 되지만 `renderMe()`가 `Cannot read properties of null (reading 'at')`로 던진다(1106행 map). `walks="abc"`이면 `walks.map is not a function`.
- 같은 뿌리: `paceProfile()`이 값을 검증하지 않는다. `pace.speed="abc"` → `SPEED="abc"`, 홈에 `NaNkm/h`, 결과 화면이 "길을 못 찾았어요 / 강·고속도로 등"이라는 엉뚱한 오류를 낸다(브라우저). `speed=100`이면 360km/h, `speed=-1`이면 `-3.6km/h`(VM). 자동 모드는 `p.speed || DEFAULT`(91행)로 clamp를 건너뛴다.
- 원인: 106행 `[rec, ...store.get("walks", [])]`는 배열 보장이 없고, 91행 `walkSpeed`는 auto 값을 clamp하지 않으며, 952행 `endWalk`는 `walkTrack=null`을 먼저 하고 예외를 가두지 않는다.
- 수정(최소): `store.get`에 타입 가드를 둔다(`const w=store.get("walks",[]); Array.isArray(w)?w:[]`, `walks`는 `filter(x=>x&&typeof x==="object")`). `walkSpeed`는 `clampSpeed(+p.speed)`가 유한수일 때만 쓴다. `endWalk`는 `try{...}finally{}`로 감싸 예외가 화면 전환을 막지 않게 한다. 이 앱의 `jjukgo:` 접두 키는 같은 오리진을 공유하는 다른 페이지나 개발자 도구로만 깨지므로 확률은 낮고 수정 비용도 낮다.

### 4. [중간-낮음] 프라이빗 모드·용량 초과에서 저장이 조용히 실패하고 화면 문구와 모순된다 (확인)
- 재현: `Storage.prototype.setItem`이 던지도록 한 뒤 경로 걷기 60 fix → 끝내기.
- 기대: 저장이 안 된다는 안내 또는 최소한 모순 없는 표시.
- 실제: 도착 카드는 `걸린 시간`과 `GPS 걷기 기록`을 보여 주고, `내 걸음` 화면은 `기록 0줄 / 아직 기록이 없어 보통 속도로 계산해요`인데 하단 문구는 "이 기기에만 저장해요"다. 예외는 없다(try/catch가 삼킨다). 학습된 속도도 저장되지 않아 `applyPace()`가 SPEED를 바꾸지 못하는데 사용자에게는 이유가 보이지 않는다.
- 원인: `store.set`(22행)이 실패를 반환하지 않는다. 107행은 성공 여부와 무관하게 `rec`를 반환한다.
- 수정(최소): `store.set`이 `true/false`를 반환하게 하고 `finishTrack`이 실패 시 `rec.unsaved=true`를 달아 도착 카드·내 걸음 화면에 "이 기기에 저장하지 못했어요(사생활 보호 모드일 수 있어요)" 한 줄을 띄운다. `walks`와 `pace`는 한 키로 합치면 반만 저장되는 불일치도 막는다.

### 5. [중간-낮음] 걷는 중에 새로고침하면 진행 중인 기록이 통째로 사라진다 (확인)
- 재현: 그냥 걷기에서 120초 걸은 뒤 `page.reload()`. `localStorage.walks=null`, 화면은 `#search`(`freeWalk`가 메모리뿐이라 `renderWalk`가 `go("result")`→검색으로 간다).
- 해시 변경·뒤로 가기는 문제가 없었다: `location.hash='home'` 후 뒤로 가기에서 기록 1건, 중복 없음(`show()`가 `endWalk()`를 부른다. 1276행). 문제는 `pagehide`/새로고침/탭 종료뿐이다. 모바일에서 백그라운드로 가서 OS가 탭을 버리는 경우도 같다.
- 원인: 기록이 `walkTrack` 메모리에만 있다. `pagehide`·`visibilitychange` 처리가 없다.
- 수정(최소): `addEventListener("pagehide", endWalk)` 한 줄. 더 나아가면 20초 구간 마감 때마다 좌표 없는 요약(`moveM, moveS, stops, start`)을 `jjukgo:draft`에 쓰고 다음 부팅 때 30m·30초 넘으면 기록으로 승격한다. 트레이드오프: 한 줄 수정은 새로고침·탭 닫기는 막지만 프로세스 강제 종료는 못 막는다. 초안 저장은 둘 다 막지만 코드가 약 15줄 늘고 부팅 때 정리 규칙이 필요하다. 프로토타입에는 한 줄 수정을 권한다.

### 6. [낮음-중간] 속도 추정 편향: 느린 걸음은 전부 "멈춤"이 되고, 멈춤-걸음이 섞이면 낮게 나온다 (확인)
- 재현 (VM, 정확도 5~8m 가정):
  - 0.7m/s로 180초 걸음 → `moveM=0, stopS=180, rec=null`. 기록도 속도도 없다. 0.9m/s는 정상(0.90).
  - 1.2m/s로 15초 걷고 15초 서기를 반복 → 추정 `0.84m/s` (실제 걷는 속도 1.2), 멈춤 10회로만 센다.
  - 신호 대기형(40초 걷고 30초 서기)은 `1.10~1.17`로 3~8% 낮다. 구간 경계의 20초 창이 걷기와 서기를 섞기 때문이다.
- 의미: `PACE.MIN=0.5`는 자동 모드에서 도달할 수 없다. 노약자·유모차·목발 사용자는 앱이 "속도를 모른다"고 한다. 그리고 쭉고는 신호 대기를 따로 더하는 앱이라, 이미 대기가 섞여 낮아진 속도를 쓰면 대기를 이중으로 치게 된다(보수적 쪽 편향).
- 원인: 52-53행의 `d < noise` 판정이 `noise=max(8, 정확도평균)`라 0.8m/s(=8m/10초)보다 느리면 10초 창에서 항상 `d<8`이다. 창을 20초 고정으로 평균 내는 방식이 서기와 걷기를 섞는다.
- 수정(최소): `PACE.STEP`을 `5`로 낮추거나 `stopWin`을 `max(15, ...)`로 올려 0.5m/s까지 잡히게 한다(대신 정지 흔들림 오판이 늘 수 있어 정확도 8m 이하일 때만 적용). 편향은 "서기 창을 걷기 창과 분리"하려면 창을 10초로 줄여야 하는데 지금 주석(50행)이 2초 간격 오차 누적을 이유로 20초를 택했으므로, 실기기 데이터 없이 바꾸지 말고 한계로 명시하는 쪽이 낫다.

### 7. [낮음-중간] 접근성: 포커스 소실, 확인 없는 삭제, 라이브 영역 갱신 폭주, 이름 없는 칩 그룹 (확인, 스크린 리더 낭독은 미확인)
- 포커스: 속도 칩을 키보드로 선택(Enter)하면 `renderMe()`가 `#pace-chips.innerHTML`을 통째로 바꿔(1104행) `document.activeElement`가 `BODY`로 간다. "기록 지우기"도 같다. 키보드·스위치 사용자는 칩을 바꿀 때마다 처음부터 다시 탭해야 한다.
- 확인 없는 삭제: `#walks-clear`(1315행)는 기록과 학습한 속도(`speed/moveS/walks`)를 한 번에 지운다. 확인·되돌리기가 없다. `mode`만 남는다.
- 라이브 영역: `template.html:533`의 `.next[aria-live=polite]` 안에서 그냥 걷기는 1초마다 `update(null)`(1024행)이 `next-dist`, `next-state`, `next-say`의 `textContent`를 같은 값으로 다시 쓴다(990-994행). MutationObserver로 5초에 15회 변이를 확인했다. 같은 문장을 반복 낭독할 수 있다(낭독 자체는 미확인).
- 이름·역할: `#pace-chips`(template 607행)는 `role="group"`도 `aria-label`도 없어 "길찾기에 쓸 속도"라는 `sec-title`과 연결되지 않는다. 속도가 바뀌어도 알리는 라이브 영역이 없다(`#me-speed`).
- 터치 크기: 뒤로 `icon-btn`은 32px(template 64행, 기존 스타일). 칩은 57px, 홈 `pace-row`는 51px로 문제없다.
- 이름 혼동: `그만 걷기`(`#walk-end`)와 `걷기 끝내기`(`#walk-done`)는 문구가 비슷한데 둘 다 기록을 남기고(아래 8번), 이동 화면만 다르다.
- 수정(최소): 칩 클릭 뒤 `renderMe()` 끝에 `$("pace-chips").querySelector('[aria-pressed="true"]')?.focus()`, 칩 컨테이너에 `role="group" aria-labelledby`, `#me-speed`를 포함한 `.pace-hero`에 `role="status"`, 자유 걷기의 `next-*` 텍스트는 값이 바뀔 때만 쓴다(`if(el.textContent!==v)`), 기록 지우기는 `confirm` 또는 두 번 누르기.

### 8. [낮음] 기록 의미의 사소한 불일치 (확인)
- `그만 걷기`(1311행)도 `endWalk()`를 거쳐 120m만 걸은 경로 걷기를 `to:"청계광장"`으로 저장한다. 목록에는 "청계광장까지 / 120m"로 보이고 속도 학습에도 들어간다(S10). 도착한 기록과 중도 종료를 구분할 필드(`arrived`)가 없다.
- `pace.walks` 카운터는 35번 걸으면 35, 목록은 30건에서 잘린다(106행 `.slice(0,30)`). 홈 문구 "기록 35번으로 잰 속도"와 목록 줄 수가 다르다(VM).
- 모드가 프리셋 값이 아닌 숫자(예: 저장소 `mode:1.0`)이면 홈 부제가 `undefined으로 설정`(829행)이다. 값 검증 없는 `paceProfile()`의 같은 뿌리.
- 수정(최소): 기록에 `arrived: 도착 판정 여부`를 넣고 목록에서 "중간까지 걸음"으로 표시한다. 홈 부제는 `?.label ?? "직접 설정"`.

---

## 확인 못 한 것 (미확인)

- 스크린 리더(VoiceOver/TalkBack)가 `aria-live` 변이를 실제로 반복 낭독하는지: 변이 횟수만 확인했다.
- 실기기 GPS 지터에서의 편향 크기: 합성 궤적(정확도 5~8m)으로만 봤다. 정확도가 25m에 가까운 환경의 정지 판정은 미확인.
- 콜드 스타트 보정: 첫 fix 정확도 24m → 4m로 바뀌며 위치가 22m 튀면 정지한 사람이 22m 걸은 것으로 센다(VM, 20초 창). 영향은 작고 실기기 재현은 못 했다.
- 위치가 30초를 넘게 끊긴 구간(`PACE.GAP`)에서 걸은 거리 66m가 기록에서 빠지는 것(VM). 설계 의도(주석 33행)와 같아 결함으로 세지 않았다. 35초 간격으로만 오는 저전력 GPS는 기록이 0이 된다(VM, 실기기 미확인).
- `pace.speed=-1`일 때 결과 화면: `sims`는 만들어졌고 오류는 없었으나 값의 의미는 검증하지 못했다.
- 여러 탭이 동시에 `walks/pace`를 읽고 쓰는 경쟁(마지막 쓰기 승리). 코드상 가능하나 미재현.
- iOS Safari의 7일 저장소 삭제(ITP)로 학습 속도가 사라지는 경우.

## 확인했으나 결함이 아닌 것 (음성 결과, 재현 시도 후 기각)

- 데모(움직임 시연)는 기록·속도에 섞이지 않는다. 시연 중 `walkTrack=null`, 10초 후에도 `walks=0`, `pace` 키 없음. ETA도 `SPEED`만 쓴다(1000행).
- 시연 뒤 도착 카드에 이전 기록이 남는 `state.lastWalk` 오염은 재현되지 않았다. `renderWalk`가 새 `walkTrack`을 만들고 `endWalk`가 항상 `lastWalk`를 덮어쓰기 때문이다.
- 첫 fix 직후 종료, fix 0개 종료는 `null`을 돌려주고 예외가 없다. 같은 timestamp·역행 timestamp·시계 역행(−100초)도 예외 없이 무시된다(역행 뒤 구간은 세지 않아 거리가 줄 수 있음: 140초 걸음에서 `moveS=60`).
- 해시 변경·뒤로 가기·앞으로 가기로 기록이 중복되거나 새지 않는다(기록 1건).
- 속도 변경 뒤 결과 화면은 재계산된다. 0.9m/s 선택 후 `#result`로 돌아오면 `walk=1602초=길이/0.9`로 일치한다. `fixedRoute`는 `refreshSims`에서 즉시 소비되어 오래된 경로가 덮는 경로는 만들지 못했다.
  - 단, 속도를 바꾼 뒤 `#depart`로 직접 가면 결과 카드(1419초, 이전 속도)와 달리 출발 목록은 새 속도로 계산(1889초)해 서로 어긋난다. `renderDepart`/`renderDone`/`renderDetail`은 `tripKeyNow()` 불일치를 검사하지 않는다(`state.tripKey` 대비). 정상 내비게이션으로는 `me`를 거치면 결과가 재계산되어 도달하기 어려워 낮은 심각도로 두고 8건에서 제외했다. 수정은 `show()`에서 `detail/depart/done/walk`일 때 `state.tripKey!==tripKeyNow()`이면 `go("result")`.
- `store.get`의 깨진 JSON(`{bad`)은 기본값으로 복구된다.

## 수정 우선순위 제안 (Winston)

1. 1번(재연결 쪼개기)과 2번(시간 기준)은 같은 함수 주변이라 한 번에 고친다. 사용자 눈에 가장 먼저 보인다.
2. 3번의 `Array.isArray`/`clamp`/`try-finally` 세 줄은 비용이 거의 없다.
3. 5번은 `pagehide` 한 줄, 7번은 포커스 복원과 `role="group"`부터.
4. 6번은 코드보다 문서화(알려진 한계)가 먼저다. 실기기 기록 몇 건이 쌓이기 전에는 임계값을 만지지 않는 것이 맞다. 규칙 3(추상화는 세 번 본 뒤)과 같은 이유다.
