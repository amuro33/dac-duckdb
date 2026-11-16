# DAC 저장 쿼리 콘솔

앱: http://192.168.50.186:8082/#console

## 사용 흐름

1. 저장 쿼리 목록에서 query_id를 선택합니다.
2. database_name, query_id와 바인딩 값이 포함된 기본 JSON 바디가 채워집니다.
3. 바인딩 값을 수정하고 Send 또는 Ctrl/Cmd+Enter로 실행합니다.
4. 실제 요청 바디·경로·상태·실행 시간·행 수·성공한 SQL 버전이 PostgreSQL 이력에 저장됩니다.
5. 콘솔 History/Inspector 최근 실행 선택 또는 Activity의 재실행으로 당시 요청을 다시 편집합니다.
6. 재실행은 새 Run ID를 생성합니다. 기존 이력은 덮어쓰지 않습니다.

예시:

```http
POST /api/dac/select/EDS_BY_LOT
Content-Type: application/json
```

```json
{
  "database_name": "oracle",
  "query_id": "EDS_BY_LOT",
  "lot_id": "LOT-101",
  "min_yield": 90,
  "limit": 100
}
```

바인딩은 최상위 키/값입니다. 별도의 params 객체로 감싸지 않습니다.
현재 등록 DB 이름은 `oracle`입니다. DB 접속 문자열은 서버 설정에 있으며 바디로 받지 않습니다.
경로와 바디의 query_id가 다르거나 미등록 DB, 누락/알 수 없는 바인딩, 잘못된 타입·범위는 400입니다.
등록되지 않았거나 비활성화된 query_id는 404입니다. limit은 정수 1–1000입니다.

## 요청 워크벤치

- query_id를 기준으로 여러 요청을 탭에 엽니다. `+`는 현재 쿼리의 기본 바디로 새 탭을 만들고, 이력 선택은 당시 바디를 별도 탭에 엽니다. 최대 20개입니다.
- 요청 탭의 바디는 브라우저 `sessionStorage`에 자동 임시 저장됩니다. 같은 탭 새로고침/화면 이동에 유지되며, 브라우저 세션 종료 후 영구 보관되는 기능은 아닙니다. `저장`은 JSON 바디 파일을 다운로드합니다. 응답 데이터는 브라우저 저장소에 보관하지 않습니다.
- `Params`와 우측 Inspector는 같은 JSON 바디를 편집합니다. Enter 또는 포커스 이동 시 숫자/문자열/null 타입으로 반영합니다. `Body`는 원문 JSON, `Binding Docs`는 타입·필수 여부·범위를 표시합니다.
- 요청 `Headers`는 BFF에서 업스트림으로 전송하는 고정 Content-Type을 보여줍니다. 임의 헤더 편집과 인증 환경 전환은 지원하지 않습니다. 환경 선택에는 현재 구성된 `Local · Oracle XEPDB1`만 있습니다.
- Send 옆 메뉴에서 실행, **실행하고 소스 고정**, 분석 소스로 열기를 선택합니다. 소스 고정은 현재 바디로 **새로 조회**하고 그 결과를 PostgreSQL 스냅샷에 저장합니다. 이전 응답을 그대로 저장하는 동작이 아닙니다.
- Saved sources는 최근 고정 소스 100개를 보여줍니다. SRC 탭은 읽기 전용이며 API/워크플로우 소스 모두 열 수 있습니다. Analysis 링크는 동일한 스냅샷 ID를 사용합니다.
- 응답은 Table/Body/Headers/Timeline으로 확인합니다. 표는 최대 200행을 미리 표시하고 CSV는 전체 반환 행을 내보냅니다. 0행도 컬럼 스키마가 있으면 헤더를 표시합니다.
- 상태 줄의 시간은 Portal이 측정한 업스트림 호출 및 JSON 읽기 시간입니다. KB는 JSON 본문의 UTF-8 크기이며 HTTP 헤더·전송 압축 크기가 아닙니다. 응답 Headers는 실제 업스트림 콘텐츠 헤더입니다.
- 데스크톱은 쿼리 목록/편집기/Inspector, 태블릿은 목록/편집기, 모바일은 목록 위·편집기 아래 구조입니다. Inspector가 숨겨진 화면에서도 Params로 동일하게 편집합니다.

## 서버 계약

DAC worker:

- `GET /api/dac/queries`: query_id, database_name, 이름/설명, SQL 버전, route, default_body, bindings.
- `POST /api/dac/select/{query_id}`: 저장된 SQL을 Oracle named parameters로 실행.
- 응답: database_name, query_id, query_version, count, data.

Portal:

- 콘솔은 기존 same-origin `POST /api/execute`를 통해 DAC route와 body를 실행합니다.
- `GET /api/workspace/runs?limit=200`: 최근 실행 목록.
- `GET /api/workspace/runs/{runId}`: 나중에 재사용하기 위한 개별 이력 조회(없으면 404).
- DAC select 호출은 execute의 record=false여도 이력을 남깁니다.

콘솔 History는 최근 전체 실행 200건 안의 DAC 쿼리를 표시합니다. PostgreSQL에는 오래된 기록도
유지되며 Run ID로 조회할 수 있습니다. 결과 데이터 자체는 저장하지 않습니다.
JSON 문법 오류로 전송하지 않은 요청과 응답 전에 취소된 요청은 완료 이력에 남지 않을 수 있습니다.

## 저장 구조와 SQL 변경

Oracle `DAC_QUERY_CATALOG`에 SQL_TEXT, DEFAULT_BODY, BINDINGS_JSON, QUERY_VERSION, ENABLED를 저장합니다.
`db/query-catalog.sql`은 EDS_BY_LOT, DEFECT_BY_LOT, LOT_YIELD_SUMMARY를 없는 경우에만 등록합니다.
기존 SQL/기본 바디를 재배포 시 덮어쓰지 않습니다. 관리자가 SQL을 변경할 때 QUERY_VERSION도 증가시켜야 합니다.
SQL 편집·등록 UI는 이번 범위에 포함하지 않습니다.

사용자는 SQL 문자열을 전송하지 않습니다. 등록된 SELECT만 읽기 전용 트랜잭션에서 실행합니다.
SQL 실행 제한 30초, 결과 보호 한도 10,000행입니다. 응답 컬럼은 snake_case로 제공합니다.
바인딩 타입은 string/integer/number이며 nullable, 길이, 숫자 범위를 검증합니다.

PostgreSQL `ws_runs.request` JSONB에 제출한 바디를 보관하고 `query_version`에 성공 응답의 SQL 버전을 기록합니다.
이력을 다시 실행하면 현재 등록된 SQL을 사용합니다. 과거 SQL 본문까지 버전별 보관하는 구조는 아닙니다.

## 검증

- .NET 236개, 프런트엔드 37개 테스트.
- 실제 Oracle/API/이력 통합 검사와 콘솔 브라우저 흐름 검사.
- 브라우저 검사는 멀티탭, 타입 바인딩, 실제 응답 크기/헤더, 이력 복원, 실패 응답,
  소스 저장과 SRC 탭, 새로고침, 1440/1280/768/390px 레이아웃을 포함합니다.

```bash
python3 scripts/dac-query-integration.py
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/dac-query-browser.cjs
```

증거: `artifacts/dac-query-integration.json`, `artifacts/dac-query-browser.json`, `artifacts/console-workbench/`.
