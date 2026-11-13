"""Real Spark, DataFusion and Drill execution with immutable Parquet artifacts.

Only validated transform contracts and UUID-scoped files are accepted. The service
is internal; the .NET orchestrator owns durable job status and retry scheduling.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
import urllib.request
from uuid import UUID

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from sql import ENGINES, transform_sql, validate

ROOT = Path(os.environ.get("ENGINE_ROOT", "/engine-data"))
os.umask(0)  # Dedicated internal volume shared by Spark's and Drill's non-root UIDs.
SPARK_MASTER = os.environ.get("SPARK_MASTER_URL", "spark://spark-master:7077")
SPARK_WEB = os.environ.get("SPARK_MASTER_WEB", "http://spark-master:8080")
DRILL = os.environ.get("DRILL_URL", "http://drill:8047")
app = FastAPI(docs_url=None, redoc_url=None)
execution_lock = threading.Lock()
spark_session = None


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def job_dir(job_id):
    try:
        key = UUID(job_id).hex
    except ValueError:
        raise HTTPException(400, "Invalid job id")
    path = ROOT / "jobs" / key
    path.mkdir(parents=True, exist_ok=True)
    return path


def http_json(url, body=None, timeout=10):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def spark_status():
    try:
        value = http_json(SPARK_WEB + "/json/", timeout=2)
        workers = [{"id": w["id"], "host": w["host"], "cores": w["cores"], "state": w["state"]}
                   for w in value.get("workers", []) if w.get("state") == "ALIVE"]
        return {"available": bool(workers), "workers": workers, "workerCount": len(workers),
                "deployment": os.environ.get("SPARK_DEPLOYMENT", "colocated-containers"),
                "physicalHosts": int(os.environ.get("SPARK_PHYSICAL_HOSTS", "1"))}
    except Exception as e:
        return {"available": False, "workers": [], "workerCount": 0, "error": str(e)[:200]}


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/engines")
def engines():
    import datafusion
    try:
        drill_ok = http_json(DRILL + "/query.json", {"queryType": "SQL", "query": "SELECT 1 AS ready", "autoLimit": 1}, 3).get("queryState") == "COMPLETED"
    except Exception:
        drill_ok = False
    return {"spark": {"version": "4.2.1", **spark_status()},
            "datafusion": {"available": True, "version": datafusion.__version__, "mode": "single-process / Arrow"},
            "drill": {"available": drill_ok, "version": "1.22.0", "mode": "single Drillbit"}}


@app.put("/jobs/{job_id}/inputs/{source}")
async def upload(job_id: str, source: str, request: Request):
    if source not in ("eds", "defects"):
        raise HTTPException(400, "Invalid input")
    directory = job_dir(job_id)
    # A distinct temporary file prevents concurrent requests from truncating each other.
    import uuid
    temporary = directory / (source + "." + uuid.uuid4().hex + ".upload")
    size = 0
    digest = hashlib.sha256()
    try:
        with temporary.open("wb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > 4 * 1024**3:
                    raise HTTPException(413, "Input exceeds 4 GiB upload limit")
                digest.update(chunk)
                output.write(chunk)
        pq.read_metadata(temporary)  # Reject incomplete or invalid Parquet before publication.
        expected = request.headers.get("x-content-sha256")
        if expected != digest.hexdigest():
            raise HTTPException(400, "Input checksum mismatch")
        target = directory / (source + ".parquet")
        with execution_lock:
            if target.exists():
                if file_sha256(target) != expected:
                    raise HTTPException(409, "Immutable input already exists with different content")
            else:
                temporary.replace(target)
        return {"bytes": size, "sha256": digest.hexdigest()}
    finally:
        temporary.unlink(missing_ok=True)


def get_spark():
    global spark_session
    if spark_session is None:
        from pyspark.sql import SparkSession
        spark_session = (SparkSession.builder.appName("WaferScope analytics")
            .master(SPARK_MASTER)
            .config("spark.driver.host", os.environ.get("SPARK_DRIVER_HOST", "analytics-engines"))
            .config("spark.driver.bindAddress", "0.0.0.0")
            .config("spark.driver.port", "39001")
            .config("spark.blockManager.port", "39002")
            .config("spark.executor.memory", "1536m")
            .config("spark.executor.cores", "1")
            .config("spark.cores.max", "2")
            .config("spark.sql.shuffle.partitions", "8")
            .config("spark.sql.files.maxPartitionBytes", str(2 * 1024**2))
            .config("spark.sql.adaptive.enabled", "true")
            .config("spark.sql.session.timeZone", "UTC")
            .config("spark.sql.parquet.outputTimestampType", "TIMESTAMP_MICROS")
            .config("spark.eventLog.enabled", "true")
            .config("spark.eventLog.dir", str(ROOT / "spark-events"))
            .getOrCreate())
        spark_session.sparkContext.setLogLevel("WARN")
    return spark_session


def run_spark(directory, config, output):
    (ROOT / "spark-events").mkdir(exist_ok=True)
    cold_start = spark_session is None
    startup = time.perf_counter()
    spark = get_spark()
    startup_ms = (time.perf_counter() - startup) * 1000
    # Repartition both inputs so even small comparison jobs exercise both worker executors.
    for source in ("eds", "defects"):
        spark.read.parquet(str(directory / (source + ".parquet"))).repartition(4).createOrReplaceTempView(source)
    frame = spark.sql(transform_sql(config))
    plan = frame._jdf.queryExecution().toString()
    frame.write.mode("error").option("compression", "zstd").parquet(str(output))
    sc = spark.sparkContext
    try:
        executors = http_json(sc.uiWebUrl + "/api/v1/applications/" + sc.applicationId + "/executors")
        executors = [{"id": e["id"], "hostPort": e["hostPort"], "completedTasks": e["completedTasks"],
                      "totalCores": e["totalCores"], "isActive": e["isActive"]} for e in executors if e["id"] != "driver"]
    except Exception:
        executors = []
    return {"applicationId": sc.applicationId, "executors": executors, "cluster": spark_status(), "coldStart": cold_start, "sessionStartupMs": startup_ms, "plan": plan[:24000]}


def run_datafusion(directory, config, output):
    from datafusion import SessionContext, SessionConfig, RuntimeEnvBuilder
    runtime = RuntimeEnvBuilder().with_fair_spill_pool(1024**3).with_disk_manager_os()
    ctx = SessionContext(SessionConfig().with_target_partitions(2), runtime)
    for source in ("eds", "defects"):
        ctx.register_parquet(source, str(directory / (source + ".parquet")))
    frame = ctx.sql(transform_sql(config))
    plan = str(frame.execution_plan())
    frame.write_parquet(str(output))
    return {"targetPartitions": 2, "plan": plan[:24000]}


def run_drill(directory, config, output):
    # The workspace is restricted to the shared artifact volume, never the host root.
    plugin = {"name": "waferscope", "config": {"type": "file", "connection": "file:///",
        "workspaces": {"root": {"location": str(ROOT), "writable": True, "defaultInputFormat": "parquet"}},
        "formats": {"parquet": {"type": "parquet"}}, "enabled": True}}
    http_json(DRILL + "/storage/waferscope.json", plugin)
    relative = directory.relative_to(ROOT).as_posix()
    eds = f"waferscope.root.`{relative}/eds.parquet`"
    defects = f"waferscope.root.`{relative}/defects.parquet`"
    query = f"CREATE TABLE waferscope.root.`{relative}/result` AS " + transform_sql(config, eds, defects)
    result = http_json(DRILL + "/query.json", {"queryType": "SQL", "query": query, "autoLimit": 0}, 1200)
    if result.get("queryState") != "COMPLETED":
        raise RuntimeError("Drill query failed: " + json.dumps(result)[:2000])
    return {"queryId": result.get("queryId"), "queryState": result.get("queryState"), "sql": query}


def empty_schema(merge=False):
    fields = [("lot_id", pa.string()), ("wafer_id", pa.string()), ("product", pa.string()),
              ("yield_pct", pa.float64()), ("defect_id", pa.string()), ("defect_type", pa.string()),
              ("severity", pa.string()), ("defect_count", pa.int32()), ("inspected_at", pa.timestamp("us"))]
    return pa.schema(([("source_type", pa.string())] if merge else []) + fields)


def execute(job_id, config):
    validate(config)
    directory = job_dir(job_id)
    signature = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    with execution_lock:
        saved = directory / "manifest.json"
        if saved.exists():
            manifest = json.loads(saved.read_text())
            if manifest["signature"] != signature:
                raise HTTPException(409, "Job already completed with another request")
            return manifest
        for source in ("eds", "defects"):
            if not (directory / (source + ".parquet")).is_file():
                raise HTTPException(409, "Both durable inputs are required")
        output = directory / "result"
        if output.exists():
            shutil.rmtree(output)
        started = time.perf_counter()
        details = {"spark": run_spark, "datafusion": run_datafusion, "drill": run_drill}[config["engine"]](directory, config, output)
        engine_ms = (time.perf_counter() - started) * 1000
        paths = sorted(output.rglob("*.parquet")) if output.exists() else []
        if not paths:
            # An engine can produce no part files for a valid empty result. Preserve its typed schema.
            output.mkdir(exist_ok=True)
            pq.write_table(pa.Table.from_batches([], schema=empty_schema(config.get("operation") == "merge")), output / "empty.parquet")
            paths = [output / "empty.parquet"]
        files = []
        offset = 0
        for path in paths:
            rows = pq.read_metadata(path).num_rows
            digest = file_sha256(path)
            files.append({"name": path.relative_to(output).as_posix(), "rows": rows, "offset": offset,
                          "bytes": path.stat().st_size, "sha256": digest})
            offset += rows
        manifest = {"schemaVersion": 1, "engine": config["engine"], "signature": signature,
                    "rowCount": offset, "engineMs": engine_ms, "files": files, "details": details}
        temporary = directory / "manifest.tmp"
        temporary.write_text(json.dumps(manifest))
        temporary.replace(saved)
        return manifest


@app.post("/jobs/{job_id}/execute")
async def run(job_id: str, request: Request):
    try:
        config = await request.json()
        return await run_in_threadpool(execute, job_id, config)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        # Surface a bounded diagnostic to the durable job record; never substitute another engine.
        raise HTTPException(502, type(e).__name__ + ": " + str(e)[:1500])


@app.get("/jobs/{job_id}/files/{index}")
def download(job_id: str, index: int):
    directory = job_dir(job_id)
    saved = directory / "manifest.json"
    if not saved.exists():
        raise HTTPException(404, "Result not ready")
    files = json.loads(saved.read_text())["files"]
    if index < 0 or index >= len(files):
        raise HTTPException(404, "Unknown part")
    return FileResponse(directory / "result" / files[index]["name"], media_type="application/octet-stream")
