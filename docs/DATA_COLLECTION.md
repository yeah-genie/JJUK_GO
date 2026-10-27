# 신호 데이터 자동 수집

쭉고의 신호 대기시간 학습 데이터는 **사람이 내려받지 않는다.** GitHub Actions가 15분마다 서울시 C-ITS 실시간 API를 호출해 스냅샷을 쌓는다.

## 왜 CSV 다운로드가 아니라 API 수집인가

2026-10-27 기준, 서울교통빅데이터플랫폼에서 확인되는 C-ITS 신호 데이터는 다음 두 가지다.

- 실시간 Open API: 신호 현시, 잔여시간, 둘을 합친 정보(`v2xSignalPhaseTimingFusionInformation`). 2026-09-11 갱신.
- 정적 CSV: 교차로 MAP, 신호연결 MAP 등 기반 정보.

공식 페이지에서 **과거 신호이력 파일은 확인되지 않았다.** 그래서 실시간 API를 주기적으로 불러 이력을 직접 만든다. 나중에 공식 이력 파일이 나오면 `config/collector.toml`의 `[static] sources`에 URL을 넣어 같은 자동화로 받으면 된다.

## 호출 전략

### 스냅샷 하나에서 전환 시각을 얻는다
응답에는 방향별 보행신호의 **현재 상태 + 잔여시간(1/10초)**이 들어 있다. 그래서 한 번만 호출해도 "이 신호가 언제 바뀌는지"를 정확히 알 수 있다. 고정주기 신호라면 하루 수십 개 스냅샷을 여러 날 모아 주기 길이로 접으면(phase folding) 주기·녹색 시간·오프셋을 복원할 수 있다. **계속 녹화할 필요가 없고, 듬성듬성 샘플링해도 충분하다.**

### 1) 첫 실행에서 일괄 조회가 되는지 자동 확인 (probe)
교차로 ID(`itstId`) 없이 `numOfRows=1000`으로 한 번 호출해 본다. 결과는 `meta/api_probe.json`에 남는다.

| 결과 | 모드 | 동작 |
|---|---|---|
| 여러 교차로가 한 번에 옴 | `bulk` | 한 번 실행할 때 전체 페이지(예: 2,779건 ÷ 1,000 = 3페이지)를 받는다. 대상 교차로가 정해져 있으면 그 교차로만 저장한다. |
| 오류 또는 교차로 1개만 옴 | `per_intersection` | 대상 교차로를 **라운드로빈**으로 한 번에 하나씩 호출한다. 다음 순번은 `meta/cursor.json`에 남는다. |

API 동작이 바뀌어 다시 확인하려면 data 브랜치에서 `meta/api_probe.json`을 지우면 된다.

### 2) 하루 예산
- 하루 한도는 1,000회로 가정했다. 그중 **70%(700회)는 수집**에 쓰고, **30%(300회)는 서비스의 실시간 조회용**으로 남긴다.
- 날짜는 KST 자정 기준이다. 사용량은 `meta/usage/YYYY-MM-DD.json`에 기록되고, 재시도한 호출도 횟수에 포함된다.
- 매 실행은 남은 예산을 **오늘 남은 실행 횟수에 가중치대로 나눈 만큼**만 쓴다. 출퇴근·점심 시간대(7–9시, 12–13시, 18–19시)에는 2배를 배정한다.
- GitHub cron이 밀리거나 실행이 빠지면 남은 실행 횟수가 줄어서 다음 실행의 몫이 자동으로 커진다. 그날 마지막 실행은 남은 예산을 모두 쓴다.
- 한도 초과 응답(HTTP 429, "한도/초과" 메시지)을 받으면 그날 수집을 멈춘다.

### 3) 서비스에서 호출할 때 (V3, 나중에 구현)
- 경로를 요청받으면 도착까지 2분 안에 만나는 신호 1~2개만 조회한다.
- 교차로 단위로 캐시하고, 캐시 유효시간(TTL)은 응답의 잔여시간, 즉 다음 신호가 바뀌는 시각까지로 둔다. 여러 사용자가 같은 캐시를 공유한다.

### 한도를 늘리려면
서울 열린데이터광장은 활용사례(갤러리)에 서비스를 등록하고 승인받으면 호출 제한을 풀어준다고 안내하고 있다. T Data 플랫폼에도 같은 제도가 있는지 확인해 볼 만하다. 한도가 바뀌면 `daily_limit`만 고치면 된다.

## 처음 한 번 해야 할 일 (사람이 직접)

1. [서울교통빅데이터플랫폼](https://t-data.seoul.go.kr)에서 「신호제어기 신호 잔여시간 정보서비스」 Open API 활용 신청을 하고 API 키를 받는다.
2. GitHub 리포의 **Settings → Secrets and variables → Actions → New repository secret**에서
   - Name: `SEOUL_TDATA_API_KEY`
   - Value: 발급받은 키
3. **Actions → collect → Run workflow**로 한 번 수동 실행한다. `data` 브랜치가 생기고 `meta/api_probe.json`이 들어오면 정상이다.
4. (교차로별 모드로 판정됐다면) 대상 교차로 목록이 필요하다. 아래 둘 중 하나를 하면 된다.
   - `config/collector.toml`의 `itst_ids`에 교차로 ID를 직접 적는다.
   - 교차로 MAP CSV를 `config/targets.csv`로 넣는다. 교차로 ID·위도·경도 열은 자동으로 찾고, `bbox`(강남역–선릉) 안에 있는 교차로만 고른다.

키가 없으면 워크플로는 경고만 남기고 성공으로 끝난다(실패 알림이 쌓이지 않게).

## 자동으로 도는 것들

| 워크플로 | 주기 | 하는 일 |
|---|---|---|
| `collect` | 15분마다 | 예산 안에서 수집 → `data` 브랜치에 커밋 |
| `daily-report` | 매일 00:30 KST | 전날 행 수, 교차로 수, 시간대별 분포, 결측 수 점검 → `meta/daily_report/` |
| `static-data` | 매주 월요일 03:17 KST | `[static] sources`에 적힌 정적 파일 갱신 |
| `ci` | push / PR | 테스트 |

> GitHub는 공개 리포에서 60일 동안 활동이 없으면 예약 워크플로를 꺼버린다. 수집이 멈췄다면 Actions 탭에서 다시 켜면 된다.

## data 브랜치 구조

```
signals/YYYY/MM/DD/HHMMSS.csv.gz   # 실행 1번 = 파일 1개 (KST). 기존 파일은 고쳐 쓰지 않는다.
meta/api_probe.json                # 일괄 조회 판정 결과 + 응답 예시
meta/usage/YYYY-MM-DD.json         # 그날 호출 수, 한도 도달 여부
meta/cursor.json                   # 교차로별 모드의 라운드로빈 위치
meta/daily_report/YYYY-MM-DD.md    # 일일 점검 리포트
static/*.csv                       # 정적 MAP 파일
```

### 행 스키마
| 열 | 설명 |
|---|---|
| `collected_at_utc` | 수집기가 호출한 시각 (UTC) |
| `trsm_utc` | API가 준 전송 시각 원본값 (`trsmUtcTime`) |
| `itst_id` | 교차로 ID |
| `direction` | nt, ne, et, se, st, sw, wt, nw (북, 북동, 동, 남동, 남, 남서, 서, 북서) |
| `movement` | Pd(보행)가 기본값이다. `[store] movements`에서 St, Lt, Ut, Bs, Bc도 고를 수 있다. |
| `state` | 신호 상태 원본값 (`*StatNm`) |
| `remaining_ds` | 잔여시간, 1/10초 (`*RmdrCs`) |

### 분석할 때 불러오기
```bash
git fetch origin data && git worktree add datastore origin/data
```
```python
import pandas as pd, glob
df = pd.concat(pd.read_csv(p) for p in glob.glob("datastore/signals/2026/11/*/*.csv.gz"))
```

## 로컬에서 실행
```bash
PYTHONPATH=src python -m jjukgo.collect once --dry-run --data-dir /tmp/jjukgo   # 가짜 응답으로 동작 확인
SEOUL_TDATA_API_KEY=... PYTHONPATH=src python -m jjukgo.collect probe --data-dir /tmp/jjukgo
python -m pytest -q
```

## 확인이 필요한 가정
- 하루 1,000회 한도: 공식 API 페이지에는 적혀 있지 않다. 그린인 개발자 사례와 일반 안내를 근거로 잡은 값이다.
- 응답 JSON 구조와 상태 필드 이름(`*StatNm`): 공식 출력 목록을 기준으로 했다. 실제 응답이 다르면 `meta/api_probe.json`의 `sample_keys`를 보고 `src/jjukgo/normalize.py`의 `FIELD_RE`를 고친다.
