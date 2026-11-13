import unittest
from sql import transform_sql, validate, ENGINES


class Contracts(unittest.TestCase):
    def test_each_engine_joins_composite_key(self):
        for engine in ENGINES:
            sql = transform_sql({"engine": engine})
            self.assertIn("e.lot_id=d.lot_id AND e.wafer_id=d.wafer_id", sql)
            self.assertNotIn("LIMIT", sql)

    def test_merge_preserves_duplicates(self):
        for engine in ENGINES:
            self.assertIn("UNION ALL", transform_sql({"engine": engine, "operation": "merge"}))

    def test_filters_keep_numeric_zero(self):
        sql = transform_sql({"engine": "spark", "operation": "filter", "minYield": 0, "severity": "HIGH"})
        self.assertIn("yield_pct >= 0 AND severity = 'HIGH'", sql)

    def test_sql_injection_and_unknown_engine_rejected(self):
        for field, value in [("engine", "unknown"), ("operation", "drop table"), ("joinType", "left;--"), ("severity", "HIGH' OR 1=1"), ("minYield", "NaN")]:
            with self.assertRaises(ValueError):
                validate({"engine": "spark", field: value})

    def test_typed_nulls(self):
        self.assertIn("CAST(NULL AS STRING)", transform_sql({"engine": "spark", "operation": "merge"}))
        self.assertIn("CAST(NULL AS VARCHAR)", transform_sql({"engine": "drill", "operation": "merge"}))


if __name__ == "__main__":
    unittest.main()
