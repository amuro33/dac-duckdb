# 전체 데이터 차트의 시간 표시와 최적화

2026-11-13 통합 앱 `/#analysis` 적용. 샘플링, 행 제한, 점 집계는 추가하지 않았습니다.

## 화면의 측정 기준

- **조회 · 수신**: 실행부터 BFF 응답의 JSON 해석 완료까지 브라우저 `performance.now()`로 측정합니다. 서버 처리·HTTP 전송·클라이언트 JSON 해석이 포함됩니다.
- **현재 페이지 그리기**: 응답 수신 후 React 갱신부터 현재 페이지의 마지막 차트가 ECharts `finished` 이벤트와 두 번의 `requestAnimationFrame`을 완료할 때까지의 벽시계 시간입니다. 서로 겹치는 개별 차트 시간을 합산하지 않습니다.
- **전체 표시**: 실행부터 위 완료 시점까지입니다. 옵션 변경/페이지 이동은 해당 동작을 시작한 시점부터 계산하며 `재조회 없음`을 표시합니다.
- 차트 아래의 **그리기**: 해당 인스턴스의 초기화/옵션 준비 시작부터 `finished`까지입니다. 상단 페이지 시간과 측정 범위가 다릅니다.
- 표시된 점 수는 `현재 페이지 / 전체 결과`입니다. 10개 카테고리 중 4개를 표시하면 100만 점 중 40만 점의 렌더 시간입니다. 나머지는 페이지 이동 시 모두 그립니다.
- 최근 서버 처리 시간은 BFF의 마지막 실제 요청 측정값입니다. 스타일 변경 때 새로운 서버 시간으로 꾸미지 않습니다.

`finished`는 점진적 렌더링 완료를 기다립니다([ECharts 이벤트 명세](https://github.com/apache/echarts-doc/blob/master/en/api/events.md)). 두 프레임 대기는 브라우저가 표시할 기회를 주기 위한 것입니다. 물리적 디스플레이 출력 시점, GPU 실행 시간, FPS를 측정하지는 않습니다. 백그라운드 탭에서는 프레임 제한 때문에 느려질 수 있습니다. 확대 모달은 자체 차트 시간만 표시하고 페이지 집계에 섞지 않습니다. 줌/범례 조작·리사이즈는 마지막 실행 측정값을 덮어쓰지 않습니다.

요청 실패는 이전 정상 결과와 측정값을 유지하고 오류를 표시합니다. 차트 생성 실패는 `그리기 실패`로 표시합니다. 이전 페이지/요청의 늦은 완료 이벤트는 batch ID로 배제합니다. 데이터 탭/빈 결과는 완료 시간을 만들어내지 않습니다.

## 적용한 최적화

1. **스타일 변경 시 데이터 재사용**: 포인트 크기와 라벨 폰트만 바뀌면 재조회 없이 기존 좌표로 갱신합니다. 축·그룹·필터·규모·라벨 데이터가 바뀌면 반드시 다시 조회합니다. 설정이 같은 상태에서 실행하면 명시적인 새로고침으로 처리합니다.
2. **ECharts 인스턴스 재사용**: 스타일은 series ID별 부분 업데이트로 반영합니다. 차트를 매번 dispose/init하지 않고 기존 zoom/legend 모델을 유지합니다. 제거될 때만 dispose합니다.
3. **Float64Array 좌표**: 라벨 없는 숫자/날짜 축은 연속된 2차원 버퍼를 사용합니다. 좌표당 16 bytes이며 밀리초 날짜와 double Y 값을 보존합니다. 100만 점 전수 일치 테스트를 포함했습니다. 문자열/라벨은 기존 배열 경로로 처리합니다. 버퍼는 좌표 배열 기준 WeakMap으로 재사용하며 해당 데이터가 해제되면 회수할 수 있습니다. 이는 전체 브라우저 메모리 사용량이 16MB라는 뜻은 아닙니다.
4. **리사이즈 중복 억제**: 실제 크기가 변한 경우만 animation frame으로 합쳐 resize합니다.
5. 기존 Canvas large/progressive와 4개 독립 DOM 페이지 방식을 유지합니다. 점의 수나 좌표를 줄이는 최적화는 없습니다.

## 관측 결과

같은 머신의 headless Chromium, 날짜 X축, 기본 포인트 크기에서 실행했습니다. 각 경우 1회 관측이며 통계적 성능 보장이 아닙니다. 1천·10만 조회 검사 일부는 별도의 짧은 상호작용 검사와 겹쳤습니다. 이 환경의 브라우저는 SwiftShader 소프트웨어 렌더러이며 사용자 iPad/데스크톱 GPU 성능을 대표하지 않습니다.

| 원본 선택 건수 | 현재 페이지 점 수 | 조회·수신 | 페이지 그리기 | 전체 표시 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 400 | 13.9 ms | 41.0 ms | 55.0 ms |
| 100,000 | 40,000 | 926.4 ms | 50.3 ms | 976.7 ms |
| 1,000,000 | 400,000 | 20.42초 | 241.1 ms | 20.66초 |

카테고리를 선택하지 않고 **한 차트에 100만 점 전부**를 그린 별도 검사에서는 조회·수신 19.674초, 그리기 637.2ms, 전체 표시 20.311초였습니다. 실제 응답의 1개 카테고리/100만 점과 그리기 완료를 함께 확인했습니다.

100만 건을 받은 뒤 **포인트 크기를 7px로 변경**하는 브라우저 자동화 경과 시간은 **20.963초 → 0.813초**, scatter API 요청은 **1회 → 0회**였습니다. 앱 자체 표시 시간은 780.0ms입니다. 자동화 시간에는 클릭 준비/완료 확인 비용도 들어갑니다. 커진 포인트는 기본 크기보다 그리는 면적이 커서 렌더 시간이 더 들 수 있습니다.

첫 조회 전체 시간은 변경 전 20.399초, 변경 후 20.714초였습니다. 이번 작업으로 최초 조회 병목이 해결됐다고 주장하지 않습니다. 관측상 다음 최적화 대상은 조회·변환·전송/JSON 해석 구간입니다. 내부 단계별 계측 후 Oracle 조회, 100개 내부 페이지 왕복, 직렬화 비용을 분리해야 합니다. 바이너리/스트리밍 전송은 API 계약과 오류 처리를 함께 설계해야 하므로 이번 UI 변경에 포함하지 않았습니다. CUDA는 이 브라우저 표시 경로의 직접적인 해결책이 아닙니다.

## 검증과 재현

- 프런트 유닛 테스트 21개: 기존 CSV 5개 및 새 시간 집계/재사용 경계/좌표 보존 16개.
- 실제 브라우저 시간 표시 9개: 1천/1만/10만, 스타일 무조회·인스턴스 유지, 명시적 재조회, 페이지/탭 전환, 모바일, 문자열/라벨, 실패 상태, 런타임 오류.
- 차트 옵션 6개: 선택 라벨, PNG/SVG, 저장 뷰 복원, 모바일, 런타임 오류.
- 대량 상호작용 3개: 카테고리별 점 수, 실제 날짜 포인트 클릭, 오류 없음.
- 100만 건의 일반 조회/스타일 변경 비교 및 단일 카테고리 100만 점 렌더링을 별도 검사했습니다.

```bash
npm test --prefix src/Portal.Web
npm run build --prefix src/Portal.Web
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/chart-timing-browser.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/chart-timing-comparison.cjs after
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/chart-million-single.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/full-data-interaction.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/chart-options-browser.cjs
```

증거: `artifacts/chart-timing-before.json`, `chart-timing-after.json`, `chart-timing-browser.json`, `chart-million-single.json`, `chart-million-single.png`.

GitHub에 포함한 선별 측정 원본: [before](evidence/chart-timing-before.json), [after](evidence/chart-timing-after.json), [단일 100만 점](evidence/chart-million-single.json), [브라우저 검증](evidence/chart-timing-browser.json). 나머지 artifacts는 재실행 시 생성됩니다.
