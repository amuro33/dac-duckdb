#!/usr/bin/env python3
"""Real four-engine equivalence and scale tests against the running application."""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
from datetime import datetime
from decimal import Decimal

BASE = os.environ.get("PORTAL_URL", "http://localhost:8082")
SIZES = [int(n) for n in os.environ.get("ENGINE_TEST_SIZES", "1000,10000,100000,1000000").split(",")]
ENGINES = ["duckdb", "spark", "datafusion", "drill"]
checks, measurements, datasets = [], [], []


def api(path, body=None, expected=200):
    req = urllib.request.Request(BASE + "/api/execute", data=json.dumps({"path": path, "method": "GET" if body is None else "POST", "body": body, "record": False}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=240) as response:
        result = json.load(response)
    assert result["status"] == expected, (path, result)
    return result["data"]


def wait_dataset(id):
    for _ in range(1200):
        detail = api("/api/streams/datasets/" + id)
        if detail["dataset"]["status"] == "failed":
            raise AssertionError(detail["result"][0]["error"])
        if detail["dataset"]["status"] == "ready":
            return detail
        time.sleep(1)
    raise AssertionError("Engine timed out: " + id)


def original(size, **options):
    feed = api("/api/streams/feeds", {"name": "Engine QA " + str(size), "sampleSize": size, "intervalSeconds": 60, "maxRuns": 1, "engine": "duckdb", **options}, 201)["id"]
    for _ in range(600):
        found = [d for d in api("/api/streams/datasets") if d["feedId"] == feed]
        if found:
            return wait_dataset(found[0]["id"])
        time.sleep(1)
    raise AssertionError("Publisher did not create dataset")


def normalize(row):
    result = {}
    for key, value in row.items():
        if key == "row_id":
            continue
        if isinstance(value, (int, float)):
            value = str(Decimal(str(value)).normalize())
        elif key == "inspected_at" and value is not None:
            value = datetime.fromisoformat(value.rstrip("Z")).isoformat(timespec="microseconds")
        result[key] = value
    return result


def verify_rows(id, size=None):
    cursor, total, digest_sum, digest_square = 0, None, 0, 0
    modulus = 2**256
    seen = bytearray(size + 1) if size else None
    while True:
        page = api(f"/api/streams/datasets/{id}/rows?afterId={cursor}&limit=10000")
        total = page["totalRows"] if total is None else total
        assert total == page["totalRows"] and page["sampling"] == "none"
        for row in page["data"]:
            cursor += 1
            assert row["row_id"] == cursor, (id, cursor, row["row_id"])
            value = int.from_bytes(hashlib.sha256(json.dumps(normalize(row), sort_keys=True, separators=(",", ":")).encode()).digest(), "big")
            digest_sum = (digest_sum + value) % modulus
            digest_square = (digest_square + value * value) % modulus
            if seen is not None:
                n = int(row["wafer_id"][1:])
                assert 1 <= n <= size and not seen[n]
                seen[n] = 1
                assert row["defect_id"] == "B" + str(n)
        if not page["hasMore"]:
            break
        assert page["data"], "Non-advancing result page"
    assert cursor == total
    if seen is not None:
        assert cursor == size and sum(seen) == size
    return cursor, hex(digest_sum), hex(digest_square)


def compare(source, label, size=None):
    baseline = None
    source_id = source["dataset"]["id"]
    for engine in ENGINES:
        detail = source if engine == "duckdb" else wait_dataset(api(f"/api/streams/datasets/{source_id}/analyze", {"engine": engine}, 202)["id"])
        id = detail["dataset"]["id"]
        fingerprint = verify_rows(id, size)
        if baseline is None:
            baseline = fingerprint
        assert fingerprint == baseline, (label, engine, fingerprint, baseline)
        execution = detail["result"][0]["execution"]
        assert execution["engine"] == engine
        if engine != "duckdb":
            assert detail["dataset"]["inputDatasetId"] == source_id
        if engine == "spark":
            info = execution["details"]
            assert info["cluster"]["workerCount"] == 2
            assert len(info["executors"]) == 2 and all(e["completedTasks"] > 0 for e in info["executors"]), info
        result = {"case": label, "engine": engine, "datasetId": id, "sourceDatasetId": source_id, "rows": fingerprint[0],
                  "preparationMs": execution["preparationMs"], "engineMs": execution["engineMs"], "totalMs": execution["totalMs"], "files": execution["resultFiles"]}
        if engine == "spark":
            result.update(coldStart=execution["details"]["coldStart"], workers=execution["details"]["executors"])
        measurements.append(result)
        datasets.append(id)
        print(json.dumps(result), flush=True)
    checks.append(label + ": four engines preserve every row and produce identical logical values")


status = api("/api/streams/engines")
assert status["duckdb"]["available"] and all(status["remote"][e]["available"] for e in ENGINES[1:]), status
checks.append("All four real execution engines available; Spark has two distinct worker executors")
for size in SIZES:
    compare(original(size), str(size) + " pairs", size)

if os.environ.get("ENGINE_SCALE_ONLY") != "1":
    for operation in ["join", "merge", "filter"]:
        options = {"operation": operation, "joinType": "full"}
        if operation == "filter":
            options.update(minYield=94, severity="HIGH")
        compare(original(None, **options), "Base " + operation)
    compare(original(1000, lotId="QA-NO-MATCH"), "Empty inputs")
    api("/api/streams/feeds", {"name": "invalid engine", "engine": "unknown"}, 400)
    api(f"/api/streams/datasets/{datasets[0]}/analyze", {"engine": "spark; drop table"}, 400)
    checks.append("Invalid engine requests are rejected instead of falling back")
    for record in [r for r in measurements if r["case"] == str(SIZES[0]) + " pairs"]:
        spec = api("/api/chart/scatter", {"source": "transformed", "datasetId": record["datasetId"], "category": "lot_id", "legend": "product", "x": "inspected_at", "y": "yield_pct", "xType": "date"})
        assert spec["sourceRows"] == spec["plottedRows"] == SIZES[0]
        assert sum(len(s["points"]) for c in spec["charts"] for s in c["series"]) == SIZES[0]
    checks.append("All four engine outputs reach the chart with complete point counts")

report = {"passed": len(checks), "checks": checks, "environment": status, "measurements": measurements}
Path("artifacts/engines-integration.json").write_text(json.dumps(report, indent=2))
print("PASS:", len(checks), "engine integration checks", flush=True)
