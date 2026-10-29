# 계단 경사 공공 데이터 검증

확인일: 2026-10-28 (Asia/Seoul). 자료 존재·공식 명세 확인과 실제 다운로드/API 호출 성공을 구분한다. 대용량 파일이나 사용자 키를 내려받거나 사용하지 않았다.

## 계단도로 데이터와 API가 실제 있는가

### Takeaway

서울시 **통행불편지역 공간정보(OA-21207)**가 바로 사용할 우선 후보다. 계단 구분코드와 라이선스, 공간파일 다운로드 목록, 별도 API 명세까지 확인했다. 단, API 출력 명세에는 geometry/좌표가 없어 보행 그래프 결합에는 공간파일이 더 적합하다.

### Cited Findings

- 공식 페이지는 자치구별 통행불편지역의 GIS 위치·속성 데이터라고 설명한다. 좌표계 **EPSG:5186**, 인코딩 **windows-949**, 법적 효력 없는 참고자료. 다운로드 목록은 `서울시 통행불편지역 공간정보.zip` 2.59MB(파일 수정일 2026-09-08), `PASSWEAK_AREA.zip` 2.28MB(2022-04-03). 메타의 데이터 갱신일 2026-10-03과 파일 수정일은 다르다. — [서울 열린데이터광장 파일 목록](https://data.seoul.go.kr/dataList/OA-21207/S/1/datasetView.do)
- 공식 이용허락은 **공공누리 1유형: 출처표시, 상업적 이용·변경 가능**이며 갱신주기는 수시(월간)로 표기된다. — [같은 공식 데이터 페이지](https://data.seoul.go.kr/dataList/OA-21207/S/1/datasetView.do)
- API 서비스명 `passWeak`, 샘플 `http://openapi.seoul.go.kr:8088/(인증키)/xml/passWeak/1/5/`; KEY 필수, JSON/XML 등과 START_INDEX/END_INDEX 페이징을 지원한다. `SE_CD`는 **1 차량통행불가 / 2 계단도로 / 3 막다른도로 / 4 축대**. — [서울시 OpenAPI 명세](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do)
- API 출력은 `SN`, `PSRD_ICVNC_RGN_NM`, `SE_CD`, `EXMN_YMD`, `RMRK`, `SGG_CD`로 명시돼 있다. geometry·경위도 출력은 이 명세에서 보이지 않는다. — [동일 API 명세](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do)
- 개별 구의 현장조사 범위 예시로 금천구 공식 발표는 2025년 92개 통행불편길 중 계단도로 38곳의 360도 영상 구축을 설명한다. 이 숫자는 서울 전체 계단 수나 OA-21207의 총 레코드 수가 아니다. — [금천구 공식 보도자료](https://www.geumcheon.go.kr/portal/selectBbsNttView.do?bbsNo=8&id=&integrDeptCode=null&key=297&nttNo=256263&pageIndex=52&searchCnd=all&searchCtgry=&searchDeptCode=&searchKrwd=)

### Inferences

- 공간파일에서 계단도로를 필터링하고 EPSG:4326 등 기존 그래프 좌표계로 변환해 OSM 계단 구간과 맞추는 접근이 합리적이다. 코드2가 API와 공간파일에서 동일한 필드명/타입으로 들어가는지는 파일을 열어 검증해야 한다.
- 이 자료는 조사된 통행불편지역이다. 누락을 ‘계단 없음’으로 처리하면 안 된다. API가 있다고 해서 바로 좌표 기반 라우팅용 API라고 표현하지 않는다.

### Gaps

- 인증키 호출·공간파일 실제 다운로드/압축 내부 필드·geometry 유형·총 행 수·구별 계단 커버리지는 이번 조사에서 테스트하지 않았다.
- 다운로드 파일 배포가 ZIP 형식인 것과 사용자 저장소에 ZIP을 보관하는 것은 별개다. 향후 처리 시 필요한 공간파일을 추출해 작은 파생 JSON 등으로 저장하고 원본 ZIP을 Git에 넣지 않을 수 있다.

## S MAP과 국토지리정보원의 경사 자료는 바로 쓸 수 있는가

### Takeaway

S-MAP은 계단·경사 **시각 확인과 표고/경사 분석 도구**로 확인됐다. 이를 근거로 외부 앱용 수치 경사 API가 있다고 말할 수는 없다. 국토지리정보원의 DEM 성과목록도 실제 높이 격자와 구분해야 한다. 추가 확인 결과, 아래의 **공개 DEM 원자료 다운로드 경로(15059920)**도 공식적으로 존재한다. 따라서 ‘국내 경사 산출용 공공 자료 자체가 없다’는 결론은 틀리며, 서울 도엽의 해상도·파일 획득 검증이 남아 있다.

### Cited Findings

- S-MAP에는 통행불편지역과 경사지도 레이어가 있다. 통행불편지역 범례에 계단도로가 표시된다. **‘경사지도’ 범례 단위는 m**(0·10·40·100·200·250 이상)로 표기된다. — [서울시 S-MAP](https://smap.seoul.go.kr/)
- 공식 가이드는 시작·끝 지점을 고르면 지형의 경사도/스카이라인을 보는 분석과 한 지점의 표고 재기를 설명한다. — [S-MAP 사용가이드](https://smap.seoul.go.kr/guide/guide.html)
- **별도 DEM 원자료 제공 페이지(15059920)**는 IMG 형식, 무료, 이용허락범위 제한 없음으로 명시하고, 국토정보플랫폼에서 간편지도 검색→영역 지정→공개DEM→항목 선택으로 내려받도록 안내한다. **로그인과 대용량 파일전송 S/W**가 필요하다. 메타데이터(15067637)와 구별되는 실제 제공 경로다. 다만 이번에 로그인·프로그램 설치·서울 도엽 다운로드를 하지는 않았으며, 페이지에 서울 도엽 격자간격이 명시되지 않아 5m라고 확정하지 않는다. — [국토교통부 국토지리정보원 DEM 공식 제공 페이지](https://www.data.go.kr/data/15059920/fileData.do)
- 국토지리정보원 공공데이터포털의 `항공사진_수치표고성과내역`은 도엽번호·격자간격·최고/최저표고·정확도 등 **도엽별 성과 메타정보**다. 무료·이용허락 제한 없음으로 표시되지만 CSV/JSON/XML 목록 자체가 서울 도로를 샘플링할 DEM 높이 래스터는 아니다. — [국토지리정보원 DEM 성과내역](https://www.data.go.kr/data/15067637/fileData.do)
- NGII가 고해상도 DEM을 구축한다는 것은 공식 고시에서도 확인되지만, 접경지역 5m DEM 고시는 보안상 대민 서비스 불가라고 적는다. 모든 5m DEM이 모든 사용자에게 즉시 개방된다고 일반화하면 안 된다. — [국토지리정보원 2025년 접경지역 기본측량 고시](https://www.ngii.go.kr/nlsc/service/nsoperation2/board?id=102815)
- NGII의 오래된 공식 브로슈어(2017)는 1m/5m/10m 비공개, 90m 일반공개로 표기하지만 2021년 공공 연구보고서는 5m DEM을 공개자료라고 적는다. 시기·지역·등급에 따른 차이가 있어 현재 서울 특정 도엽의 제공 조건을 직접 확인해야 한다. — [NGII 2017 브로슈어](https://www.ngii.go.kr/lib/file/pr_01.pdf), [국토교통부 산하 CODIL 공공 연구보고서](https://www.codil.or.kr/filebank/original/RK/OTKCRK210395/OTKCRK210395.pdf?stream=T)

### Inferences

- S-MAP의 m 단위 경사지도 색을 그대로 5%·10% 경사로 읽거나 보행 경사로 변환하면 안 된다. 경사율은 인접 표고차/수평거리로 따로 계산해야 한다.
- 실제 도로 경사 산출에는 접근 가능한 지형 DEM(DTM 선호)의 해상도·수직 오차·좌표계·표고 기준 확인이 먼저다. 육교·지하도·건물 계단은 지표면 DEM으로 대체할 수 없다.
- 현 단계의 우선순위는 서울 계단 공간파일 확보가 더 명확하며, DEM은 별도 도엽 접근 확인 작업으로 분리하는 편이 좋다.

### Gaps

- S-MAP 원시 표고/경사 데이터의 대량 다운로드나 공개 외부 수치 API 명세·라이선스는 이번 조사에서 확인하지 못했다. 화면 기능 존재를 API 연동 가능으로 기록하지 않는다.
- VWorld 공식 개발자 문서(`https://www.vworld.kr/dev/v4dv_3dmap2_s001.do`)는 이 조사 도구로 열리지 않았다. 지형 데이터 API의 현재 키·도메인·해상도·쿼터·재배포 조건을 검증하지 못했으므로 ‘바로 사용 가능’ 목록에서 제외한다.
- 현재 서울의 특정 5m/10m DEM 다운로드 승인·요금·재배포 권한은 미검증이다. 공식 메타정보의 ‘제한 없음’은 메타정보에 대한 조건이지 모든 원본 격자 조건으로 확장할 수 없다.

## 글로벌 공공 DEM을 보조 후보로 쓸 수 있는가

### Takeaway

Copernicus DEM GLO-30/90은 한국을 포함한 세계 범위의 공식 보조 후보다. 다만 도시의 짧은 계단이나 도로 수준 경사를 정확히 판단하기에는 해상도와 DSM 특성의 한계가 있어 검증용·거친 언덕 분류용으로 한정해야 한다.

### Cited Findings

- 공식 컬렉션은 GLO-30(30m), GLO-90(90m)의 글로벌 커버리지와 일반 등록 사용자 다운로드 가능·출처 고지 의무를 설명한다. **건물·식생·인프라를 포함하는 DSM**이다. — [Copernicus DEM 공식 컬렉션](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- 공식 API 문서는 DEM Process API와 30/90m 인스턴스를 제공하되, 30m는 CCM 등록이 필요하고 미지정 시 90m를 기본 사용한다고 명시한다. — [Copernicus DEM API 문서](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html)
- 2026-07-28부터 30m View Service 접근에는 CCM 사용자 등록 및 권한 조건이 적용된다는 공식 공지가 있다. — [2026-07-17 접근조건 변경 공지](https://dataspace.copernicus.eu/news/2026-7-17-copernicus-dem-30m-view-service-license-acceptance)
- 전체 데이터 다운로드는 공식적으로 S3 호환 스토리지와 OData API를 지원하며 인증·임시 자격증명 흐름이 안내된다. — [CDSE 공식 FAQ](https://documentation.dataspace.copernicus.eu/FAQ.html)

### Inferences

- 30m 표면 모형을 5m 간격으로 보간해도 원자료의 해상도가 5m로 개선되는 것은 아니다. 도시 골목의 수십m 급경사나 계단 없음 보장을 만들기 어렵다.
- 대기업과 차별화할 핵심은 이 공공 DEM의 독점이 아니라, 연결된 보행 그래프의 실제 계단·입체보행 구간 검수와 출처/불확실성을 보존하는 품질이다.

### Gaps

- 사용자 계정을 만들거나 CCM 약관 동의·인증·서울 타일 다운로드를 수행하지 않았다. 국내 고해상도 DEM 대체재로 확정하지 않는다.
