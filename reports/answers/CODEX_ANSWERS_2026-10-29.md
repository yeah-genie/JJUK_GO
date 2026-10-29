# Codex 답변 — 신호·횡단 길이·운영 상태와 서비스성

2026-10-29, Asia/Seoul. 작성: Codex. **앱 코드·Claude 브랜치·배포·수집 설정은 수정하지 않았다.** 요청대로 이 답변 파일 하나만 Codex 브랜치에 추가한다.

- 질문 원본: Claude 브랜치 `b1cba69188e4fe243b629756374564944d83aba6`의 `docs/archive/CODEX_QUESTIONS_2026-10-29.md`. `docs/PRODUCT_DEFINITION.md`의 최신 ‘횡단 여유 중심’ 갱신도 읽었다.
- 확인 대상 Codex 코드: `f9ee3694f66017e7b352e7edce14a156385016d5`. 원격에 이미 있던 변경을 fast-forward로 동기화했으며 이 답변 작업에서 앱을 수정한 것은 아니다.
- 표기: **[직접 확인]** 실제 파일·실행·응답 / **[문서 근거]** 출처가 말하는 범위 / **[추정]** 해석·제안 / **[모름]** 미확정.
- 핵심: 횡단 길이 공개 자료는 실제로 받을 수 있었다. 방향 대응과 국내 점멸 코드 의미는 아직 확정하지 못했다. 14일 날짜 간 검증은 질문서의 합격 기준에 미달했다. ‘안전하게 건넌다’는 안내의 근거가 확보된 상태가 아니다.

## Q1. 방향 코드와 보행 상태값

**[직접 확인] 현장 횡단보도와 방향 코드를 맞춰 본 적이 없다.** 기존 `LEGS = {'nt':'n','et':'e','st':'s','wt':'w'}`는 현장 검증된 대응이 아니다. `export_history_plans.py`에도 방향 대응 가정이며 MAP/현장 검증이 필요하다는 주석이 있다. 이 가정을 제품 숫자의 확정 근거로 사용한 것은 부족했다.

**[문서 근거]** [현재 통합 API 10381](https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10381)의 공개 출력 표를 실제로 읽었다. `ntPdsgStatNm`은 ‘북쪽_보행신호_상태_명’, 설명은 ‘해당 방향 신호 상태 명’이다. `ntPdsgRmdrCs`는 이름에 ‘센티초’가 있지만 값 설명은 **‘해당 방향 신호 잔여 시간(1/10초)’**라고 명시한다. 기존 인접 관측의 약 10/초 감소 확인과 부합한다. 변수 이름만 보고 1/100초로 바꾸면 안 된다.

**[모름]** ‘북쪽’이 횡단보도의 교차로 내 위치인지, 보행 진행방향인지, 신호등/접근로의 지리적 방위인지 이 설명만으로 확정할 수 없다. 10382 파일 전체의 별도 코드 정의서는 확보하지 못했다. 10381 표를 10382의 완전한 의미 정의서로 대체하지 않는다.

**[직접 확인]** [MAP API 10121](https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10121)의 공개 출력 항목은 `itstId`, `itstNm`, `mapCtptIntLat`, `mapCtptIntLot`, `laneWidth`, `limitSpedTypeNm`, `limitSped`, `itstEngNm`, `rgtrId`, `regDt`다. 이 표에는 개별 횡단보도·signalGroup·방향 대응이 없다. 따라서 **이 API의 존재만으로 방향 문제가 해결된다고 말할 수 없다.** 키를 사용한 실제 MAP 응답은 이번에 조회하지 않았다.

**[직접 확인]** 14일 가공 CSV.GZ에서 확인한 보존 상태값과 구간 수:

| 상태 문자열 | 보존 구간 수 | 의미의 확인 범위 |
|---|---:|---|
| `stop-And-Remain` | 14,113,488 | 국제 SPaT 명칭상 정지·유지 |
| `protected-Movement-Allowed` | 7,331,440 | 국제 명칭상 보호된 진행 허용; 국내 보행 점등과의 정확한 대응 미확정 |
| `permissive-Movement-Allowed` | 7,751,357 | 국제 명칭상 비보호 진행 허용; 국내 녹색 점멸인지 미확정 |

중요: `scripts/import_official_history.py:compact()`가 애초에 **이 세 상태만 남긴다.** 위 목록은 원본 API/원본 CSV의 전체 상태 열거형이 아니다. 그 밖 상태·결측이 전혀 없었다는 뜻도 아니다. NULL·미지원·점멸 신호를 임의로 빨강이나 진입 가능한 초록으로 만들지 않아야 한다. NE/NW/SE/SW를 두 cardinal leg로 복제하는 현재 fallback 역시 검증된 실제 횡단 대응이 아니다.

**[추정] 다음 확인:** 교차로별 횡단보도 진입점·물리적 방향·고정녹색 시작·점멸 시작·적색 시작을 같은 시각의 각 PDSG 필드와 대조한다. 직각 전환 가설은 테스트 후보이며 일괄 회전으로 정답 처리할 근거는 없다.

## Q2. permissive와 점멸, 진입 규칙·기준 속도

**[모름] `permissive-Movement-Allowed = 국내 보행 녹색 점멸`은 확정하지 못했다.** 단어가 permissive라는 이유로 점멸이라고 단정하면 안 된다.

**[문서 근거]** ITE 등 표준 발행기관의 [CTI 4501 v01.01, Connected Intersections Implementation Guide](https://www.ite.org/ITEORG/assets/File/Standards/CTI%204501v0101.pdf), §3.3.3.3 및 부록의 보행 매핑 설명은 허용(protected/permissive)과 clearance를 구분한다. 미국 보행 Flashing DON'T WALK의 경우 충돌 조건에 따라 `permissive-clearance(7)` 또는 `protected-clearance(8)`를 설명한다(PDF p.182 부근). **국제 표준 예시는 국내 공급자의 변환 규칙을 증명하지 않는다.** 다만 permissive-allowed가 보편적으로 보행 점멸을 의미한다는 해석은 지지하지 않는다.

**[문서 근거] 녹색 점멸에 새로 횡단을 시작하면 안 된다.** [국가법령정보센터 도로교통법 시행규칙 별표 2](https://www.law.go.kr/flDownload.do?bylClsCd=110201&flSeq=161811475&gubun=), 보행신호등 항목에서 확인했다. 이미 횡단 중인 경우와 진입 전을 구분해야 한다. 해당 별표의 개정 표기는 2022-01-21이며, 이번 확인을 모든 후속 개정 대조까지 완료했다는 뜻으로 확대하지 않는다.

**[문서 근거] 교통약자 0.8m/s를 현재 기준으로 고정하면 안 된다.** 경찰청 [2020-12-01 공식 개정 공지](https://www.police.go.kr/user/bbs/BD_selectBbs.do?q_bbsCode=1001&q_bbscttSn=20201201084730717)는 2020-11-30자로 교통약자 기준을 **0.8 → 0.7m/s**로 조정했다고 명시한다. 공지 본문은 검색에 수록된 공식 원문에서 확인했으나 직접 접속은 redirect loop였고 첨부 6,589,425바이트 PDF는 받지 못했다. 일반 1.0m/s와 전체 신호 산식·구역별 예외·최신 통합 매뉴얼의 유효 판본까지 직접 확인한 것은 아니다. 설계 기준 속도는 개인의 실제 속도나 횡단 성공 보증값이 아니다.

**[직접 확인] `MIN_GREEN=8`은 개인 횡단거리/속도에서 산출한 값이 아니며 검증된 근거를 제시할 수 없다.** protected와 permissive를 합친 초록 길이로 패턴을 맞추므로 현 상태에서 ‘진입 가능한 시간’을 확정할 수도 없다.

**[추정] 횡단 여유 중심 UI의 계산 전제:**

- ‘전체 보행 녹색 구간 길이 − 횡단거리/개인속도’는 **구간 시작에 도착한다는 조건의 정적 시간 차이**다. 지금 또는 실제 도착 순간 남아 있을 시간과 다르다.
- 고정녹색의 진입 가능 구간과, 이미 진입한 보행자가 횡단을 마치는 점멸 구간을 분리해야 한다. 점멸 잔여가 길어도 새 진입 권고를 하면 안 된다.
- 단순히 총 초록 길이를 고정녹색 길이로 전부 바꾸는 것도 충분하지 않다. 진입 가능 여부와 횡단 완료 시간의 예산은 서로 다른 계산이다.
- 방향·신호 구간 의미·횡단 거리 중 핵심이 미확인이면 큰 `+몇 초` 숫자에 추정 기호만 붙여 해결하지 말고 ‘계산할 자료 부족’으로 둔다.
- ‘도착 오차 20초 이하’라는 조건만으로 동적 여유가 신뢰할 만해지지 않는다. 예상 여유 자체가 5초라면 20초 오차는 너무 크다. 허용 오차는 그 진입 창/여유 대비 평가해야 한다.

## Q3. 14일 leave-one-day-out와 날짜 간 안정성

**[직접 확인] 14일 로컬 CSV.GZ 전부를 재검사하고 날짜 간 시험을 실행했다.** 14개 SHA256은 `official-history/YYYYMMDD.json`의 `segment_sha256`과 모두 일치했다. 원본 ZIP을 다시 다운로드하지 않았다. 재현용 실행 코드는 이 문서 부록 A에 포함한다.

### 방법과 해석 범위

1. 질문서와 같은 **08/09/10시 KST**만 평가했다. 24시간 전체 합격 판정이 아니다.
2. `datastore/history/plans-v2/YYYYMMDD.json`의 기존 날짜별 학습/동일날짜 holdout 통과 패턴을 고정했다. 대상 날짜 패턴은 source 후보에서 제외했다. 나머지 13일을 통째로 합쳐 새 회귀 모델을 학습한 실험은 아니다.
3. 교차로ID × 원래 방향코드 × 시간대를 평가 셀로 사용했다. 앱 leg로 복제하지 않았다. 날짜마다 관측된 구간 `[start,end)`에서 1초 간격으로 비교하며 관측 공백을 채우지 않았다. 최소 120표본 및 두 상태가 모두 있는 셀만 평가했다. 0.5초 이내 중복 시각은 제거했다.
4. 기존 코드와 비교하려고 protected/permissive를 둘 다 green으로 묶었다. **물리적 점멸/진입 가능성/길 안내 성공률 시험이 아니다.** Q1/Q2 미해결은 그대로다.
5. 각 대상 셀에서 다른 날짜의 같은 유형(평일/주말) 중 **가장 최근 source 날짜** 하나를 선택했다. 대상 정답을 보고 가장 잘 맞는 source를 고르지 않았다. 교차 유형도 같은 방식이다. 이는 frozen single-day model의 leave-one-day-out 선택이다.
6. 이 LODO 선택에는 대상보다 나중인 source 날짜가 들어갈 수 있어 **실제 미래 예측 성능으로 부르지 않는다.** 별도로 source가 대상보다 과거인 경우만 허용한 시험도 실행했다.
7. 비율은 표본 길이를 가중하지 않은 셀별 평균이다. ‘95% 이상 셀 비율’의 분모는 **자료가 있고 source 모델도 있는 평가 가능 셀**이다. 전체 서울 횡단보도 커버리지가 아니다. 단일 날짜의 같은 신호가 반복 등장하므로 셀을 독립 이용자 표본으로 취급하거나 신뢰구간을 과장하지 않는다.

### LODO: 다른 날짜 중 가장 최근 패턴 선택

| source → target | 평가 셀 | 평균 상태 일치율 | 일치율 ≥95% 셀 비율 | 항상 빨강 기준선 | 초록 recall |
|---|---:|---:|---:|---:|---:|
| 평일 → 평일 | 57,097 | 95.36% | **82.60%** | 74.97% | 90.45% |
| 주말 → 주말 | 12,211 | 95.44% | 86.75% | 73.87% | 91.04% |
| 주말 → 평일 | 51,805 | 78.96% | 37.55% | 74.85% | 58.38% |
| 평일 → 주말 | 22,320 | 79.57% | 42.00% | 74.28% | 58.92% |

**질문서의 합격 기준 ‘평일→평일 일치율 ≥95% 셀이 ≥90%’에는 미달한다.** 평균 95% 이상이라는 사실과 셀 90%가 통과한다는 것은 다르다.

### 과거 날짜만 허용한 별도 시험

| source → target | 평가 셀 | 평균 일치율 | ≥95% 셀 비율 |
|---|---:|---:|---:|
| 과거 평일 → 평일 | 38,012 | 95.47% | **83.77%** |
| 과거 주말 → 주말 | 10,070 | 95.09% | 85.75% |

이 시험도 평일 합격 기준 미달이다. 대상 날짜별 관측 가용성 차이가 커 위 표끼리 동일 표본 비교로 읽으면 안 된다.

### 모든 source-target 조합의 보조 확인

| 유형 | source-target 셀 쌍 | 평균 일치율 | ≥95% 비율 |
|---|---:|---:|---:|
| 평일→평일 | 96,921 | 95.75% | 84.68% |
| 주말→주말 | 13,180 | 95.19% | 85.99% |
| 평일→주말 | 41,473 | 79.77% | 43.18% |
| 주말→평일 | 61,313 | 79.11% | 38.80% |

### 날짜 간 거리별 — 같은 유형의 모든 조합

| 날짜 차이 | 셀 쌍 | 평균 일치율 | ≥95% 비율 |
|---|---:|---:|---:|
| 1일 | 11,189 | 96.06% | 87.78% |
| 2일 | 11,653 | 95.69% | 83.33% |
| 3일 | 8,834 | 96.12% | 87.63% |
| 4일 | 17,906 | 95.05% | 82.58% |
| 5일 | 10,392 | 96.29% | 85.84% |
| 6일 | 9,549 | 96.01% | 83.81% |
| 7일 | 21,707 | 96.35% | 88.14% |
| 8일 | 8,486 | 93.12% | 77.52% |
| 9일 | 334 | 97.02% | 88.92% |
| 10일 | 688 | 98.00% | 92.15% |
| 11일 | 7,671 | 95.08% | 81.05% |
| 12일 | 1,692 | 97.57% | 92.20% |

각 그룹의 교차로/시간대 구성은 다르다. 날짜가 멀수록 좋아지거나 7일 주기가 검증됐다고 결론낼 수 없다. 방향·요일 외에도 운영 계획 변경, 관측 편향, 추정 주기 drift 등이 남는다.

### 대상 날짜별 LODO(같은 유형)의 변동

| 대상 날짜 | 평가 셀 | 평균 일치율 | ≥95% 비율 |
|---|---:|---:|---:|
| 10/14 수 | 3,249 | 96.38% | 84.03% |
| 10/15 목 | 7,877 | 94.86% | 77.49% |
| 10/16 금 | 1,213 | 98.07% | 92.09% |
| 10/17 토 | 2,081 | 97.90% | 93.61% |
| 10/18 일 | 175 | 91.28% | 69.71% |
| 10/19 월 | 7,555 | 93.54% | 78.01% |
| 10/20 화 | 3,502 | 97.42% | 92.58% |
| 10/21 수 | 8,487 | 95.36% | 79.46% |
| 10/22 목 | 7,094 | 95.91% | 87.43% |
| 10/23 금 | 8,706 | 95.02% | 81.89% |
| 10/24 토 | 6,758 | 98.63% | 96.20% |
| 10/25 일 | 3,197 | 87.33% | 63.25% |
| 10/26 월 | 8,169 | 95.25% | 83.12% |
| 10/27 화 | 1,245 | 98.45% | 97.03% |

**[직접 확인] 관측 구멍:** 10/27 가공 파일의 09시와 겹치는 보존 구간은 0이다. 08시는 20,853, 10시는 10,735구간이다. 기존 파일 SHA256은 일치하므로 이번 재검사 중의 파일 손상은 아니다.

**[모름]** 09시 공백이 원본 자체에서 생겼는지, 원본의 해당 시간에 유효 PDSG가 없었는지, 변환 단계에서 탈락했는지는 확정하지 못했다. 전체 원본 ZIP의 모든 행·필드와 대조하지 않았기 때문이다. ‘서울 신호가 그 시간에 없었다’나 ‘원본 문제로 확정’이라고 쓰면 안 된다. API 5분 수집 공백을 곧바로 이 공식 일별 파일의 원인으로 가져올 수도 없다.

**[문서 근거] 공휴일:** [우주항공청 2026년 월력요항](https://www.kasa.go.kr/prog/bbsArticle/BBSMSTR_000000000010/view.do?bbsId=B000000000010&nttId=B000000001860Pe2zT3)을 기준으로 이 10/14~27 범위에는 토·일 외 일반 공휴일이 없다. 일요일은 10/18·25, 토요일은 10/17·24다. 교통 제어기의 실제 휴일 달력·행사 계획까지 확인한 것은 아니다.

**[직접 확인] 여러 날짜를 섞은 이유와 영향:** `publish()`가 각 교차로/원래 방향/시간대마다 통과한 가장 최신 날짜를 선택한다. 가장 최신 ‘하루’의 관측이 불완전해 지원 범위를 유지하려고 한 방식이다. 관측 공백을 다른 날짜의 실제 관측 패턴으로 보완했지만, 요일별 일반화 검증을 하지 않은 채 평일·주말이 섞였다. 같은 화면 내 신호별 기준 날짜도 달라진다. 이 한계를 이전 보고서에 적었어도 제품 계산상의 문제는 남는다. 단순 ‘14일 평균 패턴’도 아니다. 평일/주말 분리와 별도 날짜 검증, 충분하지 않으면 모름 처리가 필요하다. 5줄 수정만으로 모든 날짜 안정성이 검증되지는 않는다.

## Q4. 횡단보도 길이 공공자료

### ① 인증키

**[직접 확인] 이번 로컬 프로세스에서 사용할 수 있는 서울 열린데이터광장 인증키는 찾지 못했다.** 관련 환경변수와 저장소/상위의 `.env*` 파일을 확인했다. 모든 사용자 PC 저장소를 전수 조사한 것은 아니다.

**[직접 확인] GitHub repository Secrets는 이름만 조회했으며 `DATA_GO_KR_KEY`, `SEOUL_TDATA_API_KEY` 두 개다.** 값은 읽거나 기록하지 않았다. 공공데이터포털·T-Data용 이름이므로 이를 열린데이터광장 인증키라고 추정하거나 같은 키로 호출하지 않았다. 존재만으로 서비스 권한·유효성도 보장하지 않는다.

### ② OA-21209: 키 없이 공식 sample API 수령 성공

**[직접 확인] 인증키가 없어도 5행 공식 sample은 받을 수 있었다.** [OA-21209](https://data.seoul.go.kr/dataList/OA-21209/S/1/datasetView.do?tab=A)의 [API 상세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-21209&srvType=A&infSeq=2)에서 서비스명 `tbTraficCrsng`를 확인했다. 명시된 `http://openapi.seoul.go.kr:8088/sample/json/tbTraficCrsng/1/5/`를 조회했고 HTTP 200, `INFO-000`이었다. 이 샘플 요청에는 실제 인증키를 사용하지 않았다. 해당 8088 포트는 HTTP 샘플이며 HTTPS로 같은 포트에 요청하면 TLS 실패였다. 앱에서 직접 HTTP 호출하지 말고 향후 서버 처리 경로를 별도로 확인해야 한다.

- `list_total_count`: **31,080행**. **횡단보도 31,080곳이 아니다.** NODE/LINK가 섞인 테이블이다.
- 컬럼: `NODE_TYPE`, `NODE_WKT`, `NODE_ID`, `NODE_TYPE_CD`, `LNKG_WKT`, `LNKG_ID`, `LNKG_TYPE_CD`, `BGNG_LNKG_ID`, `END_LNKG_ID`, `LNKG_LEN`, `SGG_CD`, `SGG_NM`, `EMD_CD`, `EMD_NM`.
- `LNKG_LEN`: 공개 설명은 ‘링크 길이’. 샘플 LINK 4개의 값은 25.38, 22.748, 69.508, 16.985다. 나머지 한 NODE의 0은 실제 횡단 길이 0이 아니다.
- WKT는 경위도 형태. 수령한 5행의 좌표 범위는 대략 경도 126.96074~127.00925, 위도 37.56954~37.60583이며 모두 종로구다. **전체 서울 범위나 전체 횡단보도 커버리지로 확대하지 않는다.**

**[추정] 단위는 미터로 강하게 추정되지만 이번 공개 컬럼 설명에는 단위 표기가 없었다.** LINK 네 개의 좌표 끝점 거리(근사 미터)가 각각 25.353, 22.786, 69.422, 16.964m로 값과 가깝다. 이 비교는 단위의 정황 근거이며 원본 단위 정의나 실측 검증을 대신하지 않는다. 자료 설명은 대로변 자료이므로 골목·단지·사유지까지 포함한다고 하지 않는다. 전체 행 취득, 구별 범위, LINK 유형 의미, 중앙보행섬 분할 여부, OSM 경로/신호 방향 매칭은 미완료다.

### ③ OA-15554 정의서

**[직접 확인] [OA-15554](https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do)의 ‘교통안전시설물 테이블 정의서(횡단보도).hwpx’를 실제 다운로드해 XML을 읽었다(65,920바이트).** 파일 게시 폼의 공개 다운로드는 `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false`, POST 인자는 `infId=OA-15554`, `infSeq=3`, `seq=12`, `seqNo=`였다.

| 테이블 | 컬럼 | 타입 | 정의서 설명 |
|---|---|---|---|
| `A004_A` | `HOL` | `NUMBER(3,1)` | 가로길이 |
| `A004_A` | `VEL` | `NUMBER(3,1)` | 세로길이 |
| `A004_A` | `XGEO` | `SDO_GEOMETRY` | 공간데이터 |

**길이 컬럼은 있다.** 그러나 어느 축이 보행 횡단거리인지, 단위, 실제 값의 결측률·0·최신성은 정의서만으로 확정할 수 없다. 20MB 공간 ZIP 전체를 이번에 받지는 않았다. `HOL`이나 `VEL`을 바로 앱 횡단 길이에 덮어쓰지 않는다.

## Q5. 출입구 연결 35m

**[직접 확인] 35m는 측정으로 최적화하거나 법적 기준에서 가져온 값이 아닌, 내가 넣은 보수적 휴리스틱이다.** `cf25efecd0d75682759cb5dda40efc9770d14515`에서 종전 300m 제한 및 도로 우선 스냅을 바꾸며 도입했다. 보행 링크의 가까운 지점에 투영하고 먼 점을 임의 직선 연결하지 않으려는 목적이었다. 하지만 **35m 자체의 실증 근거는 없다.** 기존 값보다 작다고 실제 출입 가능성까지 보장하지 않는다.

**[문서 근거] 실패 사례:** `reports/PACE_RECORD_IMPLEMENTATION_2026-10-29.md`와 개발 보고서가 서울광장 가짜 GPS `(126.97799,37.56562)`에서 35m 조건으로 걷기 버튼이 숨고 `check_walk_browser.cjs`가 시간 초과한 사례를 기록한다. 실제 사용자의 야외 GPS 로그가 아니라 브라우저 시험 재현이다. 이번에 이 브라우저 시험을 다시 실행한 것은 아니다.

**[추정] 제안한 35m 자동 / 100m까지 거리 표시·확인 / 그 밖 거절 방식에는 원칙적으로 이견 없다.** 단 100m 역시 검증된 정답 수치는 아니다. 확인 버튼을 눌러도 담장·차도·철도 횡단·고저차를 통과 가능한 길로 만들 수 없다. ‘경로가 시작되는 점’과 ‘선택 지점까지 연결 미확인’을 구분하고 실제 출입구/보행 링크를 고를 수 있어야 한다. 35m 이내도 접근성 보증으로 쓰지 않는다.

## Q6. 배포·브랜치·로컬 작업·이관

**[직접 확인] 2026-10-29 17:33 KST 재조회:** Vercel 도구로 대표 도메인 `jjukgo.vercel.app`를 조회했다.

- 배포 ID: `dpl_5tdp61jaETpA6JdevPcZu5SuPbLT`, 상태 `READY`, target `production`.
- `githubCommitRef`: **`ccr-94bac9df-i81579`**.
- `githubCommitSha`: **`b1cba69188e4fe243b629756374564944d83aba6`**.
- 저장소의 현재 default branch도 GitHub 도구로 **`ccr-94bac9df-i81579`** 확인.

**[직접 확인] 이미 Claude 브랜치 배포로 전환돼 있다. 이번에 설정을 바꾸거나 배포하지 않았다.** 문서 커밋도 해당 브랜치의 앱 코드 전체를 다시 배포할 수 있으므로 문서-only 배포와 기능 변경을 구분해야 한다. Vercel의 production branch 세부 설정값을 반환된 프로젝트 응답에서 직접 읽은 것은 아니다. 향후 연결 설정을 바꿀 경우 Git 연결 저장소/production branch와 실제 대표 도메인의 배포를 함께 확인한다. GitHub default branch 변경만으로 모든 Vercel 프로젝트 설정이 바뀐다고 가정하지 않는다.

**[직접 확인] 로컬-only 상태:** 이번 시작 전 working tree는 깨끗했고, 원격 Codex 브랜치와 동기화한 뒤 미푸시 커밋도 없었다. 알고 있는 앱·기획 변경을 로컬에만 숨겨 둔 상태는 아니다. 다만 Git 밖 자료가 있다.

- `official-history/*.csv.gz`: 약 369MB의 14일 가공 자료. 이미 공개 Release 자산으로 보관했다.
- `datastore/history/plans-v2/*.json`: 날짜별 피팅 캐시. Git에서 제외되어 있으며 `export_history_plans.py --day`로 재생성 가능하다. 캐시 자체는 Release 자산이 아니다.
- 상위 작업 폴더의 지도 복원 보조 스크립트/지도 인덱스 점검 파일, 로컬 환경/런타임: 앱에 반드시 필요한 미푸시 소스라고 확인된 것은 아니다. 삭제하지 않았다.
- 이번 교차 시험의 보조 코드·결과는 상위 폴더 `q3_codex_audit.py`, `q3_codex_audit/summary.json`, `pair_results.csv.gz`에 남겼다. 이번 ‘한 파일’ 요청에 맞춰 **코드와 필요한 결과를 이 문서 부록으로 함께 전달**한다. 별도 앱 파일이나 대용량 아카이브를 커밋하지 않는다.
- 직전 ‘배리어 프리 + 걷기 앱 + 지도앱’ 문서 반영 시도는 자동 승인 검토의 사용량 제한으로 실행되지 않았다. 당시 push 완료라고 주장하지 않았다. 그 정의는 이제 Claude의 최신 PRODUCT_DEFINITION에 들어 있어 이 답변에서 인정하며, 이전의 걷기 기록 우선 제안으로 되돌리지 않는다.

**[추정] 파일 이관의 함정:**

1. 출발 UI만 가져오거나 `app.js`만 가져오면 맞는 DOM이 없어 깨질 수 있다. `src/template.html`과의 계약, `scripts/build_prototype.py`가 만드는 `docs/prototype/index.html`을 같이 검토한다. 현재 `vercel.json`은 `outputDirectory=docs/prototype`, 빈 buildCommand이므로 **소스만 고쳐서는 정적 index가 갱신되지 않는다.**
2. 엔진에 필요한 `seoul/graph`, `signals`, `sidewalks`, `signal-plans.json`/`signal-hours`, 지형 파일과 좌표/경로 스키마가 맞아야 한다. 신호 인덱스만 가져오고 시간대 파일을 빠뜨리지 않는다. 전체 CSV.GZ·ZIP을 앱 정적 경로에 복사하지 않는다.
3. 신호 방향·요일·점멸·8초 가정·차선 환산 길이는 그대로 가져오면 그대로 남는다. 텍스트 충돌 0은 의미·데이터 결함 0이 아니다.
4. 개인 속도 변경은 검색 비용·시뮬레이터·도착 예상·걷기 중 남은 시간 전체에 일관되게 반영돼야 한다. ‘그냥 걷기/기록’을 삭제하는 최신 결정을 따르되, 결합돼 있는 GPS·속도 추정 함수까지 무심코 삭제하지 않는다.
5. 가짜 시계/이동 시연과 실제 GPS를 분리하고, `localStorage` 구버전 값·권한 거부·낮은 위치 품질·배경 전환·스냅 실패를 확인한다. 실제 휴대전화 야외 검증은 완료된 것으로 넘기지 않는다.
6. `.env`, 자격증명, 계정 메타데이터가 담긴 로컬 화면 캡처, `.vercel` 인증 자료, `.venv` 등을 이관 소스로 넣지 않는다. `AGENTS.md`와 최신 Claude 기획 문서를 Codex의 과거 문서로 덮지 않는다.

**[추정] PR #3:** 새 방향에서 더 이상 병합할 PR이 아니라면 닫는 데 이견 없다. 답변만 요청받았으므로 이번에는 PR을 닫거나 댓글을 보내지 않았다. 필요한 코드만 선별 이관한다는 최신 방침을 따른다.

## Q7. 수집·이력 갱신·Release 접근

**[직접 확인] GitHub 공개 workflow 목록 조회:** `collect`는 `disabled_manually`. `ci`, `natl-check`, `daily-report`, `static-data`는 active다. **`official-history`는 현재 등록된 workflow 목록에 없었다.** 이번 조회에서 수집기를 재시작하거나 workflow를 활성화하지 않았다.

**[직접 확인] Codex 브랜치 `.github/workflows/history.yml`에는 KST 04:20(UTC 전일 19:20) 예약과 수동 실행이 준비돼 있다.** 기본 브랜치에 반영되지 않은 파일 존재만으로 자동 운영 중이라고 말할 수 없다. 기존 설계는 신규 날짜만 처리 → 부분 ZIP 검증 → 시간대 패턴 → Release 업로드 → 작은 메타데이터/앱 파일 커밋이다. 그러나 Q1~Q3 문제가 남아 있으므로 이 파이프라인을 현재 기획 숫자의 검증 완료 자동 갱신으로 취급하지 않는다.

**[문서 근거] 10/28:** 기존 import 보고서에 정상 완결 ZIP을 받지 못해 제외한 과정이 있다. 이번에 재다운로드하지 않았다. 실패 원인과 현재 파일 정상 여부는 모름이다. 이후 계획은 신규 날짜의 완결성/중복 방지/해시·관측 공백 확인부터 하고, 검증 실패 시 이전 자료를 보존하면서 갱신 실패를 표시하는 것이다. 승인된 매일 실행이 이미 시작됐다는 뜻은 아니다.

**[직접 확인] Release는 공개다.** [Release 페이지](https://github.com/yeah-genie/JJUK_GO/releases/tag/signal-history-sample-20261027), [익명 REST 메타데이터](https://api.github.com/repos/yeah-genie/JJUK_GO/releases/tags/signal-history-sample-20261027)를 인증 없이 조회했다. repository public, `draft=false`, `prerelease=true`, 가공 CSV.GZ 14개와 원본 샘플 ZIP 1개가 보인다. 14개 가공 크기 합은 369,170,496바이트다.

**[직접 확인] [10/27 가공 파일](https://github.com/yeah-genie/JJUK_GO/releases/download/signal-history-sample-20261027/20261027.csv.gz)의 익명 HEAD는 HTTP 200, Content-Length 7,173,390이며 최종 호스트는 `release-assets.githubusercontent.com`이었다.** 이 확인은 14개 전부를 다시 원격 다운로드했다는 뜻이 아니다. 로컬 14개 파일은 전부 metadata 해시와 일치했다.

**[모름] Claude의 403 원인은 그 환경 로그 없이는 확정할 수 없다.** 공개 자료라 원칙적으로 계정 인증을 요구하는 상태는 아니다. 실제 필요한 것은 github.com → release-assets.githubusercontent.com 리디렉션과 큰 파일 수신이 가능한 네트워크다. 차단 호스트·만료된 서명 URL·프록시 정책을 구분하고, 만료 가능한 최종 URL 대신 위 안정적인 browser_download_url에서 다시 시작한다. 무조건 키를 추가하라고 권하지 않는다. 공개 메타데이터만 열리고 자산 호스트가 차단되면 접근 허용 또는 허용된 전달 경로가 필요하다.

**[문서 근거] ‘서울 실시간 신호 API가 11/15 모두 종료’는 정정해야 한다.** [T-Data 공식 공지 104](https://t-data.seoul.go.kr/board/notice/detail.do?boardId=104)는 기존 3종 API의 2026-11-15 종료와 **대체 서비스 전환**을 안내한다. 실시간은 새 OpenAPI, 단기 이력은 파일데이터를 쓰라는 안내다. [새 통합 10381](https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10381), [이력 10382](https://t-data.seoul.go.kr/dataprovide/trafficdataviewfile.do?data_id=10382)가 있다. 새 키 권한/쿼터/실제 지연·응답은 이번에 시험하지 않았다.

## Q8. ‘영 별로’라는 불만에 관한 관찰

**[모름] 사용자가 그 표현으로 무엇을 지목했는지 직접 설명을 듣지 못했다.** Claude 문서에 기록된 발언을 그 이상의 속뜻으로 확대하지 않는다.

**[직접 확인] 대화에서 실제 반복된 요구:** 결과가 복잡하다, 스크롤이 안 된다, ‘55초 뒤 출발’보다 편한 길을 추구한다, ‘올려서 비교’ 같은 문구를 쓰지 말라, GPS가 안 되는 것 같다, 시간 조절 UI와 색이 별로다, 다른 지도와 차별성이 걱정된다. 이 요구는 해당 대화와 기존 논의 문서에 남아 있다.

**[추정] 내 작업의 문제 후보:**

- 방향을 논의하는 중에 기능·기록 화면·설명 문구가 늘어나 정작 사용자가 바로 이해하고 써 볼 하나의 경험을 약하게 만들었다.
- 사용자가 ‘나이키 런의 걷기 버전’이라고 비유했을 때 이를 기록 앱 우선순위로 빨리 해석했다. 사용자의 최신 확정은 그냥 걷기·기록 삭제이며 그 결정을 따른다.
- 신호 방향·개인 횡단 길이·요일 일반화가 부족한 채 숫자와 UI를 앞세웠다. ‘추정’ 각주가 있어도 앞의 큰 숫자가 주는 확신을 충분히 줄이지 못할 수 있다.
- 보행로 35m 같은 내부 규칙이 사용자의 정상 장소 선택을 막았고, 실제 야외 검증과 브라우저 가짜 GPS 검증의 차이가 남았다.
- 과도한 문서/긴 설명과 ‘서비스성이 있다’는 빠른 동의가 결과물의 체감 품질을 대신할 수 없다.

이것은 내 책임 범위에 대한 가설이지 사용자의 마음을 확정한 답이 아니다. 지금은 새 화면을 더 만들기보다 Q1/Q2/Q4의 물리적 의미를 확인하고 소수 실제 동선의 선택 변화부터 검증하는 것이 맞다고 판단한다.

## 후속 요청. ‘서두르지 않아도 되는 길’의 서비스성 판단

**[직접 확인] 사용자 최신 의견:** Claude의 ‘횡단 여유 중심, 출발 전 계획 + 지도 층 먼저’ 제안을 전달하며 ‘나는 괜찮을 듯하다, 서비스성이 있을지 판단해 달라’고 했다. 긍정적인 방향 신호로 받아들이되 기능 전체의 구현 승인이나 수요 입증으로 쓰지 않는다.

**[추정] 판단: 좁은 첫 서비스로 검증할 가치가 있다. 대중적인 매일 사용 앱·사업성·유료 수요는 아직 미입증이다.** 장점은 ‘최단 거리’ 대신 ‘내 걸음으로 부담스러운 횡단을 미리 피한다’는 선택 이유가 구체적이라는 점이다. 느린 걸음의 당사자나 동행자가 낯선 병원·시장·역 출구에서 경로를 미리 고르는 장면이 첫 가설이다. 고령 사고 통계가 크다는 사실만으로 이 앱이 사고를 줄이거나 그 이용자가 앱을 사용할 것이라고 추론하지 않는다.

**[추정] 계단·오르막·휴식·엘리베이터를 ‘서두름’이라는 단어에 억지로 모두 설명할 필요는 없다.** 외부 문구는 ‘서두르지 않아도 되는 길’, 내부 제품 기준은 ‘내 걸음과 이동 조건에 맞는 길’로 두면 확장 해석이 자연스럽다. 무장애 통행 보증과는 구분한다.

**[문서 근거] ‘그늘로와 겹치지 않는다’는 단정은 부정확하다.** [그늘로의 현재 공식 사이트](https://ttubeok.com/)는 그늘/볕 외 언덕·계단·허용 우회·페이스 기반 코스·횡단보도 표시도 설명한다. 확인한 것은 제품 설명이며 실제 성능 전수 시험은 아니다. 쭉고는 ‘개인 보행속도에 따른 횡단 부담의 근거와 신뢰도’를 더 잘 전달하고 실제 선택을 돕는지로 비교해야 한다. 최초·독점이라는 주장은 하지 않는다.

**[추정] 첫 데모의 제안:**

1. 작은 검증 구역에서 횡단보도 방향·실제 거리·고정녹색/점멸 구간을 확인한다. 모르는 구간은 지도상 공백/미확인으로 둔다.
2. 출발 전 같은 목적지의 두 후보에서 ‘가장 빠듯한 횡단’과 ‘그 구간을 덜 겪는 대안, 추가시간’을 함께 비교한다. **여유 숫자만 보여주고 대안이나 준비 행동이 없으면 앱을 켤 이유가 약하다.**
3. 정적 여유는 ‘신호 시작부터 건널 때 기준’임을 이해할 수 있게 표시한다. 검증 전 ‘지금 건널 수 있음’으로 읽히는 동적 큰 숫자는 제공하지 않는다. 과거 패턴만으로 오늘의 신호를 보장하지 않는다.
4. 지도 층은 단순 ‘초록이 짧다’가 아니라 **개인속도와 횡단거리 대비 어떤가**를 보여준다. 짧은 5m와 긴 30m 횡단에 같은 녹색시간을 동일하게 평가하지 않는다. 정보가 맞더라도 동선을 바꿀 대안이 없으면 추천 가치는 제한된다.
5. 당사자 5명과 실제 방문 동선으로, 일반 지도 후보와 비교해 선택이 달라지는지·추가시간을 받아들이는지·정보 의미를 오해하지 않는지 확인한다. 이는 첫 발견 실험이며 5명으로 시장규모/사업성을 확정하지 않는다. 이후 일정 기간 안에 다시 필요해 자발적으로 여는지 확인한다.

**[추정] 보류/축소 조건:** 대다수가 숫자를 보고도 아무 행동을 바꾸지 않거나, 편한 대안이 없거나, 자료 부족으로 거의 전부 미확인이거나, 정적 여유를 ‘지금 건너도 된다’고 오해하면 추천 서비스의 약속을 줄인다. 넓은 지도 앱을 복제하기보다 검증 구역의 방문 동선 정보로 범위를 좁히는 대안이 있다. 실시간 음성·진동은 위치/신호 검증 뒤 별도 단계다. API 전체 종료 때문에 불가능한 것은 아니지만, 새 API가 있다는 이유만으로 가능해진 것도 아니다.

## 검증 범위와 미완료

- 실행: 14일 해시·보존 상태·08~10시 날짜 간 재생 시험, 공개 API 5행 및 정의서 XML 수령, GitHub 공개 Release/수집 상태·secret 이름만·default branch, Vercel 현재 배포 조회.
- 미완료: 방향/국내 점멸 의미 확정, 24시간 전체·원본 ZIP 공백 원인 감사, OA-21209 전량/공식 단위·OA-15554 공간 값 대조, 현장 보행, 실제 사용자/시장 검증.
- 이번 임시 시험의 첫 실행에서는 pandas 시간 단위 정규화를 빠뜨려 잘못된 공백 결과가 나왔다. 그 실행은 중단·폐기하고 `datetime64[ns, UTC]` 명시 후 **14일 전부 다시 실행한 결과만** 위에 썼다. 부록 코드도 수정본이다.
- 앱 회귀 테스트/브라우저 시험은 이번에 돌리지 않았다. 앱을 바꾸지 않았고, 이 문서의 자료 검증과 앱 동작 검증은 별개다.
- Claude 브랜치·앱·workflow·Vercel 설정·PR 상태를 수정하지 않았다. 이 파일만 `codex/refine-time-results`에 커밋/push한다.

## 부록 A. 날짜 간 시험 재현 코드

아래 코드는 제품 코드가 아닌 이번 답변의 분석 절차다. 저장소 밖 임시 폴더에 저장하고 `ROOT`를 저장소 경로로 맞춰 실행한다. Python 환경에 numpy/pandas가 필요하다. 소스 날짜별 캐시가 없으면 `scripts/export_history_plans.py --day <해당 CSV.GZ>`로 먼저 생성한다. 재생성 시 패키지 버전과 캐시 SHA도 남긴다. 앱용 `publish()`를 실행하거나 앱 데이터를 덮어쓸 필요는 없다. 코드의 임시 출력은 앱/배포 경로 밖에 둔다.

```python
import json, hashlib, sys, gzip
from pathlib import Path
from datetime import datetime, timezone, timedelta
import numpy as np
import pandas as pd

ROOT=Path(__file__).parent/'JJUK_GO'
OUT=Path(__file__).parent/'q3_codex_audit'
OUT.mkdir(exist_ok=True)
KST=timezone(timedelta(hours=9))
plans={}
for p in sorted((ROOT/'datastore/history/plans-v2').glob('????????.json')):
    date=p.stem
    plans[date]={}
    for ident,hours in json.loads(p.read_text()).items():
        for h,dirs in hours.items():
            if int(h) not in (8,9,10): continue
            for code,r in dirs.items(): plans[date][(int(ident),code,int(h))]=r
print('plans', {d:len(v) for d,v in plans.items()},flush=True)
allrows=[]; daily=[]; hashed=[]
for p in sorted((ROOT/'official-history').glob('????????.csv.gz')):
    date=p.name[:8]
    meta=json.loads(p.with_name(date+'.json').read_text())
    hashed.append({'date':date,'sha256_ok':hashlib.sha256(p.read_bytes()).hexdigest()==meta['segment_sha256']})
    zero=datetime.strptime(date,'%Y%m%d').replace(tzinfo=KST).timestamp()
    selected=[]; states={}; obs_hours={str(h):0 for h in range(24)}
    for c in pd.read_csv(p,chunksize=300000,usecols=['itst_id','direction','state','start_utc','end_utc']):
        counts=c.state.value_counts()
        for s,n in counts.items(): states[s]=states.get(s,0)+int(n)
        a=pd.to_datetime(c.start_utc,utc=True).astype('datetime64[ns, UTC]').astype('int64').to_numpy()/1e9-zero
        b=pd.to_datetime(c.end_utc,utc=True).astype('datetime64[ns, UTC]').astype('int64').to_numpy()/1e9-zero
        for h in range(24): obs_hours[str(h)]+=int(np.sum((a<(h+1)*3600)&(b>=h*3600)))
        ok=(a<11*3600)&(b>=8*3600)
        if ok.any():
            z=c.loc[ok,['itst_id','direction','state']].copy()
            z['a']=a[ok];z['b']=b[ok];selected.append(z)
    target_weekend=datetime.strptime(date,'%Y%m%d').weekday()>=5
    scored=0
    if selected:
        frame=pd.concat(selected,ignore_index=True)
        for (ident,code),g in frame.groupby(['itst_id','direction'],sort=False):
            aa=g.a.to_numpy();bb=g.b.to_numpy();gg=g.state.str.startswith(('protected','permissive')).to_numpy()
            for h in (8,9,10):
                mask=(aa<(h+1)*3600)&(bb>=h*3600)
                if not mask.any(): continue
                # Each compact segment retains only the interval actually observed.
                # Sample at 1 s from start; [a,b), same convention as Claude xday.py.
                tt=[];yy=[]
                for a,b,green in zip(aa[mask],bb[mask],gg[mask]):
                    t=np.arange(max(a,h*3600),min(b,(h+1)*3600),1.)
                    if len(t): tt.append(t);yy.append(np.full(len(t),green))
                if not tt: continue
                t=np.concatenate(tt);truth=np.concatenate(yy)
                order=np.argsort(t);t=t[order];truth=truth[order]
                keep=np.r_[True,np.diff(t)>.5];t=t[keep];truth=truth[keep]
                if len(t)<120 or not truth.any() or truth.all(): continue
                key=(int(ident),code,h); candidates=[]
                for source,pp in plans.items():
                    if source==date or key not in pp:continue
                    r=pp[key];phase=np.mod(r['day0']+t-r['ref'],r['c'])
                    pred=np.zeros(len(t),dtype=bool)
                    for lo,hi in r['win']:
                        pred|=((phase>=lo)&(phase<hi))|((phase+r['c']>=lo)&(phase+r['c']<hi))
                    ng=int(truth.sum());nr=len(t)-ng
                    acc=float(np.mean(pred==truth));grecall=float(pred[truth].mean());rrecall=float((~pred[~truth]).mean())
                    sw=datetime.strptime(source,'%Y%m%d').weekday()>=5
                    gap=(datetime.strptime(date,'%Y%m%d')-datetime.strptime(source,'%Y%m%d')).days
                    item={'target':date,'source':source,'id':int(ident),'code':code,'hour':h,'gap':gap,'target_kind':'weekend' if target_weekend else 'weekday','source_kind':'weekend' if sw else 'weekday','n':len(t),'acc':acc,'base_red':nr/len(t),'balanced':(grecall+rrecall)/2,'green_recall':grecall,'selected_same':False,'selected_cross':False,'selected_past_same':False}
                    candidates.append(item)
                if candidates:
                    for flag,pool in [('selected_same',[r for r in candidates if r['target_kind']==r['source_kind']]),('selected_cross',[r for r in candidates if r['target_kind']!=r['source_kind']]),('selected_past_same',[r for r in candidates if r['target_kind']==r['source_kind'] and r['gap']>0])]:
                        if pool:
                            # Latest remaining source date, independent of target accuracy.
                            max(pool,key=lambda r:r['source'])[flag]=True
                    allrows.extend(candidates);scored+=1
    daily.append({'date':date,'kind':'weekend' if target_weekend else 'weekday','observed_segments_per_hour':obs_hours,'states':states,'eligible_target_cells_with_source':scored})
    print(json.dumps(daily[-1]),flush=True)
R=pd.DataFrame(allrows)
def stat(x):
    if not len(x):return {'cells':0}
    return {'cells':len(x),'mean_accuracy':float(x.acc.mean()),'weighted_accuracy':float(np.average(x.acc,weights=x.n)),'share_ge95':float((x.acc>=.95).mean()),'balanced_accuracy':float(x.balanced.mean()),'green_recall':float(x.green_recall.mean()),'always_red_accuracy':float(x.base_red.mean()),'samples':int(x.n.sum())}
summary={'method':'8,9,10 KST; compact observed [a,b), 1 s sampling; >=120 samples, both truth states; source date != target; frozen per-day 70/30-selected fit cache; protected+permissive green; both classes required; latest-other-date not best accuracy', 'hashes':hashed,'daily':daily,'pair_groups':{},'distance':{},'loo':{},'loo_daily':{}}
for (s,t),g in R.groupby(['source_kind','target_kind']):summary['pair_groups'][s+'->'+t]=stat(g)
for gap,g in R.groupby(R.gap.abs()):summary['distance'][str(gap)]=stat(g)
for flag in ['selected_same','selected_cross','selected_past_same']:
    for kind in ['weekday','weekend']:
        x=R[R[flag]&(R.target_kind==kind)];summary['loo'][flag+'_'+kind]=stat(x)
    summary['loo_daily'][flag]={date:stat(g) for date,g in R[R[flag]].groupby('target')}
R.to_csv(OUT/'pair_results.csv.gz',index=False)
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY',json.dumps({k:v for k,v in summary.items() if k not in ['daily','loo_daily']},ensure_ascii=False),flush=True)
```

### 실행 입력 캐시 해시

이 캐시는 원본 가공 파일 자체와 다르다. 아래 해시는 이번 시험에 실제 사용한 날짜별 캐시를 식별한다. 원본 가공 파일 해시는 Git의 해당 날짜 메타데이터에 있다.

| 날짜 | plans-v2 SHA256 |
|---|---|
| 20261014 | `02f3ae94ff2ee621e61df84521e03dba8098d51f0d8086363818f6d0e8453c79` |
| 20261015 | `9bd0d4d8f2307c33bd0bf1952a7b397294f4a94193111aaae829ec9cb369b623` |
| 20261016 | `f3f04b384229925f743f32d5989b7e3cb3eae330ec7e4da8befad70def8c5ae2` |
| 20261017 | `31402e7fa63d264ff24a0518a9736abf41ea727edb7b29e0b1e69470626b4d43` |
| 20261018 | `050e5c6bfed336833a340affb0871bc49726ef270a6a0d8f47d531ce34fb8a98` |
| 20261019 | `3c34f771a5d20fac0d6eda4ee19d4f835c1407dcf6e592bd12f76d9ae9a04789` |
| 20261020 | `085620c4e8010e5c8ea3de9822f5f0abd318c444121566a78852bb2780bf3d01` |
| 20261021 | `735000840ccc6d55a3b3aad999c5a91ae352280090c6912d9359a2166048a651` |
| 20261022 | `09095b16d4d7f3263597b6d1bc006e2b36bc639fbcfa066ee956f5504dcaec7b` |
| 20261023 | `700366b9f689a5f71a94223422118603ad14bc385f4816adeb633393ebdec1c5` |
| 20261024 | `161a8d54e9a941081d7fbabae42b90f1d1fbf6ba3904b38062e3603cef480743` |
| 20261025 | `785a3a2fdd573d6cda081d0329b125e33bca91625a838b37b25b44fb5b713ea8` |
| 20261026 | `6caef9dad65ecdc06e71b8a668084a4f682260066c4b7482d47961002eb4612b` |
| 20261027 | `69105ddd8dca79e04cd3601b0bff967440629cfb88433a2539b9ae2384f301eb` |
