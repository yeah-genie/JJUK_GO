# 쭉고 (JJUK GO)

**서두르지 않아도 되는 길.** 내 걸음과 이동 조건에 맞춰, 작은 추가 시간 안에서 계단·오르막·횡단 부담을 비교하는 서울 보행 데모입니다.

[공개 데모](https://jjukgo.vercel.app/) · [현재 문서 안내](docs/DOCUMENTATION_INDEX.md) · [개발 인수인계](docs/HANDOFF.md)

선택 설문으로 시작하고, 내 걸음은 GPS 길 안내 중 유효 관측이 쌓이면 맞춥니다. 횡단 여유는 방향·길이·점멸 검증 전이라 아직 숫자로 제공하지 않습니다. 예상 시간에는 과거 신호 이력·미확인 신호 대기 가정이 들어가며, 실제 신호와 무장애 통행을 보장하지 않습니다.

## 프로토타입 실행

지도·검색·길찾기 데이터는 `docs/prototype/seoul/`에 포함되어 있어 별도 ZIP이 필요 없습니다.

```bash
python -m http.server 8766 --bind 127.0.0.1 --directory docs/prototype
```

브라우저에서 <http://127.0.0.1:8766/#home>을 여세요. HTML 파일을 직접 열면 데이터 요청이 막힐 수 있으므로 HTTP 서버로 실행합니다. 지도 라이브러리와 웹폰트 로딩에는 인터넷 연결이 필요합니다.

## 개발 기준

- [제품 정의](docs/PRODUCT_DEFINITION.md), [제품·화면 명세](docs/PRODUCT_SPEC.md), [디자인 시스템](docs/DESIGN_SYSTEM.md)
- [구현 검증](reports/ASPHALT_IMPLEMENTATION.md), [보행 데이터·개인 속도 조사](reports/보행%20확장%20데이터와%20개인%20속도.md)
- [대화 기록](docs/discussions/2026-10-29.md), [기존 수집 운영 문서](docs/DATA_COLLECTION.md)

기존 수집 코드와 이력은 연구용으로 보존합니다. 이번 화면 작업에서 API 반복 수집을 다시 켜지 않았습니다. 오래된 문서의 5분 호출·실시간 제공 표현은 현재 수집 상태를 뜻하지 않습니다.
