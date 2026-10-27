"""서울교통빅데이터플랫폼(T Data) C-ITS 신호 API 클라이언트.

응답의 정확한 포장 구조가 공식 문서에 없어서, JSON 어디에 있든
`itstId`를 가진 레코드 목록을 찾아 꺼낸다.
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
    pass


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
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.on_call = on_call or (lambda: None)
        self.sleep = sleep

    def _get(self, params: dict) -> Any:
        url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            self.on_call()  # 재시도도 호출 한도에 포함된다
            try:
                with urllib.request.urlopen(url, timeout=self.timeout_s) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                if e.code == 429:
                    raise QuotaExceeded(f"HTTP 429: {body[:200]}") from e
                if e.code < 500:
                    try:
                        check_error(json.loads(body))
                    except json.JSONDecodeError:
                        pass
                    raise ApiError(f"HTTP {e.code}: {body[:200]}") from e
                last_error = e
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last_error = e
            self.sleep(2 ** attempt)
        raise ApiError(f"요청 실패 ({self.max_retries}회 시도): {last_error}")

    def fetch(self, page_no: int = 1, num_of_rows: int = 1000, itst_id: str | None = None) -> tuple[list[dict], int | None]:
        params = {"apiKey": self.api_key, "type": "json", "pageNo": page_no, "numOfRows": num_of_rows}
        if itst_id is not None:
            params["itstId"] = itst_id
        payload = self._get(params)
        check_error(payload)
        return extract_records(payload), extract_total_count(payload)


class FixtureClient:
    """--dry-run 용: 파일에 담긴 가짜 응답으로 TDataClient를 흉내 낸다."""

    def __init__(self, fixture_path: Path, on_call: Callable[[], None] | None = None):
        self.records = extract_records(json.loads(Path(fixture_path).read_text(encoding="utf-8")))
        self.on_call = on_call or (lambda: None)

    def fetch(self, page_no: int = 1, num_of_rows: int = 1000, itst_id: str | None = None) -> tuple[list[dict], int | None]:
        self.on_call()
        rows = [r for r in self.records if itst_id is None or str(r.get("itstId")) == str(itst_id)]
        start = (page_no - 1) * num_of_rows
        return rows[start:start + num_of_rows], len(rows)
