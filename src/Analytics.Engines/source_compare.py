"""Bounded, schema-driven SQL shared by the three real engines. No arbitrary SQL."""
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
import hashlib
import json
import time
from uuid import UUID
import pyarrow as pa
import pyarrow.parquet as pq


def quote(name, engine):
    mark = '`' if engine == 'spark' else '"'
    return mark + name.replace(mark, mark * 2) + mark


def literal(value, kind, engine):
    if value is None:
        raise ValueError('Use isNull/notNull for null values')
    if kind == 'number':
        if isinstance(value, bool): raise ValueError('Numeric value required')
        n = Decimal(str(value))
        if not n.is_finite(): raise ValueError('Finite numeric value required')
        return str(n)
    if kind == 'boolean':
        if not isinstance(value, bool): raise ValueError('Boolean value required')
        return 'TRUE' if value else 'FALSE'
    if not isinstance(value, str): raise ValueError('String value required')
    # Backslash escaping differs in Spark. Disallow it rather than silently changing semantics.
    if '\\' in value or '\x00' in value: raise ValueError('Backslash/NUL is not supported in comparison literals')
    if engine == "spark" and "'" in value:
        return "concat(" + ", chr(39), ".join("'" + part + "'" for part in value.split("'")) + ")"
    return "'" + value.replace("'", "''") + "'"


def build_sql(config, left, right, engine):
    if engine not in ('duckdb', 'spark', 'datafusion'): raise ValueError('Invalid engine')
    for schema in (left, right or []):
        names=[c['name'] for c in schema]
        if not names or len(names)>256 or len({n.lower() for n in names})!=len(names):
            if schema: raise ValueError('Invalid/duplicate columns')
    l={c['name']:c['type'] for c in left};r={c['name']:c['type'] for c in (right or [])}
    def col(name, schema=l):
        if name not in schema: raise ValueError('Unknown column: '+str(name))
        return quote(name,engine)
    op=config.get('operation');where=''
    rules=config.get('rules') or ([config['filter']] if config.get('filter') else [])
    clauses=[]
    for rule in rules:
        if not rule.get('column'):continue
        c=col(rule['column']);operator=rule.get('op');kind=l[rule['column']]
        if operator in ('isNull','notNull'):
            clauses.append(c+(' IS NULL' if operator=='isNull' else ' IS NOT NULL'))
        elif operator=='contains':
            if kind not in ('string','date'):raise ValueError('contains requires string column')
            clauses.append('contains('+c+', '+literal(rule.get('value'),kind,engine)+')')
        else:
            operators={'eq':'=','ne':'<>','gt':'>','gte':'>=','lt':'<','lte':'<='}
            if operator not in operators: raise ValueError('Invalid filter operator')
            clauses.append(c+' '+operators[operator]+' '+literal(rule.get('value'),kind,engine))
    if clauses:where=' WHERE '+' AND '.join(clauses)
    left_sql='(SELECT * FROM left_input'+where+')'
    if op=='filter':return 'SELECT * FROM '+left_sql+' l'
    if op=='aggregate':
        metric=config.get('metric');col(metric)
        if l[metric]!='number': raise ValueError('Aggregate metric must be numeric')
        group=config.get('group')
        select=(col(group)+' AS group_key, ') if group else ''
        return 'SELECT '+select+'COUNT(*) AS row_count, COUNT('+col(metric)+') AS value_count, SUM('+col(metric)+') AS total_value, AVG('+col(metric)+') AS avg_value FROM '+left_sql+' l'+(' GROUP BY '+col(group) if group else '')
    if op=='join':
        if not r:raise ValueError('Right source required')
        keys=config.get('keys',[])
        if not 1<=len(keys)<=8:raise ValueError('1..8 join keys required')
        join=config.get('joinType','left')
        if join not in ('inner','left','full'):raise ValueError('Invalid join type')
        conditions=[]
        for k in keys:
            lc=col(k['left']);rc=col(k['right'],r)
            if l[k['left']]!=r[k['right']]:raise ValueError('Join key type mismatch')
            conditions.append('l.'+lc+'=r.'+rc)
        aliases=list(l);select=['l.'+col(c) for c in l]
        for c in r:
            alias='right_'+c
            while alias.lower() in [a.lower() for a in aliases]:alias='right_'+alias
            aliases.append(alias);select.append('r.'+col(c,r)+' AS '+quote(alias,engine))
        return 'SELECT '+','.join(select)+' FROM '+left_sql+' l '+join.upper()+' JOIN right_input r ON '+' AND '.join(conditions)
    if op=='merge':
        if not r:raise ValueError('Right source required')
        names=list(l)+[n for n in r if n not in l]
        if len({n.lower() for n in names})!=len(names):raise ValueError('Ambiguous case-sensitive merge columns')
        for n in set(l)&set(r):
            if l[n]!=r[n]:raise ValueError('Merge type mismatch: '+n)
        def projection(schema):
            return ','.join(quote(n,engine) if n in schema else 'CAST(NULL AS '+({'number':'DECIMAL(38,10)','boolean':'BOOLEAN'}.get(l.get(n,r.get(n)),'STRING' if engine=='spark' else 'VARCHAR'))+') AS '+quote(n,engine) for n in names)
        return 'SELECT '+projection(l)+' FROM '+left_sql+' l UNION ALL SELECT '+projection(r)+' FROM right_input'
    raise ValueError('Invalid operation')


def table(snapshot):
    if len(snapshot['rows'])>10000:raise ValueError('Input exceeds 10,000 rows')
    fields=[]
    for c in snapshot['columns']:
        kind=c['type'];fields.append(pa.field(c['name'],{'number':pa.decimal128(38,10),'boolean':pa.bool_()}.get(kind,pa.string())))
    schema=pa.schema(fields);rows=[]
    for row in snapshot['rows']:
        result={}
        for c in snapshot['columns']:
            value=row.get(c['name'])
            if value is not None and c['type']=='number':
                value=Decimal(str(value))
                with localcontext() as ctx:
                    ctx.prec=50
                    if value.quantize(Decimal('0.0000000001'))!=value:raise ValueError('Numeric scale exceeds 10')
            result[c['name']]=value
        rows.append(result)
    return pa.Table.from_pylist(rows,schema=schema)


def fingerprint(rows, names):
    def normalize(v):
        if isinstance(v,(Decimal,float,int)) and not isinstance(v,bool):
            with localcontext() as ctx:
                ctx.prec=60
                value=Decimal(str(v)).quantize(Decimal('0.000001'),rounding=ROUND_HALF_EVEN)
                return {'number':format(value.copy_abs() if value==0 else value,'f')}
        return v
    ordered=sorted(names)
    encoded=sorted(json.dumps([normalize(row.get(n)) for n in ordered],ensure_ascii=False,separators=(',',':')) for row in rows)
    return hashlib.sha256(json.dumps([ordered,encoded],ensure_ascii=False).encode()).hexdigest()


def execute(payload, root, lock, get_spark, internal=False):
    engine=payload['engine'];config=payload['config'];left=payload['left'];right=payload.get('right')
    sql=build_sql(config,left['columns'],right['columns'] if right else None,engine)
    start=time.perf_counter()
    with lock:
        queued=(time.perf_counter()-start)*1000
        started=time.perf_counter();directory=root/'sources'/UUID(payload['comparisonId']).hex/engine;directory.mkdir(parents=True,exist_ok=True)
        for name,snapshot in [('left_input',left),('right_input',right)]:
            if snapshot is not None:pq.write_table(table(snapshot),directory/(name+'.parquet'))
        prepared=time.perf_counter();query='SELECT * FROM ('+sql+') bounded_result LIMIT 10001';details={}
        if engine=='duckdb':
            import duckdb
            with duckdb.connect() as db:
                db.execute("SET threads=2; SET memory_limit='512MB'; SET max_temp_directory_size='0B'")
                for name,snapshot in [('left_input',left),('right_input',right)]:
                    if snapshot is not None:db.read_parquet(str(directory/(name+'.parquet'))).create_view(name)
                frame=db.execute(query);names=[d[0] for d in frame.description];rows=[dict(zip(names,r)) for r in frame.fetchall()];details={'version':duckdb.__version__,'threads':2}
        elif engine=='datafusion':
            import datafusion
            from datafusion import SessionContext,SessionConfig,RuntimeEnvBuilder
            ctx=SessionContext(SessionConfig().with_target_partitions(2),RuntimeEnvBuilder().with_fair_spill_pool(512*1024**2).with_disk_manager_disabled())
            for name,snapshot in [('left_input',left),('right_input',right)]:
                if snapshot is not None:ctx.register_parquet(name,str(directory/(name+'.parquet')))
            frame=ctx.sql(query);names=frame.schema().names;rows=[row for batch in frame.collect() for row in batch.to_pylist()];details={'version':datafusion.__version__,'targetPartitions':2}
        else:
            startup=time.perf_counter();spark=get_spark();details={'version':spark.version,'sessionStartupMs':(time.perf_counter()-startup)*1000,'physicalHosts':1,'workersConfigured':2}
            for name,snapshot in [('left_input',left),('right_input',right)]:
                if snapshot is not None:spark.read.parquet(str(directory/(name+'.parquet'))).repartition(4).createOrReplaceTempView(name)
            frame=spark.sql(query);names=frame.columns;rows=[r.asDict() for r in frame.collect()]
        finished=time.perf_counter()
        if len(rows)>10000:raise ValueError('Output exceeds 10,000 rows. Narrow the join/filter.')
        checksum=fingerprint(rows,names)
        def safe(v):return float(v) if isinstance(v,Decimal) else v
        result = {'engine':engine,'rowCount':len(rows),'columns':names,'preview':[{k:safe(v) for k,v in r.items()} for r in rows[:20]],'resultHash':checksum,'inputHashes':[left['checksum']]+([right['checksum']] if right else []),'preparationMs':(prepared-started)*1000,'engineMs':(finished-prepared)*1000,'totalMs':(finished-started)*1000,'queueMs':queued,'details':details,'comparisonPrecision':6}

        if internal: result['_rows']=rows
        return result
