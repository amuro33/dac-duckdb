# API 사용 가이드

Kafka 발행/상태/저장 결과 API와 `source=transformed` 계약은 [streaming.md](streaming.md)를 참고하세요. 기존 `/api/dac/transform`은 별도 변환 서비스로 전달하는 호환 경로입니다.

통합 UI는 `http://localhost:8082`의 BFF만 호출합니다. DAC 직접 API는 `8080`, Chart 직접 API는 `8081` 진단 주소에서 사용할 수 있습니다. 각 경로는 현재 로컬 개발 환경 기준이며 사용자 인증은 구현하지 않았습니다.

## 1. BFF 실행 계약

```bash
curl -sS http://localhost:8082/api/execute \
  -H 'Content-Type: application/json' \
  -d '{"path":"/api/dac/get_eds_data?lotId=LOT-101&limit=100","method":"GET","record":true}'
```

응답 구조:

```json
{
  "runId": "실행 UUID",
  "status": 200,
  "durationMs": 12.3,
  "rowCount": 100,
  "data": []
}
```

위 값은 구조를 설명하기 위한 예시입니다. `data`에는 실제 원본 배열 또는 차트/변환 객체가 들어갑니다. BFF가 정상적으로 실행 결과를 전달했을 때 HTTP 200 안의 **`status`는 upstream 상태**입니다. 클라이언트는 HTTP 상태뿐 아니라 이 값도 확인해야 합니다. 입력/동시성 제한 등 BFF 자체 오류는 HTTP 오류로 반환됩니다. `record=false`는 폴링용으로 이력을 남기지 않습니다.

## 2. 데이터 API

| 메서드 / 경로 | 입력 | 응답 |
| --- | --- | --- |
| GET `/api/dac/get_eds_data` | `lotId`, `waferId`, `limit` | EDS 배열 |
| GET `/api/dac/get_defect_data` | 동일 | 결함 배열 |
| GET `/api/dac/lots` | 없음 | Lot 목록 |
| GET `/api/dac/summary` | 없음 | 데이터 요약 |
| GET `/api/dac/chart_samples` | `source`, `size`, `lotId`, `limit`, `afterId` | 전체/페이지 데이터와 완전성 메타데이터 |
| POST `/api/dac/transform` | 아래 변환 본문 | DuckDB 변환 결과 |

기본 EDS/결함 `limit`는 기본 100, 범위 1~1000입니다. benchmark `size`는 1000/10000/100000/1000000이며, 명시적 `limit`가 없으면 선택 범위 전체를 반환합니다. `afterId`는 이전 페이지의 마지막 ID로, `hasMore=true`인 동안 이어서 조회합니다.

```bash
curl -sS 'http://localhost:8080/api/dac/chart_samples?source=eds&size=10000&limit=1000&afterId=0'
```

`totalRows`는 조건에 맞는 전체 건수, `returnedRows`는 이번 응답 건수입니다. 페이지는 샘플이 아니며 `sampling`은 `none`입니다. benchmark `source=joined`는 합성 필드 투영입니다.

## 3. DuckDB join / merge / filter

```bash
curl -sS http://localhost:8080/api/dac/transform \
  -H 'Content-Type: application/json' \
  -d '{"operation":"filter","joinType":"left","lotId":"LOT-101","minYield":94,"severity":"HIGH","limit":100}'
```

| 필드 | 값 / 동작 |
| --- | --- |
| `operation` | `join`, `merge`, `filter` |
| `joinType` | `inner`, `left`, `full` |
| `lotId` | 원본 API에 적용하는 Lot 조건; null은 전체 기본 데이터 |
| `minYield` | 0~100, 이상(>=) 조건 |
| `severity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` 또는 null |
| `limit` | 최종 결과 1~1000행 |

조인 키는 Lot+Wafer이며 1:N 관계는 N행을 만듭니다. `merge`는 `UNION ALL`이고 중복 제거/upsert가 아닙니다. 필터는 AND로 적용하며 NULL은 지정된 조건을 만족하지 않습니다. transform은 원본 API 두 개를 읽어 요청별 DuckDB 메모리 테이블에 적재합니다. 원본이 1000행 경계에 도달하면 422로 거부합니다. 결과 `limit`를 늘려도 원본 snapshot 경계가 사라지지 않습니다.

임의 SQL, 파일 경로, 사용자 지정 upstream URL은 받지 않습니다. 워크플로우 오케스트레이션은 구현되지 않았습니다.

## 4. Scatter 요청

```bash
curl -sS http://localhost:8081/api/chart/scatter \
  -H 'Content-Type: application/json' \
  -d @examples/chart-request.json
```

```json
{
  "source": "eds",
  "category": "lotId",
  "legend": "product",
  "x": "inspectedAt",
  "y": "yieldPct",
  "xType": "date",
  "lotId": null,
  "sampleSize": 10000,
  "pointSize": null,
  "showLabels": false,
  "labelColumn": null,
  "labelFontSize": 11
}
```

- `source`: eds / defects / joined. joined 컬럼은 `lot_id`, `inspected_at`, `yield_pct` 등 snake_case입니다.
- Category null이면 차트 1개, Legend null이면 차트당 시리즈 1개입니다.
- X: string / number / date. Y는 숫자 컬럼입니다. UI 기본값은 날짜이며 API 호출 예시는 축을 명시합니다.
- `sampleSize`: null이면 기본 테이블, 숫자이면 benchmark 선택 범위 전체입니다.
- `pointSize`: null 자동 또는 2~20px. `labelFontSize`: 8~20px.
- `labelColumn`: null이면 Y값. 라벨 활성화 때만 응답에 라벨 문자열을 포함합니다.
- 날짜 X는 UTC epoch milliseconds로 변환됩니다. 타입/컬럼 오류는 400이며 결측 X/Y는 `skippedRows`로 셉니다.

```text
ScatterSpec
 ├─ sourceRows / plottedRows / skippedRows
 ├─ sampling="none" / sampledOutRows=0
 ├─ x / y / xType / appearance
 └─ charts[]                         ← Category
     ├─ key / name
     └─ series[]                     ← Legend
         ├─ key / name
         └─ points[{x,y,label?}]     ← 모든 유효 행, 중복 유지
```

`GET /api/chart/columns?source=eds&sampleSize=10000`은 컬럼·타입과 전체 건수를 제공합니다. 타입 추론용 소량 읽기는 차트 데이터의 샘플링이 아닙니다.

## 5. 내보내기

직접 Chart API: `POST /api/chart/render?format=png&categoryIndex=0&width=1000&height=500`, 본문은 scatter 요청과 같습니다. format은 svg/png/html, 이미지 크기는 width 320~2400, height 240~1600입니다. HTML은 모든 카테고리를 포함합니다.

BFF: `POST /api/export`에 `{ "config": <scatter 요청>, "format": "png", "categoryIndex": 0 }`을 보냅니다. 브라우저의 현재 줌이나 숨긴 시리즈 상태가 아니라 **적용된 설정으로 재조회한 전체 결과**를 내보냅니다.

## 6. 분석 설정과 실행 이력

| 메서드 / 경로 | 동작 |
| --- | --- |
| GET `/api/workspace/views` | 뷰 목록 |
| POST `/api/workspace/views` | `{name,description,config,pinned}` 생성, 201 + id |
| PUT `/api/workspace/views/{id}` | 동일 필드 + expected `version`; 충돌은 409 |
| DELETE `/api/workspace/views/{id}?version=N` | 버전 일치 시 삭제, 204 |
| GET `/api/workspace/runs?limit=100` | 최근 실행 최대 200개 |
| GET `/api/workspace/metrics` | 최근 24시간 실행/오류/P95, 저장 뷰 수 |
| GET `/api/workspace/health` | DAC/Chart/PostgreSQL 접근 상태 |
| GET `/health/live`, `/health/ready` | 프로세스 / workspace storage 준비 상태 |

이력에는 대량 결과 본문을 저장하지 않습니다. 취소 요청은 저장 단계까지 도달하지 않을 수 있습니다. 자동 보존 기간 삭제 작업은 없습니다.

## 7. 오류와 예제

잘못된 입력은 400, 저장 버전 충돌은 409, 일반 데이터 경계 초과는 422, BFF 대기열 초과는 429, upstream 접근 실패는 502, timeout은 504 계열로 구분합니다. BFF 실행 envelope의 `status`도 확인하세요.

[DAC Postman 컬렉션](../examples/dac.postman_collection.json), [Chart Postman 컬렉션](../examples/chart.postman_collection.json), [워크플로우 가정 요청](../examples/workflow-request.json)을 함께 제공합니다. 초기 개발 과정의 API 설명은 [service-reference.md](service-reference.md)에 보존했습니다.
