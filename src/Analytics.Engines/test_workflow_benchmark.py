import unittest,tempfile,threading
from pathlib import Path
from uuid import uuid4
from workflow_benchmark import execute,ordered,output_columns

class WorkflowBenchmarkTests(unittest.TestCase):
    def test_cycle_rejected(self):
        with self.assertRaises(ValueError):ordered({'nodes':[{'id':'a','kind':'filter'},{'id':'out','kind':'output'}],'edges':[{'source':'a','target':'out','port':'input'},{'source':'out','target':'a','port':'input'}]})
    def test_replays_downstream_from_engine_result(self):
        columns=[{'name':'name','type':'string'},{'name':'value','type':'number'}]
        rows=[{'name':"O'Brien",'value':1},{'name':'Other','value':2},{'name':"O'Brien",'value':3}]
        nodes=[{'id':'q','kind':'query','config':{}},{'id':'f','kind':'filter','config':{'rules':[{'column':'name','op':'contains','value':"'"},{'column':'value','op':'gt','value':1}]}},{'id':'m','kind':'merge','config':{}},{'id':'out','kind':'output','config':{}}]
        edges=[{'source':'q','target':'f','port':'input'},{'source':'f','target':'m','port':'left'},{'source':'f','target':'m','port':'right'},{'source':'m','target':'out','port':'input'}]
        plan={'definition':{'nodes':list(reversed(nodes)),'edges':edges},'queries':{'q':{'columns':columns,'rows':rows}},'baseline':{'columns':columns,'rows':[rows[2],rows[2]]}}
        with tempfile.TemporaryDirectory() as directory:r=execute({'comparisonId':str(uuid4()),'engine':'duckdb','workflow':plan},Path(directory),threading.Lock(),lambda:None)
        self.assertTrue(r['matchesBaseline']);self.assertEqual(r['rowCount'],2)
        self.assertEqual([n['rowCount'] for n in r['nodes']],[3,1,2,2]);self.assertGreater(r['engineMs'],0)
    def test_join_alias_collision_retains_types(self):
        a={'columns':[{'name':'right_x','type':'number'}]};b={'columns':[{'name':'x','type':'date'}]}
        self.assertEqual(output_columns('join',a,b)[1],{'name':'right_right_x','type':'date'})
    def test_query_only_still_executes_scan(self):
        snapshot={'columns':[{'name':'v','type':'number'}],'rows':[]}
        plan={'definition':{'nodes':[{'id':'q','kind':'query','config':{}},{'id':'out','kind':'output','config':{}}],'edges':[{'source':'q','target':'out','port':'input'}]},'queries':{'q':snapshot},'baseline':snapshot}
        with tempfile.TemporaryDirectory() as directory:r=execute({'comparisonId':str(uuid4()),'engine':'duckdb','workflow':plan},Path(directory),threading.Lock(),lambda:None)
        self.assertEqual(r['rowCount'],0);self.assertTrue(r['matchesBaseline']);self.assertEqual(r['nodes'][-1]['state'],'succeeded')
if __name__=='__main__':unittest.main()
