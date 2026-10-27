from jjukgo.targets import load_targets, load_targets_csv, round_robin

BBOX = [127.020, 37.493, 127.055, 37.512]


def test_csv_bbox_filter_and_column_detection(tmp_path):
    path = tmp_path / "itst.csv"
    path.write_text(
        "교차로ID,교차로명,위도,경도\n"
        "1537,역삼역,37.5006,127.0364\n"
        "9999,광화문,37.5709,126.9768\n"
        "1600,선릉역,37.5045,127.0490\n",
        encoding="utf-8",
    )
    assert load_targets_csv(path, BBOX) == ["1537", "1600"]


def test_csv_cp949(tmp_path):
    path = tmp_path / "itst.csv"
    path.write_bytes("itstId,lat,lot\n1537,37.5006,127.0364\n".encode("cp949"))
    assert load_targets_csv(path, BBOX) == ["1537"]


def test_explicit_ids_win(tmp_path):
    assert load_targets({"itst_ids": [1, 2]}, tmp_path) == ["1", "2"]


def test_missing_csv_gives_empty(tmp_path):
    assert load_targets({"itst_ids": [], "targets_csv": "nope.csv"}, tmp_path) == []


def test_round_robin_wraps():
    targets = ["a", "b", "c"]
    picked, cursor = round_robin(targets, 2, 2)
    assert picked == ["c", "a"] and cursor == 1
    picked, cursor = round_robin(targets, cursor, 10)
    assert picked == ["b", "c", "a"] and cursor == 1
    assert round_robin(targets, 0, 0) == ([], 0)
