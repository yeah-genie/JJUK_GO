# 계단 경사와 연속 접근성 데이터

확인일: 2026-10-29 Asia/Seoul. 작성 범위는 계단·경사·턱·폭·노면·보행망이다. 벤치·승강기·인파와 집단별 보행속도는 다른 조사 담당이다. 앱 코드·수집·설정·Git·공유 인수인계 파일을 변경하지 않았다. 공개 작은 파일은 메모리에서만 읽었고 ZIP을 디스크에 남기지 않았다.

## 실제로 쓸 수 있는 공식 데이터는 무엇인가

### Takeaway

계단 후보와 보행망은 실제 공식 응답/파일을 받을 수 있었다. 그러나 보행망이 있다는 것과 턱·폭·표면·문턱·출입구까지 확인된 연속 무장애 경로가 있다는 것은 다르다. 이번 가장 큰 진전은 OA-21207 GIS의 실제 계단 구역/품질 확인과 OA-21208의 현재 샘플·통행주체 코드 확인이다.

### Cited Findings

| 자료 | 제공·접근·갱신·권리 | 필드/형상과 사용 가능성 | 실제 확인과 남은 한계 |
|---|---|---|---|
| [서울 자치구 도보 네트워크 OA-21208](https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do), [API 상세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21208&srvType=A&infSeq=2) | API명 `TbTraficWlkNet`; 전체 취득은 인증키, 공식 sample 5행은 키 없이 HTTP200. 페이지는 매일1회·2026-10-29 갱신·공공누리1유형(상업·변경 가능/출처표시) | NODE/LINK WKT, ID, 시작·종료 노드ID, 링크 길이, 링크 유형, 고가/지하철/교량/터널/육교/횡단보도/공원/건물내 플래그, 수집일자 | sample의 총행 `491,082`는 NODE+LINK 행 수이며 길 수가 아니다. sample WKT는 경위도 형태이고 5행은 종로구. `WORK_DTTM`에 2026-10-29가 실제로 들어왔으나 DB 처리/수집 시각이 현장 조사의 최근성을 뜻한다고 단정 불가. 전체 분포·네트워크 연결성은 미검증 |
| [서울 통행불편지역 OA-21207](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do), [API 상세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21207&srvType=A&infSeq=2) | `passWeak`; API sample 5행 키 없이 HTTP200, 총14,793행. API 공개 설명은 수시(월간), 현재 갱신2026-10-03. 공공누리1유형. 최신 GIS 첨부 표기2026-09-08, 2.59MB | API 6컬럼은 일련번호/지역이름/구분코드/조사일/비고/구코드이며 geometry 없음. 구분 1차량통행불가, 2계단도로, 3막다른도로, 4축대. 별도 ZIP에 실제 PolygonZ·EPSG5179(m) 공간정보 | 실제 ZIP 2,647,217B·DBF14,793행 수령. 계단 코드2는 **1,826구역**으로 계단 1,826개/모든 서울 계단이라는 뜻 아님. 날짜/코드/범위 품질 이슈 아래 기록 |
| [국토지리정보원 공개 DEM 15059920](https://www.data.go.kr/data/15059920/fileData.do) | IMG 파일, 무료·이용허락 제한 없음, 포털 메타 수시(자동 갱신). 기관자체 다운로드, 국토정보플랫폼 로그인·대용량 전송SW 안내 | 수치표고에서 긴 구간의 지형 상승/하강 후보를 계산할 기반 | 이번은 공식 메타 확인만. 서울 타일·좌표계·해상도·취득시기·정확도를 실제 내려받아 검증하지 않음. 지표 높이만으로 계단/턱/육교·지하통로의 보행 경사를 확정할 수 없음 |
| [서울 대로변 횡단보도 OA-21209](https://data.seoul.go.kr/dataList/OA-21209/S/1/datasetView.do) | 공공 API `tbTraficCrsng`, 공식 sample 사용 가능. 권리·전량 범위는 원문 확인 | 링크 WKT·연결 노드ID·`LNKG_LEN`으로 횡단거리 대조 후보 | **이전 부모 직접 확인**: sample200·총31,080 NODE/LINK행, 길이 컬럼 존재. 이번 재취득 안 함. 숫자는 모든 횡단보도 개수가 아니며 공식 단위·중앙섬 분할·방향·실제 진입점 매칭 남음. [기존 증거 Q4](../../reports/answers/CODEX_ANSWERS_2026-10-29.md) |
| [교통안전시설물 횡단보도 OA-15554](https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do) | 공개 공간파일/정의서 | A004_A에 `HOL` 가로길이, `VEL` 세로길이, XGEO 형상 | **이전 부모 직접 수령**한 작은 HWPX 정의서 근거. 이번 ZIP 전량/단위/축 의미 검증 안 함. 계단·턱 데이터의 대체 아님. [기존 Q4](../../reports/answers/CODEX_ANSWERS_2026-10-29.md) |
| [AI Hub 인도보행 영상, dataSetSn189](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&currMenu=1&dataSetSn=189&topMenu=) | 2019 구축, 2021-03 보완; 2026-05 기록은 태그 추가. 국내 신청 자격·AI Hub 이용정책/신청·다운로드 절차 별도 | 장애물 인식과 노면 마스킹, 계단·파손·점자블록·인도 재질 등 라벨 존재 | 이미지 학습 데이터이지 현재 서울 링크별 턱 높이/폭/위치 API가 아님. 실제 파일/메타 GPS/라이선스 세부는 미수령. 미래 카메라 기반 조사 연구 후보이며 첫 서비스 데이터 대체가 아님 |
| [서울동행맵 공식 출시 자료](https://news.seoul.go.kr/traffic/archives/512992?listPage=1) | 맞춤형 단차·경사·좁은 보도 회피 서비스 설명. [서울시의회 사업 문서](https://mas.smc.seoul.kr/attach/record/SEOUL/appendix/a11/A0063431.pdf?time=20260611141454)는 308역 반경300m DB 구축과 공공개방 추진 설명 | 이미 비슷한 문제를 해결하는 공공 서비스와 공간 DB가 있다는 근거 | 출시/계획 설명은 외부 개발자가 바로 받을 공개 API의 명세·권리·현재 전역 커버리지 증거가 아님. 실제 데이터셋/키/제휴 접근을 이번에 확보하지 못함 |

API sample 재현 주소(실제 인증키가 아님):

- `http://openapi.seoul.go.kr:8088/sample/json/passWeak/1/5/`
- `http://openapi.seoul.go.kr:8088/sample/json/TbTraficWlkNet/1/5/`

API가 HTTP8088로 안내되어 있어 향후 HTTPS 프런트에서 직접 호출하기보다 서버 취득/캐시 방식 등을 확인해야 한다. sample 5행 성공을 전체 권한·전량 적재·서울 어디서나 정확한 길로 확대하지 않는다. [불편 API](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21207&srvType=A&infSeq=2), [도보망 API](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21208&srvType=A&infSeq=2).

#### OA-21207 작은 GIS 직접 검사

- 페이지가 공개한 다운로드 폼으로 POST `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false`, `infId=OA-21207`, `infSeq=3`, `seq=3`, `seqNo=`를 메모리 수령했다. ZIP에는 `ln_theme_passweak.shp/.shx/.dbf/.prj/.cpg`가 있다. [원본 파일 목록](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do).
- DBF 필드: `SN`, `NM`, `CODE`, `EXAMIN_DT`, `RM`, `SGG_CD`, `SHAPE_LENG`, `SHAPE_LE_1/2/3`, `SHAPE_AREA`. CPG는 UTF-8. PRJ는 EPSG5179 Korea2000/UnifiedCS, 단위 metre. SHP 유형15(PolygonZ), 원시 bbox `(938111.2593,1937305.7686,969762.6454,1965429.3006)`. WGS84로 바꾸지 않고 경위도로 사용하면 틀린다. [공개 GIS 원본](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do).
- CODE 분포: `1=4,444`, `2=1,826`, `3=8,429`, `4=87`, 빈값6, **명세에 없는41이1행**. 공간 영역 개수이지 개별 시설 수가 아니다. [API 구분 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21207&srvType=A&infSeq=2), [원본 GIS](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do).
- SGG_CD는24개이며 강남구11680이 없었다. 조사일 필드의 8자리 숫자만 고르면13,938행, 원시 최소20160822/최대21091104였다. 이는 유효 조사일13,938개가 아니라 **형식만8자리인 값**이며 미래 날짜가 포함돼 정제가 필요하다. 5행 API sample의 조사일은20191115였다. 페이지 갱신2026과 실제 조사의 신선도를 구분한다. [원본 GIS/메타](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do).

#### OA-21208 유형 코드의 의미 직접 확인

공개 첨부 `도보네트워크_링크노드유형코드.xlsx` 12,510바이트도 메모리에서 읽었다(다운로드 폼 `infId=OA-21208,infSeq=3,seq=1`). [코드표 파일 목록](https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do).

- 링크 코드는 계단/경사의 종류가 아니라 통행 주체 4비트 조합이다. 예: `1000=보행자`, `1001=보행자+PM`, `1100=보행자+차량`, `1111=보행자+차량+자전거+PM`, `0000=통행불가`. 노드0일반/1지하철출입구/2버스정류장/3지하보도출입구. [공식 첨부 코드표](https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do).
- 이 필드로 차량/PM 통행이 가능한 링크 후보를 분류할 수는 있으나 실제 보행자 간섭량·차량 속도·현재 위험·보차 분리 여부가 직접 들어 있지는 않다. 코드만으로 위험지수나 PM 실시간 통행량을 만들면 안 된다. [공식 API 컬럼](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21208&srvType=A&infSeq=2).

### Inferences

- OA-21207의 계단 구역을 기존 보행 링크와 공간 교차시켜 ‘계단 후보’를 확인하는 소규모 실험은 가능하다. 아직 교차검증된 모든 계단 DB나 휠체어 라우팅은 아니다.
- OA-21208의 새 응답과 날짜 필드가 있으므로 이전 보고서의 ‘2020 기준’만으로 현재 API 전체가 정지됐다고 단정하면 안 된다. 동시에 2026 WORK_DTTM도 실제 현장/보도 품질 최신성의 증거는 아니다.
- 국토지리정보원 DEM의 경사는 첫 경사 후보에 유용할 수 있으나 도로/보도 구간을 실제 대응하고 구조물을 분리해 검증해야 한다.

### Gaps

- 전체 보행 링크에 단차(cm)·유효폭(m)·횡경사·노면 파손·경계석 램프·실제 출입구를 지속 갱신하는 서울 공개 API를 이번 조사에서 확보하지 못했다. 존재하지 않는다는 전수 확인은 아니다.
- passWeak GIS의 일부 날짜/코드 누락·미래값 이유, 강남구 누락 사유는 모른다. 임의 보정하면 안 된다.
- NGII 공개 DEM의 실제 서울 해상도/타일 취득·교량과 지표 구분은 미검증이다.

## 배리어 프리 확장에 무엇을 추가하거나 분리해야 하나

### Takeaway

‘계단·오르막을 덜 겪는다’와 ‘실제로 끝까지 지나갈 수 있다’를 분리해야 한다. **턱·좁은 폭·노면·출입구/연속 연결**을 확장표에 추가하는 것이 중요하며, 정보 부족을 0장애물로 해석하지 않는 것이 기능 추가보다 먼저다.

### Cited Findings

- 서울연구원은 유효 보도폭·단차·노면·경사 등 보행약자에게 중요한 항목의 지속 진단 필요성과 서울 전역 현황조사의 미완성을 지적한다. 2025 연구가 2026년 현재 모든 조사 상태를 전수 입증하는 것은 아니다. [서울연구원 연구 소개](https://www.si.re.kr/bbs/view.do?key=2024100154&pstSn=2510100008), [공식 PDF](https://si.re.kr/atch/filePreview.do?cnncSn=2510100008&cnncTy=bbs&ordr=2).
- 서울시 기존 서비스도 단차·경사·폭과 접근 시설을 함께 다룬다. 따라서 계단 회피만으로 배리어프리 독창성·안전성을 주장할 수 없다. [서울동행맵 공식 설명](https://news.seoul.go.kr/traffic/archives/512992?listPage=1).
- 국토부 계열 공개 설계지침은 유효폭·종단경사·턱낮추기·휴식참 등을 서로 다른 요구로 다룬다. 이는 시설 설계 기준이며 특정 개인의 통행 성공 기준이나 공공 데이터 커버리지 보증이 아니다. [사람중심도로 설계지침 공식 공개본](https://www.codil.or.kr/filebank/files/202404/helpdesk/BBS_202404260338392000.pdf?atchFileId=FILE_000000000010212&fileSn=0).
- AI Hub 노면/장애물 영상은 조사 인식 기술의 연구 기반이지만 현재 길의 상태를 보장하는 지도 API는 아니다. [AI Hub 인도보행 영상](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&currMenu=1&dataSetSn=189&topMenu=).

### Inferences

- 추가 추천 항목: **‘턱·좁은 길·울퉁불퉁한 바닥을 덜 겪는 길’**, 그리고 **‘출입구까지 이어지는 길’**. 다만 첫 버전에 서울 전역 자동 회피로 약속하지 않고 검증된 경로/시설 연결부터 시작한다.
- 경사는 오르막/내리막/횡경사를 구분한다. 유모차·수동휠체어·보행보조기·관절 불편 이용자에게 같은 경사가 같은 부담이라는 가정은 두지 않는다.
- 통행 불가 제약과 편의 선호는 분리한다. 휠체어 이용자의 계단은 시간/점수로 상쇄할 불편이 아니라 해당 경로를 배제해야 하는 제약이 될 수 있다. 미확인 구간을 통행가능으로 분류하는 것도 피한다.
- 지도 링크 코드가 제공하는 차량/PM 통행 주체 정보는 ‘보차혼용을 덜 지나는 길’의 보조 연구 후보로 추가할 수 있다. 새 대표 컨셉을 이것으로 바꾸라는 추천은 아니다.

### Gaps

- 실제 출입구/승강기/경계석 램프가 보행망과 연결됐는지 확인한 소규모 경로조사가 없다. 벤치·승강기 점 위치만 연결했다고 접근 가능한 경로가 완성되지는 않는다.
- 어느 이용 조건을 hard constraint로 할지, 허용 경사/턱/폭의 개인 임계값은 이번 조사에서 확정하지 않았다. 법적 최소 기준을 개인의 능력으로 변환하지 않는다.

## 1차 서비스에서 유지 추가 보류할 것은 무엇인가

### Takeaway

신호 여유와 계단/경사 비교는 유지하되 정확한 범위를 검증한다. 새로 추가할 필수 기획 항목은 **미확인·연결 단절을 표시하는 접근성 상태**다. 단차/폭/노면의 서울 전역 정밀 자동회피와 영상 AI 실시간 판단은 보류하는 것이 타당하다.

### Cited Findings

- 계단 후보 공간자료와 실제 보행망/유형 코드는 공개되어 있다. [OA21207](https://data.seoul.go.kr/dataList/OA-21207/A/1/datasetView.do), [OA21208](https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do).
- 보행망 공개 컬럼에 보도 유효폭·턱 높이·표면 상태가 없고, AI Hub는 과거 영상 학습셋이다. [보행망 API](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21208&srvType=A&infSeq=2), [AI Hub189](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&currMenu=1&dataSetSn=189&topMenu=).
- 기존 확보 신호/횡단 길이 자료도 현장 방향·점멸·길이 매칭 전에는 완결된 횡단 안내가 아니다. 이 부분은 부모의 이전 직접 확인이며 이번 연구가 새 검증을 수행한 것은 아니다. [기존 Q1~Q4](../../reports/answers/CODEX_ANSWERS_2026-10-29.md).

### Inferences

| 판정 | 항목 | 첫 제품에서의 형태 |
|---|---|---|
| 유지 | 신호 횡단 여유 | 방향·점등/점멸·거리·개인속도 검증된 구간만, 미확인 별도 |
| 유지 | 계단·오르막/내리막 | 계단 후보 GIS+보행망+지형을 맞춘 소규모 비교; 데이터 없음을 0계단으로 쓰지 않음 |
| 추가 | 턱·폭·노면·출입구 연속성 | 확장표와 데이터 스키마에 지금 넣되 검증 수준별 제공, 사용자에게 통행 가능/불가/미확인 구분 |
| 보조 후보 | 차량·PM 통행 링크 | 링크 유형으로 후보 분류 후 현장 검증; 실시간 차량량/위험 점수 아님 |
| 보류 | 서울 전역 휠체어 경로 보장 | 필수 물리 제약과 운영정보가 부족한 상태에서는 보장 불가 |
| 보류 | 영상 AI로 현재 턱/장애물 자동 판정 | 학습셋 존재와 서비스용 현장 취득/위치 매핑/모델 성능은 별도 사업 |

### Gaps

- 이 우선순위는 데이터 준비 정도와 제품 방향에 근거한 연구자 제안이며 사용자 최종 승인·효용/수요 실험 완료가 아니다. 시설·쉼·혼잡 및 집단 보행속도 연구와 합쳐 최종 순서를 조정해야 한다.
