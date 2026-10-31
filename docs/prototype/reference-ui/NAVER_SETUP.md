# 네이버 지도 연결 — 사용자 발급 절차와 구현 경계

2026-10-31. **모듈 구현 상태이며, 실제 Client ID를 발급받아 인증·타일·지도 표시까지 확인한 상태는 아니다. 운영 배포도 하지 않았다.**

## 사용자에게 필요한 작업

1. [네이버 클라우드 콘솔](https://console.ncloud.com/)에서 **Services → Application Services → Maps**의 새 Maps 상품을 연다. 오래된 AI NAVER API 지도 상품과 혼동하지 않는다. [공식 안내](https://guide.ncloud-docs.com/docs/maps-app/)도 새 Maps 상품의 이 경로로 이동하라고 안내한다.
2. Application을 등록하고 지도 API에서 **Web Dynamic Map**을 선택한다. 모바일 앱 SDK는 웹 프로토타입에 필요하지 않다. 이용 약관·현재 요금/무료 이용량은 사용자가 확인한다. [공식 Application 안내](https://guide.ncloud-docs.com/docs/maps-app/)의 이용량·한도·임계치 알림을 설정해 둔다.
3. Web 서비스 URL에는 다음 호스트를 등록한다. **포트, `/reference-ui/` 같은 경로, `#home`은 넣지 않는다.** [공식 인증 오류 안내](https://guide.ncloud-docs.com/docs/maps-troubleshoot/)의 예시도 포트와 경로를 제외하도록 설명한다.

   ```text
   http://localhost
   http://127.0.0.1
   https://jjukgo.vercel.app
   ```

   별도 Vercel preview에서 확인할 때는 그 preview의 정확한 호스트도 추가해야 한다. 운영 주소 등록만으로 임의 preview 호스트까지 허용된다고 가정하지 않는다.

4. 인증 정보에서 **Client ID**를 확인한다. 이것은 웹 지도 SDK가 브라우저에 사용하는 식별자다. **Client Secret은 채팅·GitHub·브라우저 JS에 넣지 않는다.** 이번 배경 지도에는 Secret을 사용하지 않는다.
5. 로컬 설정 `window.JJUKGO_MAP_CONFIG.naverClientId`에 Client ID를 넣는다. 설정 파일·빌드 연결은 루트 구현자가 처리한다. Client ID도 사용자 동의 없이 다른 계정/서비스에서 재사용하지 않는다.

SDK 호출은 [공식 SDK 시작 문서](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)의 새 파라미터 `ncpKeyId`를 사용한다. 오래된 일부 문제 해결 문서의 `ncpClientId` 예제를 복사하지 않는다.

## 개발 연결

```js
await JJUKGO_NAVER.load(JJUKGO_MAP_CONFIG.naverClientId);
const view = JJUKGO_NAVER.render(document.getElementById('ref-map'), {
  coords: route.coords,      // 기존 엔진에서 계산한 [경도, 위도][]
  currentLL: gpsFix?.ll,     // 실제로 확인된 위치만
  crossings: [{ll:[127.0,37.57],state:'unknown'}],
  next: {ll:[127.001,37.571],distanceM:74,state:'unknown'},
  summary: false,
  sample: false
});
view.resize();
view.setCurrent([127.0,37.57]);
view.center([127.0,37.57],16);
view.destroy();
```

- 모듈의 `load`는 키 미설정/형식 오류/인증 오류/스크립트 네트워크 오류/12초 지연을 구분해 reject한다. 호출 측은 기존 MapLibre 지도를 유지하며 안내한다. 키가 없는데 네이버 연동 성공이라고 표시하지 않는다.
- 동시 동일 키 로드는 하나로 합친다. 다른 키로 로드 중이면 거부한다. 지연된 옛 callback이 새 시도를 성공으로 바꾸지 못하게 분리한다.
- `render`는 파란 Polyline과 HTML Marker를 그린다. 다음 횡단 callout은 해당 Marker의 HTML 내부에 붙고 `Point(22.5,22.5)` anchor로 실제 지도 좌표를 따라간다. 화면 가운데 고정하는 카드가 아니다. [공식 HTML Marker 예제](https://navermaps.github.io/maps.js.ncp/docs/tutorial-5-marker-html-icon.example.html).
- `state:'walk'|'wait'` 색상은 `trusted:true`가 있을 때만 사용한다. 그 외는 회색이다. `trusted`는 데이터 엔진이 근거를 검증한 결과여야 하며 지도 SDK 인증 성공과 무관하다. 디자인 검토의 `sample:true`에서는 명확한 예시 자료만 넣는다.
- 지도 로고·출처는 유지한다. `logoControl`/`mapDataControl`을 끄거나 CSS로 가리지 않는다. [Map API](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)의 `fitBounds`, `setSize`, `destroy`를 사용한다.

## 쭉고와 네이버의 역할

네이버는 **배경 지도 렌더링**을 담당한다. 쭉고의 기존 서울 보행 그래프, 계단/경사/횡단 정보와 추가 시간 예산을 비교해 **조금 더 걸리더라도 편한 길**을 고르는 계산은 유지한다. 네이버 Directions 5의 [공식 설명](https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving)은 자동차 경로 API다. 보행 경로 계산을 그 API로 바꾸지 않는다. Web Dynamic Map 발급만으로 네이버의 모든 가게 검색·보행 길찾기·실시간 신호가 제공되는 것도 아니다.

## 위치와 외부 통신

- 이 모듈은 검색어, 원시 GPS 궤적, 위치 로그를 서버에 업로드하거나 별도 분석 API로 전송하지 않는다.
- 네이버 SDK를 켜면 사용자 브라우저가 네이버에 SDK/지도 타일을 요청한다. 요청 위치·지도의 표시 영역과 네트워크 메타데이터를 통해 지역이 전달될 수 있다. ‘네이버를 써도 어떤 위치 정보도 외부로 나가지 않는다’고 말하면 안 된다.
- 현재 위치 마커에는 확인된 `currentLL`만 넣는다. 미연결 상태를 서울 기준점이나 예시 위치로 속이지 않는다.
- 운영 전 SDK 제공자 고지·위치 권한 안내·수집 범위 문구를 검토한다. 키가 없으면 외부 지도 SDK를 요청하지 않는다.

## 검증 결과 / 미완료

- JS 구문 검사와 Node VM의 가짜 SDK 계약 검사 **통과**: 키 누락, 동일 키 동시 호출 공유, 다른 키 충돌, 인증/네트워크/timeout 거부, 늦은 callback 격리, 좌표 검증, HTML 이스케이프, 미검증 신호 회색 처리, callout anchor, 로고 옵션 유지, 리사이즈/현재 위치 갱신, 반복 destroy 안전성. 네이버 인증 성공이나 지도 타일 실증으로 간주하지 않는다.
- Client ID 발급 후 로컬/preview/운영 각각에서 도메인 인증, SDK 로드, 경로 선·마커·말풍선 정렬, 터치/리사이즈, 로고 출처 가림, GPS 미연결 상태, 오류 시 기존 지도 복귀를 실제 브라우저에서 확인해야 한다.
- 인증 전인 현재 시점에 이 체크를 통과했다고 쓰거나 운영 적용하지 않는다.

## 로컬 실제 연결 검증 갱신

2026-10-31 사용자에게 공개 Client ID를 받은 뒤 실제 로컬 인증·지도 타일·경로·NAVER 출처 표시를 확인했다. Client ID는 .env.local로 분리했고 /api/map-config가 브라우저 공개 식별자만 반환한다. 위의 ‘미검증’은 모듈 최초 작성 시점의 상태다.

SDK가 부모와 다른 크기를 읽던 문제는 부모 기준 size 명시로 고쳤다. callback 이후에도 필수 클래스 준비를 확인하며, 최초 tilesloaded 전에는 기존 표시를 유지한다. handle.ready, updateSignals, showSignal/closeSignal, fitRoute, setCurrent 및 destroy를 제공한다. 클릭 상세는 SDK InfoWindow를 해당 마커 위치에 연결한다. 초 단위 갱신으로 지도를 다시 만들지 않고 마커 내용/상세 텍스트만 바꾼다. 운영 반영·실시간 신호 검증·휴대전화 야외 GPS를 완료했다는 뜻은 아니다.
