"""서울교통빅데이터플랫폼(T Data) C-ITS 신호 API 클라이언트.

응답의 정확한 포장 구조가 공식 문서에 없어서, JSON 어디에 있든
`itstId`를 가진 레코드 목록을 찾아 꺼낸다.

이 API에는 호출 간격 제한이 있다 (2026-10-28 실측):
  HTTP 429 {"code":"V2X_REPEAT_CALL_LIMIT","limitSeconds":300,"retryAfterSeconds":101}
하루 한도(QuotaExceeded)와 달리 기다리면 풀리므로 RateLimited로 따로 다룬다.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

QUOTA_HINTS = ("한도", "초과", "limit", "quota", "exceed")


class ApiError(Exception):
    pass


class QuotaExceeded(ApiError):
    """하루 호출 한도 초과. 그날은 더 부르지 않는다."""


class RateLimited(ApiError):
    """호출 간격 제한. retry_after_s 뒤에 다시 부르면 된다."""

    def __init__(self, message: str, retry_after_s: float | None = None, limit_s: float | None = None):
        super().__init__(message)
        self.retry_after_s = retry_after_s
        self.limit_s = limit_s


def parse_rate_limit(payload: Any) -> RateLimited | None:
    """응답 본문이 호출 간격 제한이면 RateLimited를 돌려준다."""
    if not isinstance(payload, dict):
        return None
    code = str(payload.get("code", ""))
    if "REPEAT_CALL" not in code and "retryAfterSeconds" not in payload:
        return None
    return RateLimited(
        f"{code or '429'}: {payload.get('error', '')} (limit {payload.get('limitSeconds')}s, retry after {payload.get('retryAfterSeconds')}s)",
        retry_after_s=payload.get("retryAfterSeconds"),
        limit_s=payload.get("limitSeconds"),
    )


def extract_records(payload: Any) -> list[dict]:
    """JSON 안에서 `itstId` 키를 가진 dict 목록을 찾아 반환한다."""
    if isinstance(payload, list):
        if payload and all(isinstance(x, dict) for x in payload) and any("itstId" in x for x in payload):
            return payload
        for item in payload:
            found = extract_records(item)
            if found:
                return found
    elif isinstance(payload, dict):
        if "itstId" in payload:
            return [payload]
        for value in payload.values():
            found = extract_records(value)
            if found:
                return found
    return []


def extract_total_count(payload: Any) -> int | None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key.lower() == "totalcount":
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None
            found = extract_total_count(value)
            if found is not None:
                return found
    return None


def check_error(payload: Any) -> None:
    """응답 본문에 담긴 오류(예: {"responseCode":404,"message":...})를 예외로 바꾼다."""
    limited = parse_rate_limit(payload)
    if limited:
        raise limited
    if not isinstance(payload, dict) or "responseCode" not in payload:
        return
    code = str(payload.get("responseCode"))
    if code in ("200", "0", "00"):
        return
    message = str(payload.get("message", ""))
    if code == "429" or any(h in message.lower() for h in QUOTA_HINTS):
        raise QuotaExceeded(f"{code}: {message}")
    raise ApiError(f"{code}: {message}")


class TDataClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_s: float = 20,
        max_retries: int = 3,
        on_call: Callable[[], None] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rate_limit_wait_max_s: float = 330,
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.on_call = on_call or (lambda: None)
        self.sleep = sleep
        self.rate_limit_wait_max_s = rate_limit_wait_max_s

    def _get(self, params: dict) -> Any:
        url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            self.on_call()  # 재시도도 호출 횟수에 포함된다
            try:
                with urllib.request.urlopen(url, timeout=self.timeout_s) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(body)
                except json.JSONDecodeError:
                    parsed = None
                limited = parse_rate_limit(parsed)
                if limited:
                    raise limited from e
                if e.code == 429:
                    raise QuotaExceeded(f"HTTP 429: {body[:200]}") from e
                if e.code < 500:
                    check_error(parsed)
                    raise ApiError(f"HTTP {e.code}: {body[:200]}") from e
                last_error = e
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last_error = e
            self.sleep(2 ** attempt)
        raise ApiError(f"요청 실패 ({self.max_retries}회 시도): {last_error}")

    def fetch(
        self,
        page_no: int = 1,
        num_of_rows: int = 1000,
        itst_id: str | None = None,
        max_wait_s: float | None = None,
    ) -> tuple[list[dict], int | None]:
        """호출 간격 제한에 걸리면 max_wait_s(기본 rate_limit_wait_max_s) 이내일 때만 기다렸다가 한 번 더 부른다."""
        params = {"apiKey": self.api_key, "type": "json", "pageNo": page_no, "numOfRows": num_of_rows}
        if itst_id is not None:
            params["itstId"] = itst_id
        wait_cap = self.rate_limit_wait_max_s if max_wait_s is None else max_wait_s
        try:
            payload = self._get(params)
            check_error(payload)
        except RateLimited as e:
            if e.retry_after_s is None or e.retry_after_s > wait_cap:
                raise
            self.sleep(e.retry_after_s + 2)
            payload = self._get(params)
            check_error(payload)
        return extract_records(payload), extract_total_count(payload)


class FixtureClient:
    """--dry-run 용: 파일에 담긴 가짜 응답으로 TDataClient를 흉내 낸다."""

    def __init__(self, fixture_path: Path, on_call: Callable[[], None] | None = None):
        self.records = extract_records(json.loads(Path(fixture_path).read_text(encoding="utf-8")))
        self.on_call = on_call or (lambda: None)

    def fetch(
        self,
        page_no: int = 1,
        num_of_rows: int = 1000,
        itst_id: str | None = None,
        max_wait_s: float | None = None,
    ) -> tuple[list[dict], int | None]:
        self.on_call()
        rows = [r for r in self.records if itst_id is None or str(r.get("itstId")) == str(itst_id)]
        start = (page_no - 1) * num_of_rows
        return rows[start:start + num_of_rows], len(rows)
