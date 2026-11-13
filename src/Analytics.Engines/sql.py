"""A closed transform contract, not an arbitrary-SQL execution endpoint."""
from decimal import Decimal

ENGINES = ("spark", "datafusion", "drill")


def validate(config):
    if config.get("engine") not in ENGINES:
        raise ValueError("Unsupported engine")
    if config.get("operation", "join") not in ("join", "merge", "filter"):
        raise ValueError("Unsupported operation")
    if config.get("joinType", "left") not in ("inner", "left", "full"):
        raise ValueError("Unsupported join type")
    severity = config.get("severity")
    if severity is not None and severity not in ("LOW", "MEDIUM", "HIGH", "CRITICAL"):
        raise ValueError("Invalid severity")
    minimum = config.get("minYield")
    if minimum is not None and (not Decimal(str(minimum)).is_finite() or not 0 <= Decimal(str(minimum)) <= 100):
        raise ValueError("minYield must be 0..100")


def transform_sql(config, eds="eds", defects="defects"):
    validate(config)
    # Explicit NULL types preserve the union schema across all engines, including empty inputs.
    if config.get("operation", "join") == "merge":
        source = f"""SELECT 'eds' AS source_type, lot_id, wafer_id, product, yield_pct,
          CAST(NULL AS VARCHAR) AS defect_id, CAST(NULL AS VARCHAR) AS defect_type,
          CAST(NULL AS VARCHAR) AS severity, CAST(NULL AS INTEGER) AS defect_count, inspected_at FROM {eds}
          UNION ALL SELECT 'defect', lot_id, wafer_id, CAST(NULL AS VARCHAR), CAST(NULL AS DOUBLE),
          defect_id, defect_type, severity, defect_count, inspected_at FROM {defects}"""
    else:
        join = config.get("joinType", "left").upper()
        source = f"""SELECT coalesce(e.lot_id,d.lot_id) AS lot_id, coalesce(e.wafer_id,d.wafer_id) AS wafer_id,
          e.product, e.yield_pct, d.defect_id, d.defect_type, d.severity, d.defect_count,
          coalesce(e.inspected_at,d.inspected_at) AS inspected_at
          FROM {eds} e {join} JOIN {defects} d ON e.lot_id=d.lot_id AND e.wafer_id=d.wafer_id"""
    filters = []
    if config.get("minYield") is not None:
        filters.append("yield_pct >= " + str(Decimal(str(config["minYield"]))))
    if config.get("severity") is not None:
        filters.append("severity = '" + config["severity"] + "'")
    query = f"SELECT * FROM ({source}) transformed" + (" WHERE " + " AND ".join(filters) if filters else "")
    return query.replace("AS VARCHAR", "AS STRING") if config["engine"] == "spark" else query
