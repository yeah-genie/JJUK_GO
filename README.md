# 쭉고 (JJUK GO)

> 가장 짧은 길이 아니라, **기다리는 시간이 가장 짧은 길**.

현재 제품 방향: **비슷하게 걸리면, 덜 힘든 길.** 기존 신호 기능을 바탕으로 경사·계단까지 함께 비교하는 Walking 서비스로 확장합니다. 버스·지하철은 후순위입니다. [방향과 단계별 계획](docs/PRODUCT_DIRECTION.md).

서울시 C-ITS 보행신호 데이터를 이용해 `보행시간 + 예상 신호대기시간`이 가장 짧은 도보 경로를 찾는 프로젝트입니다.

## 문제
지도앱의 최단 도보경로는 신호대기를 고려하지 않습니다. 조금 돌아가더라도 빨간불에 덜 걸리는 길이 실제로는 더 빠를 수 있습니다.

```
최단경로   걷기 10:40 + 예상대기 3:10 = 13:50
쭉 가는 길  걷기 12:00 + 예상대기 0:55 = 12:55
```

## 로드맵
| 단계 | 내용 | 데이터 |
|---|---|---|
| V1 신호 적은 길 | 신호 횡단보도에 고정 페널티 | 도보 네트워크, 횡단보도–신호 매핑 |
| V2 기다림 적은 길 | 횡단보도별 기대 대기시간을 비용으로 하는 시간의존 Dijkstra | 자동 수집한 신호 이력 |
| V3 실시간 보정 + 예측 | 가까운 신호는 실시간, 중간 거리는 딥러닝 예측, 먼 신호는 이력 평균 | C-ITS 실시간 API |

대상 지역(MVP): 강남구 테헤란로 일대.

## 신호 데이터 자동 수집
GitHub Actions의 연속 실행이 약 5분(305초) 간격으로 교차로 한 곳씩 C-ITS API를 호출해 `data` 브랜치에 신호 이력을 쌓습니다. 모든 교차로의 5분 갱신을 뜻하지 않으며, 호출 실패와 이력 공백은 별도 점검이 필요합니다. 호출 예산은 설정상 하루 한도의 70%로 제한합니다.
처음 한 번 리포 Secrets에 `SEOUL_TDATA_API_KEY`만 등록하면 됩니다. → [docs/DATA_COLLECTION.md](docs/DATA_COLLECTION.md)

```bash
PYTHONPATH=src python -m jjukgo.collect once --dry-run --data-dir /tmp/jjukgo
python -m pytest -q
```

> ⚠️ 모든 시간은 예상값입니다. 길 선택을 돕는 용도이며, 횡단 시에는 반드시 실제 신호를 확인하세요.

## 프로토타입 실행

지도·검색·길찾기 데이터는 `docs/prototype/seoul/`에 포함되어 있어 별도 ZIP이 필요 없습니다.

```bash
python -m http.server 8766 --bind 127.0.0.1 --directory docs/prototype
```

브라우저에서 <http://127.0.0.1:8766/#home>을 여세요. HTML 파일을 직접 열면 데이터 요청이 막힐 수 있으므로 HTTP 서버로 실행합니다. 지도 라이브러리와 웹폰트 로딩에는 인터넷 연결이 필요합니다.

## 문서 목록
- [Walking 1차 데모 구현 계획·GPS 범위](docs/FIRST_DEMO_PLAN.md)
- [수집 상태·공공 데이터·네이버/카카오 차별화 조사](reports/쭉고%20데이터와%20차별화%20검증.md)
- [최신 제품 방향: 신호·경사·계단 Walking](docs/PRODUCT_DIRECTION.md)
- [작업 인수인계와 현재 상태](docs/HANDOFF.md)
- [날짜별 사용자 논의 기록](docs/discussions/2026-10-28.md)
- [제품 흐름 검토와 개선 우선순위](docs/PRODUCT_REVIEW.md)
- [기획서](docs/PROPOSAL.md)
- [데이터 수집](docs/DATA_COLLECTION.md)
