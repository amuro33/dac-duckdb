> 현재 API 사용법은 [api.md](api.md), 전체 구조는 [architecture.md](architecture.md)를 우선 참고하세요. 아래는 초기 구축 단계와 이후 확장을 함께 기록한 상세 이력입니다.

# 로컬 개발 DB

Oracle Database 21c XE (무료 Express Edition), PostgreSQL 18.6.

## 시작 및 확인

```bash
./start.sh
```

Docker 권한이 없으면 터미널에서 sudo 비밀번호를 요청합니다. 초기 Oracle 설치에는 몇 분이 걸릴 수 있습니다.

## 접속

| 항목 | Oracle | PostgreSQL |
| --- | --- | --- |
| 호스트 | 127.0.0.1 | 127.0.0.1 |
| 포트 | 1521 | 5432 |
| 서비스/DB | XEPDB1 (서비스 이름) | appdb |
| 사용자 | app | app |
| 비밀번호 (.env 키) | ORACLE_APP_PASSWORD | POSTGRES_PASSWORD |
| JDBC | jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1 | jdbc:postgresql://127.0.0.1:5432/appdb |

Oracle 관리자 계정은 SYSTEM이며 비밀번호는 ORACLE_PASSWORD입니다.
PostgreSQL app은 초기 관리자 계정입니다. 개발용으로 사용하세요.
비밀번호는 권한 600의 `.env`에 저장되며 Git에서 제외됩니다.

## 관리

아래 명령 앞에 필요하면 `sudo`를 붙입니다.

```bash
docker compose ps
docker compose logs --tail=100
docker compose stop
docker compose start
```

전용 Docker 볼륨에 데이터를 보존합니다. `docker compose down -v`는 데이터를 삭제합니다.
포트는 이 컴퓨터에서만 접속할 수 있습니다.

이미지: https://github.com/gvenzl/oci-oracle-xe 및 https://hub.docker.com/_/postgres

# DAC Worker 서비스

.NET 10 ASP.NET Core API와 Postman 형태의 테스트 클라이언트, DuckDB 변환 기능입니다.
로컬 kind Kubernetes 클러스터 `dac`의 `dac` namespace에서 `dac-worker` Deployment/Pod로 실행합니다.
Deployment가 Pod를 관리하므로 실제 Pod 이름에는 자동 접미사가 붙습니다.

브라우저: **http://localhost:8080** — 왼쪽 프리셋 선택 → Send. 경로/JSON 편집, Table/JSON 응답 전환이 가능합니다.
호스트 컴퓨터 내부 접속용입니다. 외부 포트는 열지 않습니다.

## API

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| GET | `/api/dac/get_eds_data` | Oracle EDS 검사 결과 |
| GET | `/api/dac/get_defect_data` | Oracle 결함 이력 |
| GET | `/api/dac/lots` | EDS에 있는 Lot 목록 |
| GET | `/api/dac/summary` | 웨이퍼·결함·평균 수율 요약 |
| POST | `/api/dac/transform` | 두 API를 HTTP 호출 후 DuckDB에서 변환 |
| GET | `/health/live` | 프로세스 상태 |
| GET | `/health/ready` | Oracle 조회 가능 여부 |

조회 API 공통 파라미터: `lotId`, `waferId`, `limit` (기본 100, 허용 1~1000).
예: `/api/dac/get_eds_data?lotId=LOT-001&waferId=W01`.
조회 응답은 JSON 배열입니다. 잘못된 입력은 HTTP 400 Problem Details를 반환합니다.

## Oracle 샘플

별도 테이블 `APP.DAC_EDS_DATA` (12행), `APP.DAC_DEFECT_DATA` (14행).
EDS는 반도체 웨이퍼 검사 데이터로 가정했습니다. `LOT_ID + WAFER_ID`가 복합 조인 키입니다.
결함 1:N, 결함 없는 웨이퍼, EDS가 없는 결함을 포함해 조인 차이를 확인할 수 있습니다.
`db/seed.sql`은 MERGE로 샘플 키가 없는 경우만 삽입합니다. 재실행해도 사용자가 수정한 값을 덮어쓰지 않습니다.
PostgreSQL은 기존 상태로 유지하며 이번 서비스는 Oracle을 사용합니다.

## DuckDB와 워크플로우 대체 실행

워크플로우 엔진은 구현하지 않았습니다. 클라이언트 프리셋 또는 `examples/workflow-request.json`을
워크플로우가 보냈다고 가정한 실행 요청으로 사용합니다.

```json
{
  "operation": "filter",
  "joinType": "left",
  "lotId": "LOT-002",
  "minYield": 94,
  "severity": "HIGH",
  "limit": 100
}
```

- `join`: inner/left/full 조인. EDS와 결함을 복합 키로 연결하며 여러 결함은 여러 행을 만듭니다.
- `merge`: 공통 스키마의 UNION ALL (세로 결합). `source_type`으로 출처 구분. SQL MERGE upsert 또는 중복 제거가 아닙니다.
- `filter`: 조인 후 필터를 적용합니다. 다른 operation에서도 필터를 같이 지정할 수 있습니다.
- 필터는 AND 조건이며 `minYield`는 이상(>=), `severity`는 정확히 일치합니다. NULL 값은 해당 필터에서 제외됩니다.
- 결과 `limit`는 변환 후 적용합니다. 소스는 각 API에서 최대 1000행을 조회하며 한쪽이 1000행에 도달하면 422로 거절합니다. 큰 데이터에서는 좁은 lotId로 요청해야 합니다.
- DuckDB는 요청마다 별도 인메모리 DB를 만들고 폐기합니다. 임의 SQL/파일/외부 URL 실행은 제공하지 않습니다.
- `DacApiBaseUrl` 환경 설정 기본값은 같은 Pod의 `http://127.0.0.1:8080/`입니다.
- 두 API는 순차 조회합니다. 동시 쓰기가 있는 운영 환경에서 동일 시점 스냅샷을 보장하지 않습니다.

## 실행·검증

```bash
# Oracle 샘플 재삽입, 이미지 빌드, kind 이미지 로드, Kubernetes 배포
./scripts/deploy.sh
# .NET SDK 설치 없이 Docker SDK로 유닛/API 테스트
./scripts/test.sh
# 실제 Oracle/Pod/HTTP/DuckDB 통합 검증 (초기 샘플 기준)
python3 scripts/integration.py
# Pod 상태
KUBECONFIG="$PWD/.kube/config" ~/.local/bin/kubectl get pods -n dac
```

브라우저 자동 검증은 Playwright 설치 후 `node scripts/browser-test.cjs`로 실행합니다.
별도 경로의 Playwright는 `PLAYWRIGHT_MODULE`에 해당 모듈 경로를 지정합니다.
`artifacts/`에 TRX, 통합 검증 결과, 브라우저 검증 결과, 스크린샷을 저장합니다.
Postman에 `examples/dac.postman_collection.json`을 가져올 수도 있습니다.

`kind`, `kubectl`은 `~/.local/bin`에 설치되어 있습니다. `.kube/config`는 이 프로젝트 전용 설정입니다.
DB 접속 비밀번호는 `.env`에서 읽어 Kubernetes Secret으로 전달하며 소스 YAML에는 넣지 않습니다.
현재는 로컬 개발용 API이며 사용자 인증은 추가하지 않았습니다.

참고: [Oracle ODP.NET](https://www.nuget.org/packages/Oracle.ManagedDataAccess.Core),
[DuckDB.NET](https://duckdb.net/docs/basic-usage.html), [kind](https://kind.sigs.k8s.io/docs/user/quick-start/).

# Chart Worker · Scatter Lab

테스트 페이지: **http://localhost:8081**. 기존 DAC 콘솔은 http://localhost:8080 입니다.
두 서비스는 별도 Kubernetes Deployment/Pod입니다. `chart-worker` Pod에는 .NET 10 API와
ECharts 이미지 렌더러(Node.js) 컨테이너가 함께 있습니다. 차트 서비스는 Oracle에 직접 연결하지 않고
`http://dac-worker:8080`의 조회 API와 join API를 호출합니다.

## 사용하는 방법

1. EDS / Defect / Joined 소스를 선택합니다. 선택한 API 결과의 컬럼·타입을 실제 데이터에서 읽습니다.
2. category 컬럼 선택: 값마다 별도 카드·DOM·ECharts 인스턴스가 생깁니다. 선택 안 함은 전체 1개 차트입니다.
3. legend 컬럼 선택: 각 category 안에서 값별 시리즈가 생깁니다. 선택 안 함은 1개 시리즈입니다.
4. X 컬럼과 타입(문자열/숫자/날짜), 숫자 Y 컬럼을 선택합니다. 변경 즉시 서버에서 다시 그룹핑합니다.
5. 실제 웹 차트 / 이미지 미리보기 / 차트 데이터 탭을 전환합니다. 각 카드에서 SVG/PNG를 다운로드하거나,
   ‘웹 차트 저장’으로 모든 category 차트가 들어 있는 독립 HTML을 저장합니다.

웹 차트는 legend 클릭으로 시리즈를 숨기거나 표시할 수 있습니다.
이미지는 chart-worker → 같은 Pod의 ECharts SSR 렌더러에서 생성합니다. 브라우저 스크린샷에 의존하지 않습니다.
HTML에는 ECharts와 데이터가 포함되어 별도 서버나 CDN 없이 열립니다.
차트별로 하나의 DOM에 하나의 좌표계를 사용합니다. ECharts grid 여러 개를 이용한 분할이 아닙니다.

EDS에는 실제 Oracle `INSPECTED_AT` TIMESTAMP 컬럼이 추가되었고 API는 UTC ISO 8601 `inspectedAt`을 반환합니다.
날짜 X축은 `inspectedAt` + 날짜 타입으로 시험할 수 있습니다.

## Chart API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/chart/columns?source=eds` | API 결과 컬럼·타입과 행 수 |
| POST | `/api/chart/scatter` | 렌더러와 독립적인 ScatterSpec JSON |
| POST | `/api/chart/render?format=svg&categoryIndex=0` | 선택한 category의 SVG 이미지 |
| POST | `/api/chart/render?format=png&categoryIndex=0` | 선택한 category의 PNG 이미지 |
| POST | `/api/chart/render?format=html` | 모든 category의 독립 웹 차트 HTML |
| GET | `/health/live`, `/health/ready` | 프로세스, data API·렌더러 준비 상태 |

POST 공통 본문:

```json
{
  "source": "eds",
  "category": "lotId",
  "legend": "product",
  "x": "waferId",
  "y": "yieldPct",
  "xType": "string",
  "lotId": null
}
```

`source`: `eds`, `defects`, `joined`. 원격 URL이나 임의 SQL은 받지 않습니다.
`category`와 `legend`는 결과 컬럼을 선택하거나 `null`을 사용합니다.
`xType`: `string`, `number`, `date`. 숫자·날짜 타입은 해당 실제 타입의 컬럼만 받습니다.
Y는 숫자 컬럼만 허용합니다. 날짜는 ISO 8601을 사용하며 시간대 없는 날짜/시간은 UTC로 해석합니다.
`joined` 소스의 컬럼은 기존 transform API처럼 `lot_id`, `wafer_id`, `yield_pct` 등 snake_case입니다.
`width`(320~2400), `height`(240~1600)는 이미지 요청 쿼리에서 지정할 수 있습니다. 기본은 1000×500입니다.

ScatterSpec: `charts[]` → `series[]` → `points[{x,y}]` 형태입니다.
ECharts option은 포함하지 않으며, 교체 지점은 `wwwroot/echarts-adapter.js`와 렌더러입니다.
API 데이터 변환 코드는 ECharts에 의존하지 않습니다.

- 그룹핑은 원래 scalar 값과 타입을 기준으로 수행합니다. NULL 그룹과 문자열 `(null)` 그룹은 구분됩니다.
- X/Y가 NULL인 행은 포인트에서 제외하고 `skippedRows`로 반환합니다. 중복 포인트는 유지합니다.
- 원본이 없으면 charts는 빈 배열입니다. 알 수 없는 컬럼·잘못된 축 타입은 HTTP 400입니다.
- 한 요청의 category는 최대 50개, category당 legend는 최대 50개입니다.
- 원본 API 1000행 한도 도달 시 잘린 차트를 만들지 않고 오류를 반환합니다. `lotId`를 좁혀 조회하세요.
- readiness는 API 접근과 렌더러 상태를 확인합니다. 원본 API 실패는 502, 시간 초과는 504입니다.
- EDS와 defect는 합계가 아닌 원본 행마다 산점도 1포인트를 만듭니다. join으로 생긴 1:N 행도 각각 포인트입니다.

## 차트 서비스 배포·테스트

```bash
# 첫 구축: Oracle의 날짜 컬럼 추가 및 DAC 갱신
./scripts/deploy.sh
# 별도 chart-worker API + 이미지 렌더러 배포
./scripts/deploy-chart.sh
# 전체 .NET 테스트 (DAC + Chart)
./scripts/test.sh
# 실제 data API/차트 변환/SVG/PNG/HTML 통합 검증
python3 scripts/chart-integration.py
# Playwright 설치 후 웹 검증
node scripts/chart-browser-test.cjs
```

`compose.chart.yaml`의 로컬 nginx gateway는 기존 kind 클러스터를 재생성하지 않고
localhost:8081을 chart-worker NodePort에 연결합니다. 기존 DB 포트 공개 범위는 바꾸지 않습니다.
클러스터 설정은 `.kube/config`에 있으며 이미지는 `chart-worker:dev`, `chart-renderer:dev`입니다.
ECharts 라이브러리는 로컬 정적 파일로 제공하여 CDN이 없어도 동작합니다.
의존성 버전은 renderer package-lock.json에 고정했습니다.
검증 결과·이미지·스크린샷·HTML은 `artifacts/`에서 확인할 수 있습니다.

참고: [ECharts 산점도](https://echarts.apache.org/handbook/en/how-to/chart-types/scatter/basic-scatter/),
[ECharts 서버 렌더링](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/).

## 확장 차트 샘플

기존 샘플에 `LOT-101`, `LOT-102`, `LOT-103`을 추가했습니다. 각 Lot당 웨이퍼 100개,
DRAM/NAND 각각 50개이며 수율·검사 시간·결함 종류/심각도를 다르게 구성했습니다.
현재 전체 EDS는 312행, defect는 464행입니다. 앞의 12/14행 설명은 초기 샘플 기준입니다.
`db/chart-samples.sql`은 insert-only MERGE이며 `scripts/generate-chart-samples.py`로 재생성합니다.
`deploy.sh`가 기본 샘플 이후 이 데이터를 추가합니다.

차트 페이지에서 Lot 필터에 `LOT-101`을 넣고 새로고침하면 100포인트와 두 제품 시리즈를 볼 수 있습니다.
현재 category/legend 분할은 ChartBuilder의 .NET Dictionary 중첩 그룹핑입니다.
DuckDB는 DAC의 join/merge/filter에서 사용합니다. 차트 그룹핑 엔진은 아직 DuckDB로 변경하지 않았습니다.
폰트가 포함된 최종 렌더러에서 한글 ‘전체’, 날짜, 숫자를 확인한 PNG는
`artifacts/chart-font-verified.png`입니다.

## 선택형 대용량 샘플 (1천 / 1만 / 10만 / 100만)

차트 페이지의 ‘샘플 데이터 규모’에서 선택합니다. ‘기존 Oracle 샘플’은 이전 데이터를 사용합니다.
`APP.DAC_CHART_BENCHMARK`에 100만 행이 실제 저장되어 있으며, 선택 N건은 SAMPLE_ID <= N 범위입니다.
기존 EDS/defect 테이블을 늘리는 대신 별도 테스트 테이블로 분리했습니다. Lot 10개, 제품 3개,
결함 종류 3개, 심각도 4개, 숫자 ID와 UTC 검사 일시를 제공합니다.

`GET /api/dac/chart_samples?source=eds&size=1000000`은 선택 범위 전체를 반환합니다.
`limit`를 지정하면 첫 페이지를 반환하며 `afterId`에 이전 페이지의 마지막 SAMPLE_ID를 넘겨 이어 읽습니다.
응답의 `totalRows`는 전체 일치 건수, `returnedRows`는 이번 응답 건수, `hasMore`는 남은 페이지 여부입니다.
source=eds/defects/joined는 같은 합성 테스트 테이블의 필드 투영이며 대용량 DuckDB 조인 벤치마크가 아닙니다.

차트 요청의 `sampleSize` 이름은 호환을 위해 유지하지만 동작은 **선택 규모 전체 조회**입니다.
1천/1만/10만/100만 건 모두 ID 순서로 빠짐없이 읽습니다. ORA_HASH와 2만 행 샘플링 제한은 제거했습니다.
차트 서비스 내부의 1만 행 페이지 처리는 메모리를 위한 전송 단위이며 모든 페이지를 합칩니다.
`sourceRows = plottedRows + skippedRows`; `sampledOutRows=0`, `sampling="none"`입니다.
기본 X는 검사 날짜입니다. 웹과 이미지 내보내기 모두 선택 카테고리의 전체 점을 사용합니다.

```bash
# 100만 행 최초 생성 및 멱등 재실행
python3 scripts/seed.py db/benchmark.sql
# 네 가지 규모 / 전체 건수 / 누락 없음 / 필터 / 검증 오류
python3 scripts/benchmark-integration.py
# 규모 선택 / PNG 다운로드 / 모바일 레이아웃
node scripts/benchmark-browser-test.cjs
```

`deploy.sh`는 대용량 시드도 적용합니다. 결과와 응답 시간은 `artifacts/benchmark-*.json`에 저장합니다.
