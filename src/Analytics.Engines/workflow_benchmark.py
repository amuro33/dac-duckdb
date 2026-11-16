"""Replay a captured workflow graph using one chosen engine for every transform.
Query nodes are frozen once by the normal workflow runner, including API chains.
"""
from copy import deepcopy
from uuid import UUID, uuid5
import json
from source_compare import execute as execute_node, fingerprint


def ordered(definition):
    nodes=definition['nodes'];edges=definition['edges'];done=[]
    if not 1<=len(nodes)<=30 or len({n['id'] for n in nodes})!=len(nodes):raise ValueError('Invalid workflow nodes')
    if sum(n['kind']=='output' for n in nodes)!=1:raise ValueError('Exactly one Output required')
    if any(e['source'] not in {n['id'] for n in nodes} or e['target'] not in {n['id'] for n in nodes} for e in edges):raise ValueError('Unknown edge node')
    while len(done)<len(nodes):
        node=next((n for n in nodes if n not in done and all(any(x['id']==e['source'] for x in done) for e in edges if e['target']==n['id'])),None)
        if node is None:raise ValueError('Workflow cycle')
        done.append(node)
    return done


def output_columns(kind,left,right):
    columns=deepcopy(left['columns'])
    if kind=='join':
        for c in right['columns']:
            name='right_'+c['name']
            while name.lower() in [x['name'].lower() for x in columns]:name='right_'+name
            columns.append({'name':name,'type':c['type']})
    elif kind=='merge':
        for c in right['columns']:
            if c['name'] not in [x['name'] for x in columns]:columns.append(deepcopy(c))
    return columns


def execute(payload,root,lock,get_spark):
    plan=payload['workflow'];definition=plan['definition'];engine=payload['engine']
    outputs={};measurements=[];hashes=[];preparation=execution=queue=0;last=None
    transforms=0
    for node in ordered(definition):
        nid=node['id'];kind=node['kind']
        try:
            if kind=='query':
                snapshot=deepcopy(plan['queries'][nid])
                snapshot['checksum']=fingerprint(snapshot['rows'],[c['name'] for c in snapshot['columns']])
                outputs[nid]=snapshot
                hashes.append(fingerprint(snapshot['rows'],[c['name'] for c in snapshot['columns']]))
                measurements.append({'nodeId':nid,'kind':kind,'rowCount':len(snapshot['rows']),'state':'captured','totalMs':0})
                continue
            def parent(port):
                matches=[e for e in definition['edges'] if e['target']==nid and e['port']==port]
                if len(matches)!=1:raise ValueError('Missing/duplicate input port: '+port)
                return outputs[matches[0]['source']]
            left=parent('left' if kind in ('join','merge') else 'input')
            right=parent('right') if kind in ('join','merge') else None
            if kind=='output' and transforms:
                outputs[nid]=left
                measurements.append({'nodeId':nid,'kind':kind,'rowCount':len(left['rows']),'state':'forwarded','totalMs':0})
                continue
            if kind not in ('join','merge','filter','output'):raise ValueError('Unsupported workflow node')
            config={**node['config'],'operation':'filter' if kind=='output' else kind}
            # Each node is executed against this engine's preceding result, never the baseline transform output.
            result=execute_node({'comparisonId':str(uuid5(UUID(payload['comparisonId']),nid)), 'engine':engine,'config':config,'left':left,'right':right},root,lock,get_spark,internal=True)
            rows=result.pop('_rows');columns=output_columns(kind,left,right)
            if len(json.dumps(rows,default=str).encode())>8_000_000:raise ValueError('Node output exceeds 8MB')
            outputs[nid]={'rows':rows,'columns':columns,'checksum':result['resultHash']}
            measurements.append({'nodeId':nid,'kind':kind,'state':'succeeded',**{k:result[k] for k in ('rowCount','preparationMs','engineMs','totalMs','resultHash')}})
            preparation+=result['preparationMs'];execution+=result['engineMs'];queue+=result['queueMs'];last=result;transforms+=1
        except Exception as e:raise ValueError(nid+': '+str(e)) from e
    output=outputs[next(n['id'] for n in definition['nodes'] if n['kind']=='output')]
    names=[c['name'] for c in output['columns']];digest=fingerprint(output['rows'],names)
    baseline=plan['baseline'];baseline_hash=fingerprint(baseline['rows'],[c['name'] for c in baseline['columns']])
    return {**last,'engine':engine,'rowCount':len(output['rows']),'columns':names,'preview':output['rows'][:20],
            'resultHash':digest,'inputHashes':hashes,'preparationMs':preparation,'engineMs':execution,'totalMs':preparation+execution,'queueMs':queue,
            'nodes':measurements,'baselineHash':baseline_hash,'matchesBaseline':digest==baseline_hash,
            'scope':'captured-query graph replay; API and baseline execution excluded; per-node materialization included'}
