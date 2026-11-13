# 샘플링 제거 및 전체 데이터 검증

2026-11-13 적용. **1천·1만·10만·100만 선택 범위 전체를 처리합니다.**
기존의 ORA_HASH 순서 선택과 최대 2만 행 제한은 제거했습니다.

## 처리 방식

- 원본은 SAMPLE_ID <= 선택 건수 및 사용자가 지정한 Lot 조건으로 조회합니다.
- raw `/api/dac/chart_samples`의 기본 응답은 전체입니다. ID 순서로 비동기 직렬화합니다.
- 명시적 `limit`/`afterId`는 페이지 조회입니다. `hasMore`가 남은 행 여부를 알려줍니다.
- 차트 서비스는 1만 행씩 내부 전송하되 마지막 페이지까지 읽습니다. 페이지 건수는 샘플 수가 아닙니다.
- 모든 페이지의 Category/Legend 그룹을 합치며, 날짜/숫자 X는 전체 시리즈 기준으로 정렬합니다.
- 전체 건수 불일치, 중복/후진 커서는 오류입니다. 일부 행만 성공 결과로 내보내지 않습니다.
- 호환 필드 `sampleSize`는 합성 데이터의 선택 규모입니다. `sampledOutRows=0`, `sampling="none"`입니다.
- 사용자 Lot 필터와 잘못된/null X/Y 제외는 유지합니다. 필터 후 `원본 행 = 표시 포인트 + 결측 제외`입니다.
- 기존 기본 EDS/defect API와 DuckDB transform의 별도 1천 행 조회 한도는 이 테스트 테이블의 샘플링과 무관합니다.

라벨이 없는 대량 차트는 ECharts Canvas large 모드로 그립니다. 이는 그리기 작업을 묶는 처리이며 점을
버리거나 집계하는 방식이 아닙니다. 카테고리 화면은 4개씩 페이지 이동하지만 각 차트 안에는 해당 범주의 모든 점이 있습니다.
라벨을 켜면 기존 일반 렌더러를 사용합니다. 전체 백만 라벨/단일 차트의 응답성과 자원 사용량은 이번 검증 범위가 아닙니다.

## 실제 건수와 시간

통합 앱 BFF 경유, 원본 조회·차트 변환·HTTP 전송까지 한 번씩 측정했습니다. 브라우저 렌더링은 제외합니다.

| 선택 원본 | 실제 반환 포인트 | 응답 수신 완료 | 응답 크기 |
| ---: | ---: | ---: | ---: |
| 1,000 | 1,000 | 0.15초 | 21,180 bytes |
| 10,000 | 10,000 | 0.28초 | 198,541 bytes |
| 100,000 | 100,000 | 1.49초 | 2,062,329 bytes |
| 1,000,000 | 1,000,000 | 19.45초 | 21,599,927 bytes |

100만 점은 약 19초 걸렸습니다. 이전의 약 0.5초 결과는 2만 점 표본에 대한 값이므로 직접 같은 작업으로 비교할 수 없습니다.
이 표는 로컬 단일 관측값입니다. 출처: `artifacts/full-data-scale.json`.

## 검증 결과

- .NET **125개 통과**: 페이지 병합·전체 정렬·결측 분리·부족한 페이지 거부·커서 진행 검증 포함.
- 실제 데이터 검사 **42개 통과**: 네 규모의 전체 건수, 모든 EDS ID의 유일성과 범위, 결함/조인 100만 점, Lot 필터의 전체 10만 점.
- 통합 앱 브라우저 검사 **28개 통과**: 백만 원본/백만 포인트 표시, 독립 차트 페이지 이동, 기존 저장·콘솔·이력 기능.
- 원본 API/페이지/내보내기 검사 **7개 통과**: raw API 기본 응답의 ID 1..1,000,000 전수 확인, 333행 페이지의 누락 없음, PNG, HTML 전체 점 수.
- 대량 모드 상호작용 **3개 통과**: 카테고리별 전체 점 수, 실제 날짜/Y 포인트 클릭, 런타임 오류 없음.
- 기존 Chart Lab: 네 규모 전체 건수, PNG, 모바일 레이아웃, 브라우저 예외 없음.

100만 원본의 PNG는 선택 카테고리 전체 10만 점으로 생성했으며 약 20.4초가 걸렸습니다.
HTML에는 전체 100만 점이 들어 있으며 약 19.5초, 파일 크기는 약 29.8MB입니다.
렌더러에 이미지용 선택 카테고리만 전달해 필요 없는 다른 카테고리의 메모리 사용을 줄였습니다.

차트/포털 메모리 한도는 각 2GiB, 렌더러는 3GiB로 조정했습니다. 실행 동시성은 2개로 제한하며,
타임아웃은 BFF 240초/게이트웨이 300초로 늘렸습니다. 이번 검사 동안 Pod 재시작이나 OOM은 관측되지 않았습니다.
이는 무제한 동시 실행이나 모든 축·라벨 설정 조합에 대한 보장이 아닙니다.

## 증거와 재현

- `artifacts/benchmark-integration.json`
- `artifacts/portal-browser.json`
- `artifacts/full-data-exports.json`, `artifacts/full-data.png`, `artifacts/full-data.html`
- `artifacts/benchmark-browser.json`, `artifacts/full-data-scale.json`

```bash
./scripts/test.sh
python3 scripts/portal-scale-check.py
python3 scripts/benchmark-integration.py
python3 scripts/full-data-export-check.py
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/portal-browser-test.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/benchmark-browser-test.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/full-data-interaction.cjs
```

기존 성능 문서의 2만 점 표는 변경 전 기록으로 남깁니다. `artifacts/`의 일반 검증 파일은 재실행 시 최신 결과로 갱신됩니다.
