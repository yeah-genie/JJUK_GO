# TData 수집 지속성 확인

## 현재 수집이 계속되는가

### Takeaway
2026-10-28 20:24:45 KST 확인 시 현재는 회복돼 성공 응답과 실제 신호 구간 저장이 이어진다. 하지만 당일 내내 5분마다 정상 수집됐다고 말하면 틀리다.

### Cited Findings
- 읽기 전용 `git fetch origin data` 후 immutable snapshot `52b5ce05ea1cc83aa24f50f133b53340af256133`을 분석했다. `collector_snapshot.json`에 결과를 보존했다. [고정 스냅샷](https://github.com/yeah-genie/JJUK_GO/tree/52b5ce05ea1cc83aa24f50f133b53340af256133).
- 성공 로그가 19:02:21~20:23:56 KST 17회 연속 기록됐다. 응답 성공 로그 간 간격은 최소 297초, 중앙값 306초, 최대 317초다. 성공 시각 간 차이이며 요청 시작 간격과 다르다. [call_log.csv](https://github.com/yeah-genie/JJUK_GO/blob/52b5ce05ea1cc83aa24f50f133b53340af256133/meta/call_log.csv).
- 로그가 시작된 13:14:32 KST 이후 기록에는 ok 35건, net_error 47건, 429_repeat 47건이 있다. 하루 전체 성공률이 아니라 현재 call_log에 존재하는 구간의 집계다. [동일 로그](https://github.com/yeah-genie/JJUK_GO/blob/52b5ce05ea1cc83aa24f50f133b53340af256133/meta/call_log.csv).
- 마지막 오류 전 구간: 14:46:18부터 18:57:11 KST까지 교차로 2212에서 TimeoutError와 429_repeat가 반복됐다. 마지막 이전 성공 14:40:56과 회복 성공 19:02:21 사이 **4시간 21분 25초** 공백. [동일 로그](https://github.com/yeah-genie/JJUK_GO/blob/52b5ce05ea1cc83aa24f50f133b53340af256133/meta/call_log.csv).
- 최근 5개 압축 segment 파일을 실제 압축 해제해 CSV를 읽었다. 최신 `201907.csv.gz`는 교차로 4500의 비어 있지 않은 130개 구간을 담고, 마지막 표본 end_utc 11:23:53.631Z = **20:23:53.631 KST**였다. HTTP 성공만 확인한 것이 아니다. 파일명은 수집 작업 시작 시각을 반영하며 실제 마지막 표본 시각과 다를 수 있다. [최신 파일의 커밋 고정 경로](https://github.com/yeah-genie/JJUK_GO/blob/52b5ce05ea1cc83aa24f50f133b53340af256133/segments/2026/10/28/201907.csv.gz).
- 같은 snapshot의 당일 저장 segment 파일은 58개. raw 저장 설정은 false이므로 상태 구간(segments)이 주 적재 위치다. usage.calls=363, quota_hit=false. 호출 수는 성공 행 수가 아니며 이 숫자만으로 API 한도 규약을 검증한 것은 아니다. [usage](https://github.com/yeah-genie/JJUK_GO/blob/52b5ce05ea1cc83aa24f50f133b53340af256133/meta/usage/2026-10-28.json).
- GitHub Actions run 40678316489는 in_progress, Collect step 실행 중이었고 이전 run 40671646607은 success였다. 실행 성공 자체는 수집 성공과 다르다. [실행](https://github.com/yeah-genie/JJUK_GO/actions/runs/40678316489), [이전 실행](https://github.com/yeah-genie/JJUK_GO/actions/runs/40671646607).

### Inferences
- 지금은 정상 회복 상태이지만 장시간 결측 구간이 있어 ‘계속 끊김 없이’라는 표현은 부적절하다.
- API의 실제 정상 여부는 Actions success보다 최근 성공 응답, 데이터의 실제 표본 시각, 교차로별 커버리지로 판정해야 한다.

### Gaps
- 오류 원인 전부가 API 서버 장애인지, timeout 20초 설정인지까지 확정하지 않았다. 별도 API를 호출하거나 키를 읽지 않았다.
- 이번 요청은 현재 상태 확인이며 장기 모니터링 자동화는 설정하지 않았다. 확인 시점 이후 상태는 달라질 수 있다.

## 5분은 무엇의 주기인가

### Takeaway
5분마다 키 전체에서 교차로 한 곳을 부른다. 개별 교차로마다 5분 주기의 연속 관측을 보장하지 않는다.

### Cited Findings
- loop의 GAP은 305초이며 50분 실행 뒤 다음 workflow_dispatch로 연결하고 시간당 cron은 보조다. [collect_loop.sh](https://github.com/yeah-genie/JJUK_GO/blob/ccr-94bac9df-i81579/scripts/collect_loop.sh), [workflow](https://github.com/yeah-genie/JJUK_GO/blob/ccr-94bac9df-i81579/.github/workflows/collect.yml).
- 현재 설정 핵심 교차로 10곳, crawl_every=2, calls_per_run=1. 핵심과 서울 전역 순회를 교대로 수행한다. rows_per_intersection=2200은 요청 건수이지 매번 수신한 실제 행 수를 뜻하지 않는다. [config](https://github.com/yeah-genie/JJUK_GO/blob/ccr-94bac9df-i81579/config/collector.toml).
- 호출 실패 시 round-robin cursor의 다음 위치 저장까지 도달하지 못하는 코드 경로가 있으며, 로그에서 2212 반복과 일치한다. 클라이언트 `_get` 내부 네트워크 재시도는 2**attempt 대기이고 재시도마다 `_space_out`을 거치지 않는다. [collect.py](https://github.com/yeah-genie/JJUK_GO/blob/ccr-94bac9df-i81579/src/jjukgo/collect.py), [tdata_client.py](https://github.com/yeah-genie/JJUK_GO/blob/ccr-94bac9df-i81579/src/jjukgo/tdata_client.py).

### Inferences
- 정상 기준 핵심 한 바퀴는 10×2×305초 = 약 **101분 40초**다. 실행 전환·오류로 더 길어질 수 있다. API 이력 보관을 기존 실측 약 35분으로 가정하면 전 핵심 신호의 완전 연속 이력 확보와 양립하기 어렵다.
- 핵심 연속성 검증을 우선하면 수집 대상 수·서울 전역 탐색 비중을 줄일 필요가 있다. 예를 들어 핵심 3곳+탐색 절반은 계산상 약 30분30초 순환이나, 실제 응답 이력 폭과 실패 여유를 확인해야 한다. 사용자 승인 없이 설정을 변경하지 않았다.
- 개선 권고: 네트워크 재시도도 마지막 호출 기준 305초 간격 준수, 실패 대상의 연속 독점 방지(대상별 cooldown/다음 대상 진행), 최근 데이터 freshness 판정과 실패를 성공 workflow와 구분. 이번에는 코드 변경을 하지 않았다.

### Gaps
- 과거 결측을 API에서 소급 복원할 수 있는지는 미확인. 복구됐다고 주장하지 않는다.
- 교차로별·방향별 이력의 완전성은 추가 분석이 필요하다. 이번에는 최신 5개 segment의 비어 있지 않은 상태와 실제 시각을 확인했다.
