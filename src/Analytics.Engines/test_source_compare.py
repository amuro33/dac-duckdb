import unittest
from decimal import Decimal
from source_compare import build_sql,table,fingerprint
class SourceCompareTests(unittest.TestCase):
    schema=[{'name':'lot_id','type':'string'},{'name':'value','type':'number'}]
    def test_identifier_and_literal_are_closed(self):
        sql=build_sql({'operation':'filter','filter':{'column':'lot_id','op':'eq','value':"' OR 1=1 --"}},self.schema,None,'duckdb')
        self.assertIn("''' OR 1=1 --'",sql)
        with self.assertRaises(ValueError):build_sql({'operation':'aggregate','metric':'missing'},self.schema,None,'spark')
    def test_join_validates_keys_and_types(self):
        with self.assertRaises(ValueError):build_sql({'operation':'join','keys':[{'left':'value','right':'lot_id'}]},self.schema,self.schema,'datafusion')
        self.assertIn('right_value',build_sql({'operation':'join','keys':[{'left':'lot_id','right':'lot_id'}]},self.schema,self.schema,'spark'))
    def test_merge_schema_alignment(self):
        right=[{'name':'other','type':'string'}]
        self.assertIn('CAST(NULL AS DECIMAL(38,10))',build_sql({'operation':'merge'},self.schema,right,'duckdb'))
    def test_empty_schema_retained(self):
        t=table({'columns':self.schema,'rows':[]});self.assertEqual(t.num_columns,2);self.assertEqual(t.num_rows,0)
    def test_precision_not_silently_truncated(self):
        with self.assertRaises(ValueError):table({'columns':self.schema,'rows':[{'value':Decimal('1.12345678901')}]})
    def test_fingerprint_preserves_duplicates_and_ignores_order(self):
        a=[{'x':Decimal('1.0'),'y':None},{'x':2,'y':'hi'}];b=list(reversed(a))
        self.assertEqual(fingerprint(a,['x','y']),fingerprint(b,['y','x']))
        self.assertNotEqual(fingerprint(a,['x','y']),fingerprint(a+a,['x','y']))
    def test_numeric_tolerance(self):
        self.assertEqual(fingerprint([{'v':1.1234561}],['v']),fingerprint([{'v':Decimal('1.1234562')}],['v']))
    def test_spark_apostrophe_uses_explicit_character(self):
        sql=build_sql({'operation':'filter','filter':{'column':'lot_id','op':'eq','value':"O'Brien"}},self.schema,None,'spark')
        self.assertIn("concat('O', chr(39), 'Brien')",sql)
    def test_null_filter_requires_no_value(self):
        sql=build_sql({'operation':'filter','filter':{'column':'value','op':'isNull'}},self.schema,None,'duckdb')
        self.assertIn('"value" IS NULL',sql)
    def test_backslash_rejected(self):
        with self.assertRaises(ValueError):build_sql({'operation':'filter','filter':{'column':'lot_id','op':'eq','value':'a\\b'}},self.schema,None,'spark')
if __name__=='__main__':unittest.main()
