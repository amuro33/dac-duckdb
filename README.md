# API Content Builder

**저장 API와 워크플로우를 재사용 가능한 데이터 소스로 만들고, 차트 분석과 DuckDB·Spark·DataFusion 비교로 연결하는 통합 애플리케이션입니다.**

.NET 10 조회·발행·변환·수신 검증·차트·포털 서비스와 React UI를 Kubernetes에 배포합니다. 분석 설정과 실행 이력은 PostgreSQL에 저장하며, 웹 차트와 PNG·SVG·독립 HTML 내보내기를 지원합니다. 워크플로우/API 소스는 최대 1만 행의 고정 결과를 공유합니다. 별도 스트림/합성 데이터 경로는 1천·1만·10만·100만 건을 선택해 **샘플링 없이 전체 데이터**를 처리합니다.

[워크플로우 벤치마크](docs/workflow-benchmark.md) · [워크플로우/API 데이터 소스](docs/data-sources.md) · [분석 엔진 선택](docs/engines.md) · [Kafka 스트리밍](docs/streaming.md) · [시스템 설계](docs/architecture.md) · [실행·운영](docs/runbook.md) · [API 명세](docs/api.md) · [성능 측정](docs/chart-timing.md) · [데모 가이드](docs/portfolio-guide.md)

![API Content Builder — 저장 쿼리 선택, 요청 편집, 실행 결과와 이력](docs/images/api-content-builder.png)

## 해결하려는 문제

검사 결과와 결함 이력이 서로 다른 API에 있을 때 분석자는 데이터를 내려받아 수동으로 합치고, 차트마다 축·그룹 조건을 다시 지정해야 합니다. API Content Builder는 원본 조회, 변환, 시각화, 설정 저장, 재실행을 하나의 작업 공간에 연결합니다.

- **Category**로 고른 컬럼의 값마다 별도 DOM과 차트 인스턴스를 만듭니다.
- **Legend**로 고른 컬럼의 값마다 각 차트 안에 독립 시리즈를 만듭니다.
- X축은 날짜·숫자·문자열, Y축은 숫자입니다. 기본 X축은 UTC 검사 날짜입니다.
- 원본 건수, 유효 포인트 수, 결측 제외 수, 실제 화면에 그린 점 수를 구분합니다.
- 서버가 특정 차트 라이브러리의 option 대신 중립적인 `ScatterSpec`을 반환합니다.

모든 샘플은 합성 데이터입니다. 실제 반도체 회사의 데이터나 연동을 포함하지 않습니다.

## 주요 기능

| 화면 / 기능 | 구현 내용 |
| --- | --- |
| Analysis | 워크플로우/API/저장 소스 선택, Category/Legend 선택, 날짜·숫자·문자열 X, 숫자 Y, 줌·포인트 조회·확대, 요청 취소 |
| 차트 옵션 | 포인트 크기, 컬럼 기반 라벨, 라벨 글자 크기, 겹침 방지 |
| 성능 표시 | 조회·수신 / 현재 페이지 그리기 / 전체 표시 시간, 차트별 처리 시간 |
| Engine Benchmark | 게시 워크플로우를 DuckDB·Spark·DataFusion으로 재실행, 노드별 시간·기준 Output 일치 검증·CSV, Drill 자체 UI |
| Data streams | Kafka 실제 원본 발행, 두 소비자 그룹, 전체 DuckDB 변환, 시작·중지, 수신 상세, 결과 차트 |
| Saved views | 설정·메모 저장, 고정, 검색, 직접 링크, 버전 기반 충돌 감지 |
| API console | query_id 멀티탭, Params/Body/Headers, 바인딩 Inspector, 실행 이력, Saved sources, 워크플로우 연결 |
| Workflows | Query·Join·Merge·Filter·Output 그래프, 입력 매핑, 초안/게시 버전, 비동기 실행 API·노드 결과 |
| Activity | 실행 성공·실패 이력, 요청 설정, 재실행, 상태 필터 |
| Export | 원본/포인트 CSV, 서버 렌더링 PNG·SVG, 오프라인 HTML |
| 대용량 | Oracle 별도 테이블의 실제 합성 100만 행, 선택 범위 전체 처리 |

## 시스템 구성

```mermaid
flowchart TB
  browser["Browser · React / TypeScript<br/>ECharts Canvas · 독립 차트 DOM"]
  gateway["nginx gateway<br/>localhost:8082"]
  subgraph cluster["Docker 위 kind Kubernetes · namespace dac"]
    portal["waferscope Pod<br/>.NET 10 BFF + React 정적 파일"]
    dac["dac-worker Pod<br/>.NET 10 · Oracle 조회"]
    transform["data-transform-service Pod<br/>Kafka 수신 / 엔진 선택 / 결과 API"]
    publisher["dac-publisher Pod<br/>주기적 원본 발행"]
    observer["stream-observer Pod<br/>독립 소비자 그룹"]
    subgraph chartpod["chart-worker Pod"]
      chart[".NET 10 · 행 변환 / Category·Legend 그룹핑"]
      renderer["Node.js sidecar · localhost:8091<br/>ECharts SSR + Sharp + 한글 폰트"]
    end
  end
  subgraph databases["Docker Compose · Kubernetes 외부"]
    oracle[("Oracle 21c XE<br/>EDS / Defect / Benchmark")]
    postgres[("PostgreSQL 18<br/>워크플로우 / 소스 / 비교 / Views / Runs")]
    kafka[("Kafka · 실제 EDS / Defect")]
    engines["DuckDB / Spark / DataFusion / Drill<br/>별도 실행 서비스"]
  end
  browser -->|"동일 출처 HTTP"| gateway
  gateway -->|"NodePort 30082"| portal
  portal -->|"고정 소스 비교"| engines
  chart -->|"고정 소스 행 조회"| portal
  portal -->|"조회 / 워크플로우 Query"| dac
  portal -->|"스트림 제어"| transform
  publisher -->|"원본 조회"| dac
  publisher -->|"실제 행"| kafka
  transform <-->|"입력 Parquet / 결과 파일"| engines
  kafka --> transform
  kafka --> observer
  transform --> postgres
  chart -->|"변환 결과 조회"| transform
  portal -->|"차트 / 내보내기"| chart
  chart -->|"HTTP 데이터 API"| dac
  chart -->|"이미지 / HTML"| renderer
  dac -->|"ODP.NET"| oracle
  portal -->|"Npgsql"| postgres
```

Oracle과 PostgreSQL은 클러스터 밖의 Compose 컨테이너와 영속 볼륨을 사용합니다. `chart-worker`는 Oracle에 직접 접속하지 않고 Portal의 고정 소스 API 또는 기존 DAC/변환 결과 API를 호출합니다. 워크플로우 계산은 Portal의 DuckDB, 소스 Engine Benchmark는 Analytics Engines의 DuckDB·Spark·DataFusion, 기존 스트림 변환은 별도 `data-transform-service`와 엔진 어댑터에서 실행합니다. Kafka 원본 토픽을 변환 서비스와 수신 검증 서비스가 서로 다른 consumer group으로 읽습니다. [스트리밍 흐름과 저장·재처리 계약](docs/streaming.md)을 참고하세요.

**상세 다이어그램:** [배포·요청 시퀀스·ER 모델·오류 처리](docs/architecture.md). 다이어그램 원본은 [docs/diagrams](docs/diagrams)에 있습니다.

## 빠른 시작

검증 환경은 **Linux x86-64 + Docker Engine + Docker Compose + kind + kubectl + Python 3**입니다. `kind`/`kubectl`은 PATH 또는 `~/.local/bin`에 있어야 합니다. 현재 Docker 사용자가 `docker info`를 실행할 수 있어야 합니다. Oracle XE 컨테이너 및 대량 렌더링을 고려해 전체 엔진 구성은 메모리 32GB 이상과 충분한 디스크를 권장합니다. ARM/macOS 조합은 검증하지 않았습니다.

```bash
git clone https://github.com/amuro33/dac-duckdb.git
cd dac-duckdb
./scripts/up.sh
```

`up.sh`가 순서대로 수행하는 작업:

1. `.env`가 없으면 무작위 DB 비밀번호를 생성합니다. 기존 파일은 보존합니다.
2. Oracle/PostgreSQL 컨테이너를 시작하고 readiness를 기다립니다.
3. `dac` kind 클러스터 생성 및 DB 네트워크 연결을 확인합니다.
4. 기본 EDS 312행·결함 464행과 별도 benchmark 100만 행을 준비합니다.
5. Spark master·worker 2개, DataFusion adapter, Drillbit과 Kafka를 시작하고 DAC·Publisher·Transform·Observer·Chart API/renderer·Portal을 배포합니다.
6. 예제 분석 뷰를 PostgreSQL에 등록합니다.

첫 실행은 이미지 다운로드와 Oracle 초기화 때문에 시간이 걸립니다. .NET SDK와 프런트 빌드 도구는 Docker 빌드 단계에서 사용하므로 실행만 할 때 호스트에 설치할 필요가 없습니다. `.env.example`은 설정 설명용이며 실제 비밀번호는 Git에 포함하지 않습니다.

| 서비스 | 주소 |
| --- | --- |
| **통합 애플리케이션** | **http://localhost:8082** |
| 기존 DAC 진단 콘솔 | http://localhost:8080 |
| 기존 Chart Lab | http://localhost:8081 |
| Oracle | `127.0.0.1:1521/XEPDB1` · 사용자 `app` |
| PostgreSQL | `127.0.0.1:5432/appdb` · 사용자 `app` |

다른 기기에서 접속하려면 `.env`의 `WAFERSCOPE_BIND_ADDRESS=0.0.0.0`을 설정하고 `docker compose -f compose.portal.yaml up -d`를 실행합니다. 브라우저에서는 `http://<서버의 LAN IP>:8082`를 사용합니다. 기본값은 `127.0.0.1`입니다. 현재 앱에는 사용자 인증이 없으므로 신뢰하는 개발 네트워크 범위로 운영합니다.

## 5분 데모

현재 기본 흐름은 **API → 워크플로우 → 고정된 데이터 소스 → 분석 / Engine Benchmark**입니다. 시연 전 서비스를 기동하고 예제 워크플로우를 한 번 실행해 두면 엔진 초기화 대기 시간을 줄일 수 있습니다.

| 시간 | 화면 | 시연할 내용 |
| --- | --- | --- |
| 0:00–1:00 | API console | `EDS_BY_LOT` 선택 → 기본 바디의 `lot_id` 확인 → 실행 → 응답과 요청 이력 확인. query_id가 조회 계약의 기준입니다. |
| 1:00–2:00 | Workflows | 목록에서 예제 워크플로우를 만들고 이름을 지정합니다. Query → Join → Filter → Output을 확인하고 게시·실행합니다. 입력과 노드별 결과는 실행 기록 탭에서 확인합니다. |
| 2:00–3:00 | Analysis | 성공한 워크플로우 실행의 **분석 소스로 사용**을 누릅니다. 결과 컬럼으로 Category·Legend를 선택하고 날짜 X축, 숫자 Y축, 포인트 크기·라벨을 보여줍니다. |
| 3:00–4:00 | Analysis · 저장된 뷰 / Export | 분석 설정을 이름과 함께 명시적으로 저장하고 다시 엽니다. 같은 소스 ID를 사용하므로 원본을 재실행하지 않습니다. PNG 또는 HTML 내보내기도 확인합니다. |
| 4:00–5:00 | Engine Benchmark | 게시된 워크플로우나 성공한 실행을 선택합니다. 같은 Query 입력으로 세 엔진이 그래프를 직접 실행하고 노드별 시간·기준 Output 일치 여부를 비교합니다. |

실행 시간은 장비와 엔진 초기화 상태에 따라 달라집니다. [상세 시연 대본과 설계 질문](docs/portfolio-guide.md) · [소스 계약과 제한](docs/data-sources.md)

**확장 데모:** Data streams의 Kafka 발행·독립 소비자와 기존 대용량 경로는 별도로 시연합니다. 새 워크플로우/API 소스의 최대 1만 행과 기존 합성 100만 행 실험을 구분합니다. Drill은 Engine Benchmark 하단의 자체 SQL 콘솔 링크로 엽니다.

## 데이터 처리의 정확한 의미

| 항목 | 실제 동작 |
| --- | --- |
| 워크플로우/API 소스 | 실행 결과·스키마·출처를 고정 저장. 최대 1만 행/8MB; DAC 개별 쿼리는 현재 최대 1천 행 |
| `source=snapshot` | 고정 소스 ID로 차트·내보내기·저장 뷰 재사용 |
| Engine Benchmark | 게시 워크플로우의 변환 그래프를 고정 Query 입력으로 세 엔진에서 실제 실행 |
| DuckDB `join` | `lot_id + wafer_id` 복합 키의 inner/left/full 조인 |
| DuckDB `merge` | 공통 스키마로 맞춘 `UNION ALL` 세로 결합. SQL upsert가 아님 |
| DuckDB `filter` | 조인 결과에 최소 수율·심각도 AND 조건 적용 |
| Kafka | 실제 EDS/결함 행을 최대 1천 행씩 발행. 작업 ID만 전달하는 구조가 아님 |
| `source=transformed` | Kafka로 받은 두 원본의 실제 DuckDB 결과를 datasetId로 재사용 |
| Category/Legend 그룹핑 | Chart.Worker의 .NET Dictionary. 현재 DuckDB 그룹핑 아님 |
| `sampleSize` | 호환을 위해 유지한 필드명. 선택 N행 전체를 뜻하며 표본 추출 아님 |
| 내부 1만 행 페이지 | 끝까지 읽고 합치는 전송 단위. 표시 점 수를 줄이지 않음 |
| `sampledOutRows` / `sampling` | 항상 `0` / `none` |
| 카테고리 화면 페이지 | 한 번에 4개 차트를 표시. 각 카테고리의 모든 점은 유지 |
| 기존 동기 API 한도 | 기본 데이터 호환 경로는 소스당 1천 행 경계에서 잘린 결과를 거부. Kafka benchmark 경로는 전체 입력을 계산 |
| benchmark `joined` | 합성 테이블의 대응 필드 투영. 100만 행 DuckDB 조인 성능 주장이 아님 |

자체 워크플로우를 구현했습니다. [워크플로우 가이드](docs/workflows.md)에서 그래프 편집, 히스토리 바디 복사, API 연결, 게시 버전 실행과 현재 지원 범위를 확인할 수 있습니다.

## 측정된 성능

아래는 **기존 대용량 직접 조회 경로**의 과거 측정이며, 새 워크플로우/API 소스의 성능 수치가 아닙니다.

2026-11-13, 동일 머신의 headless Chromium/SwiftShader에서 각 조건을 한 번씩 측정한 값입니다. 장치·브라우저·포인트 크기·라벨 옵션에 따라 달라지며 SLA나 부하 테스트 결과가 아닙니다.

| 조건 | 조회·수신 | 그리기 | 전체 표시 |
| --- | ---: | ---: | ---: |
| 10만 행 / 현재 4개 차트 4만 점 | 926.4ms | 50.3ms | 976.7ms |
| 100만 행 / 현재 4개 차트 40만 점 | 20.42초 | 241.1ms | 20.66초 |
| 100만 행 / 한 차트 100만 점 | 19.67초 | 637.2ms | 20.31초 |

100만 행 조회 후 포인트 크기 변경은 **20.96초 → 0.81초**로 줄었습니다. 데이터 재조회와 차트 인스턴스 재생성을 제거한 효과이며 최초 조회 시간은 여전히 약 20초입니다. 숫자/날짜 좌표는 Float64Array로 전달하고, 라벨 없는 대량 차트는 Canvas large/progressive 경로를 사용합니다. 점을 생략하거나 집계하지 않습니다.

[측정 방법과 한계](docs/chart-timing.md) · [공개 측정 원본 JSON](docs/evidence) · [GPU/CUDA 검토](docs/gpu-optimization-review.md)

## 테스트

```bash
# Docker .NET SDK로 유닛/API/스트림 계약 테스트
./scripts/test.sh

# 프런트 테스트와 production build: Node.js 22.12+ 필요
npm ci --prefix src/Portal.Web
npm test --prefix src/Portal.Web
npm run build --prefix src/Portal.Web

# 실행 중인 실제 DB와 서비스에 대한 검증
python3 scripts/portal-integration.py
python3 scripts/benchmark-integration.py
python3 scripts/full-data-export-check.py
python3 scripts/streaming-integration.py   # 실제 Kafka, 두 소비자, 중복·장애 복구, 전체 결과 검증
python3 scripts/engines-integration.py     # 네 엔진 × 네 규모, 전체 결과·NULL·중복·빈 입력 비교
```

브라우저 검증용 Playwright는 별도 도구 디렉터리에 설치할 수 있습니다.

```bash
npm install --prefix /tmp/waferscope-browser playwright
/tmp/waferscope-browser/node_modules/.bin/playwright install chromium
export PLAYWRIGHT_MODULE=/tmp/waferscope-browser/node_modules/playwright
node scripts/chart-timing-browser.cjs
node scripts/chart-million-single.cjs
node scripts/chart-options-browser.cjs
node scripts/full-data-interaction.cjs
node scripts/streaming-browser.cjs
node scripts/engines-browser.cjs
```

2026-11-16 배포 작업 공간 검증: **.NET 236개 + 프런트 33개 + 엔진 Python 15개**, 워크플로우/API 소스 **실제 통합 14항목 + 브라우저 12항목** 통과. 세 실제 엔진의 집계·필터·Join·Merge 결과, 고정 소스 재사용, PNG 출력, 날짜 축, 모바일 화면과 비교 CSV를 검증했습니다. [현재 검증 범위](docs/evidence/source-validation.md).

위 수치는 해당 날짜 배포 작업 공간의 검증 기록이며 GitHub CI 통과 표시가 아닙니다. 과거 대용량·Kafka 검증은 [전체 데이터 검증](docs/full-data-validation.md), [차트 시간 검증](docs/chart-timing.md)에 별도로 보관합니다. `artifacts/`는 실행 시 생성되고 Git에서 제외합니다.

## 소스 구조

```text
src/
  Dac.Worker/       Oracle API · 호환 프록시 · 전체 데이터 페이징
  Dac.Contracts/    원본·변환 요청 공유 계약
  Data.Publisher/   실제 원본을 Kafka에 주기적으로 발행
  Data.Transform/   Kafka 수신 · 엔진 실행 조정 · Parquet 결과 API
  Analytics.Engines/ Spark / DataFusion / Drill 실행 어댑터
  Streaming.Core/   이벤트 계약 · 영속 수신 · Kafka 클라이언트
  Chart.Worker/     데이터 API 클라이언트 · 중립 차트 모델 · 그룹핑
  Chart.Renderer/   ECharts SSR · Sharp PNG · 독립 HTML
  Portal.Api/       BFF · 워크플로우 실행 · 소스 캡처 · 비교 큐 · PostgreSQL 저장
  Portal.Web/       React API·워크플로우·분석·Engine Benchmark UI · 웹 차트 · 렌더 시간 측정
tests/             .NET 서비스별 유닛/API 테스트
db/                초기 스키마 · 기본 샘플 · 100만 행 생성 SQL
k8s/               kind · Deployment/Service · nginx 설정
scripts/           실행 · 배포 · 시드 · 자동 검증
examples/          요청 JSON · Postman 컬렉션
docs/              설계 · 운영 · API · 측정 · 다이어그램
```

## 설계 결정과 현재 범위

- 조회·발행·변환·차트·포털을 분리하고 ECharts 의존성을 렌더러 경계에 모았습니다.
- 저장 뷰는 낙관적 동시성 제어로 수정 충돌을 409로 반환합니다.
- 페이지 누락·커서 역행·건수 불일치가 발생하면 부분 차트를 성공으로 반환하지 않습니다.
- BFF는 허용된 내부 경로만 실행하며 요청 크기·동시 실행 수를 제한합니다.
- 원본은 Oracle, 스트림 입력·상태·분석 설정은 PostgreSQL, 변환 결과는 Parquet PVC, 이벤트는 Kafka에 저장합니다.
- 단일 노드/단일 브로커의 로컬 개발 환경입니다. Kafka 보존 기간은 7일이며 입력·결과의 자동 정리 정책은 아직 없습니다. 인증·테넌트 격리·고가용성·자동 백업·분산 추적·CUDA 가속은 구현 범위에 포함하지 않습니다.

상세 근거와 확장 방향은 [설계 문서](docs/architecture.md)에 정리했습니다. 기존 ECharts 배포본의 라이선스는 [ECHARTS-LICENSE](src/Chart.Worker/wwwroot/vendor/ECHARTS-LICENSE)에 보존되어 있으며 각 의존성의 라이선스는 해당 패키지를 따릅니다.

DAC stored-query console: see [request and history contracts](docs/dac-query-console.md).
