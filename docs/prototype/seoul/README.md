# 서울 프로토타입 데이터

2026-10-28 사용자 소유 쭉고 아티팩트에서 복원한 375개 실행 파일입니다. ZIP이 아닌 개별 파일로 보관합니다.

- `tiles/`: 지도 벡터 타일 묶음과 인덱스
- `graph/`: 보행 그래프 조각과 인덱스
- `signals.json`: 신호 교차로 위치
- `search.json`: 장소 검색 목록
- `glyphs/`: 지도 문자 표시용 데이터

지도·도로망·장소: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). 신호 교차로: 서울 C-ITS 및 OSM. 글리프: Noto Sans, SIL Open Font License. 생성 방식과 입력 자료는 `scripts/build_seoul_map.py`를 참고하세요.

원본: https://claude.ai/artifact/PdN4J4FMDoX31ErpxzqCPE

## 지형 파생 데이터 추가

`terrain.json`: 2026-10-28 [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)에서 접근한 Mapzen 공개 지형 타일33장을 약120m 간격으로 축소한 자료. 재생성: `python scripts/build_terrain.py`(Pillow 필요). ZIP은 포함하지 않는다.

지형 제공: Mapzen; 전 지구 SRTM/GMTED2010 등은 USGS 제공 자료. [제공자별 출처·조건](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), [형식](https://github.com/tilezen/joerd/blob/master/docs/formats.md). 앱에서 보간·방향별 상승량 계산에 사용한다. 제공 기관이 이 가공이나 경로 추천을 검증·승인했다는 의미가 아니다. 개별 도로·육교·계단 높이나 무장애 여부를 나타내지 않는다.
