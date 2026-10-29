import contextlib
import csv
import gzip
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path
from unittest import mock

import pytest

SPEC = importlib.util.spec_from_file_location(
    "fetch_crosswalks", Path(__file__).resolve().parents[1] / "scripts" / "fetch_crosswalks.py")
fc = importlib.util.module_from_spec(SPEC)
sys.modules["fetch_crosswalks"] = fc
SPEC.loader.exec_module(fc)

KEY = "SECRETKEY123"


def row(i, kind="LINK", length="12.5", sgg="강남구", wkt=None):
    return {"NODE_TYPE": kind, "NODE_WKT": "POINT(127.0 37.5)", "NODE_ID": str(i), "NODE_TYPE_CD": "1",
            "LNKG_WKT": wkt or "LINESTRING(127.0 37.5, 127.1 37.6)", "LNKG_ID": str(i), "LNKG_TYPE_CD": "2",
            "BGNG_LNKG_ID": "1", "END_LNKG_ID": "2", "LNKG_LEN": length, "SGG_CD": "11680", "SGG_NM": sgg,
            "EMD_CD": "1", "EMD_NM": "역삼동"}


def ok_payload(rows, total):
    return {"tbTraficCrsng": {"list_total_count": total, "RESULT": {"CODE": "INFO-000", "MESSAGE": "정상"},
                              "row": rows}}


class Resp:
    status = 200

    def __init__(self, obj):
        self.body = json.dumps(obj).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def server(total, errors=0, mutate=None):
    """urlopen 대체: URL의 start/end에 맞춰 행을 만들어 준다. 앞의 errors번은 네트워크 오류."""
    state = {"calls": 0, "urls": []}

    def fake(url, timeout=None):
        state["calls"] += 1
        state["urls"].append(url)
        if state["calls"] <= errors:
            raise urllib.error.URLError(f"timed out for {url}")
        start, end = map(int, url.rstrip("/").split("/")[-2:])
        rows = [row(i, kind="NODE" if i % 3 == 0 else "LINK") for i in range(start, min(end, total) + 1)]
        payload = ok_payload(rows, total)
        return Resp(mutate(payload, start) if mutate else payload)

    return fake, state


@pytest.fixture(autouse=True)
def clean():
    fc._secrets.clear()
    yield
    fc._secrets.clear()


def run(tmp_path, capsys, env_key=KEY, args=()):
    env = {} if env_key is None else {"SEOUL_OPENAPI_KEY": env_key}
    with mock.patch.dict("os.environ", env, clear=True):
        code = fc.main(["--out-dir", str(tmp_path), *args], sleep=lambda s: None)
    out = capsys.readouterr()
    return code, out.out + out.err


def test_three_pages_ok(tmp_path, capsys):
    fake, state = server(2500)
    with mock.patch("urllib.request.urlopen", fake):
        code, out = run(tmp_path, capsys)
    assert code == 0
    assert state["calls"] == 3
    assert state["urls"][1].endswith("/json/tbTraficCrsng/1001/2000/")
    assert state["urls"][2].endswith("/2001/3000/")
    summary = json.loads((tmp_path / "oa21209_summary.json").read_text("utf-8"))
    assert summary["row_count"] == summary["list_total_count"] == 2500
    assert summary["node_count"] + summary["link_count"] == 2500
    assert summary["service"] == "tbTraficCrsng"
    assert summary["by_sgg_nm"] == {"강남구": 2500}
    assert summary["lnkg_len"]["median"] == 12.5 and summary["lnkg_len"]["zero_count"] == 0
    assert summary["coord_range"]["x_max"] == 127.1
    assert summary["wkt_parse_failed"] == 0
    with gzip.open(tmp_path / "oa21209_rows.csv.gz", "rt", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 2500 and list(rows[0])[:3] == ["NODE_TYPE", "NODE_WKT", "NODE_ID"]


def test_missing_key_message(tmp_path, capsys):
    with mock.patch("urllib.request.urlopen", side_effect=AssertionError("호출되면 안 됨")):
        code, out = run(tmp_path, capsys, env_key=None)
    assert code == 2
    assert "SEOUL_OPENAPI_KEY" in out and KEY not in out
    assert not list(tmp_path.iterdir())


def test_row_count_mismatch_fails(tmp_path, capsys):
    def drop(payload, start):
        if start == 1001:
            payload["tbTraficCrsng"]["row"].pop()
        return payload

    fake, _ = server(1500, mutate=drop)
    with mock.patch("urllib.request.urlopen", fake):
        code, out = run(tmp_path, capsys)
    assert code == 1 and "행 수" in out
    assert not (tmp_path / "oa21209_rows.csv.gz").exists()


def test_retry_then_success(tmp_path, capsys):
    fake, state = server(10, errors=3)
    waits = []
    with mock.patch("urllib.request.urlopen", fake):
        payload = fc.fetch_page(KEY, 1, 10, sleep=waits.append)
    assert payload["tbTraficCrsng"]["list_total_count"] == 10
    assert state["calls"] == 4 and waits == [2, 4, 8]


def test_retry_exhausted(tmp_path, capsys):
    fake, state = server(10, errors=99)
    with mock.patch("urllib.request.urlopen", fake):
        code, out = run(tmp_path, capsys)
    assert code == 1 and state["calls"] == 4 and KEY not in out


def test_error_code_response(tmp_path, capsys):
    def err(url, timeout=None):
        return Resp({"RESULT": {"CODE": "ERROR-300", "MESSAGE": f"필수 값이 누락 {KEY}"}})

    with mock.patch("urllib.request.urlopen", err):
        code, out = run(tmp_path, capsys)
    assert code == 1 and "ERROR-300" in out and KEY not in out


def test_no_data_code(tmp_path, capsys):
    def nodata(url, timeout=None):
        return Resp({"tbTraficCrsng": {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}})

    with mock.patch("urllib.request.urlopen", nodata):
        code, out = run(tmp_path, capsys)
    assert code == 1 and "INFO-200" in out


def test_key_never_in_output(tmp_path, capsys):
    """성공·네트워크 실패·HTTP 오류·잘못된 JSON 모두에서 출력 전체에 키가 없어야 한다."""
    class Bad(Resp):
        def read(self):
            return f"<html>{KEY}".encode()

    def http_err(url, timeout=None):
        raise urllib.error.HTTPError(url, 500, "boom " + url, None, None)

    cases = [server(1200)[0], server(10, errors=99)[0], http_err, lambda url, timeout=None: Bad({})]
    for fake in cases:
        with mock.patch("urllib.request.urlopen", fake):
            _, out = run(tmp_path, capsys)
        assert KEY not in out
        for p in tmp_path.iterdir():
            assert KEY not in p.name
            if p.suffix == ".json":
                assert KEY not in p.read_text("utf-8")


def test_wkt_parsing_defensive():
    assert fc.parse_wkt("POINT (127.1 37.5)") == [(127.1, 37.5)]
    assert fc.parse_wkt("LINESTRING(1 2, 3 4)") == [(1.0, 2.0), (3.0, 4.0)]
    assert fc.parse_wkt("MULTILINESTRING((1 2, 3 4),(5 6, 7 8))")[-1] == (7.0, 8.0)
    assert fc.parse_wkt("LINESTRING Z (1 2 3, 4 5 6)") == [(1.0, 2.0), (4.0, 5.0)]
    assert fc.parse_wkt("") is None and fc.parse_wkt(None) is None and fc.parse_wkt("POINT EMPTY") is None
    for bad in ("garbage", "POINT(abc)", "LINESTRING()"):
        with pytest.raises(ValueError):
            fc.parse_wkt(bad)


def test_summary_counts_bad_wkt_and_odd_lengths(tmp_path, capsys):
    rows = [row(1, wkt="garbage"), row(2, length="0"), row(3, length=""), row(4, length="abc"),
            row(5, kind="NODE", length="-1")]
    s = fc.summarize(rows, 5, fc.datetime.now(fc.timezone.utc))
    assert s["wkt_parse_failed"] == 1
    assert s["lnkg_len"]["zero_count"] == 1 and s["lnkg_len"]["negative_count"] == 1
    assert s["lnkg_len"]["missing_or_non_numeric"] == 2
    assert s["lnkg_len"]["min"] == -1.0  # 값은 고치지 않고 보고만 한다
    assert s["node_count"] == 1 and s["link_count"] == 4


def test_sample_mode(tmp_path, capsys):
    fake, state = server(31080)
    with mock.patch("urllib.request.urlopen", fake):
        code, out = run(tmp_path, capsys, env_key=None, args=["--sample"])
    assert code == 0 and state["calls"] == 1
    assert "/sample/json/tbTraficCrsng/1/5/" in state["urls"][0]
    s = json.loads((tmp_path / "oa21209_sample_summary.json").read_text("utf-8"))
    assert s["row_count"] == 5 and s["sample"] is True
