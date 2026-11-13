# GPU / CUDA 최적화 검토

> 이 문서의 기존 2만 점 측정은 샘플링 제거 전의 기록입니다. 현재는 선택한 건수 전체를 처리합니다.
> 현재 동작과 검증은 [전체 데이터 처리](full-data-validation.md)를 참조하세요.


검토일: 2026-11-13. 결론은 **현재 경로에는 렌더링 대량 모드와 조회/전송 최적화를 우선 검증하고,
CUDA는 고비용 수치 분석을 추가할 때 별도 비교한다**입니다. CUDA 가속 효과를 실측한 결과는 없습니다.

## 실제 환경

- GPU: NVIDIA GeForce GTX 1060 6GB, 현재 커널 드라이버 `nouveau`.
- `nvidia-smi`, `nvcc`, NVIDIA Container Toolkit 명령이 없고 `/dev/nvidia*`도 없습니다.
- Docker runtime 목록은 runc 계열이며 GPU 연동을 확인할 환경이 없습니다.
- 현재 Python 환경에 torch/CuPy/cuDF가 설치되어 있지 않습니다.
- 자동 테스트용 Chromium은 ANGLE/SwiftShader이며 Canvas/GPU compositing이 소프트웨어 경로입니다.
  이것은 해당 headless 테스트 브라우저의 상태입니다. 일반 브라우저나 iPad GPU 상태까지 뜻하지 않습니다.

이 때문에 앞선 렌더링 측정은 **소프트웨어 렌더링 환경의 결과**이며, GTX 1060 가속 수치로 해석하면 안 됩니다.
호스트/브라우저 점검 결과는 `artifacts/gpu-host-audit.json`, `artifacts/gpu-browser-audit.json`에 보관했습니다.
GPU 드라이버나 패키지를 설치하거나 재부팅하지 않았으며, 기존 서비스와 앱 설정은 변경하지 않았습니다.

GTX 1060은 compute capability 6.1입니다. 현재 RAPIDS/cuDF 요구 조건은 7.0 이상이고
Pascal 지원은 24.02에서 제거됐으므로, 최신 cuDF를 이 카드에 그대로 적용할 수 없습니다.
[NVIDIA GPU 목록](https://developer.nvidia.com/cuda/gpus/legacy), [RAPIDS 요구 사항](https://docs.nvidia.com/datascience/install/)

PyTorch는 버전과 CUDA 빌드의 조합을 구분해야 합니다. 공식 2.12 문서는 Pascal용 CUDA 12.6 빌드를 안내하며,
2.15부터 CUDA 12.6 배포 제거 공지가 있으므로 단순 최신 설치를 권장하지 않습니다.
적합한 NVIDIA 드라이버·지원 빌드·컨테이너 GPU 노출을 먼저 확인해야 합니다.
[PyTorch 2.12](https://pytorch.org/blog/pytorch-2-12-release-blog/),
[PyTorch 2.15 배포 변경](https://dev-discuss.pytorch.org/t/notice-cuda-12-6-wheels-will-no-longer-be-published-from-pytorch-2-15-drops-maxwell-pascal-volta/3432)

## 현재 코드 경로별 판단

| 경로 | GPU 적합성 / 현재 판단 |
| --- | --- |
| Oracle 조회·샘플링 | DB 안에서 count, ORA_HASH 정렬, 최대 2만 행 선택을 수행합니다. PyTorch를 뒤에 붙여도 앞선 DB 작업이 자동으로 가속되지 않습니다. 실행계획·샘플 순서 사전 계산·인덱스·반복 조회 캐시를 먼저 비교할 후보입니다. |
| Category / Legend 분할 | 현재 반환된 최대 2만 행의 문자열/날짜를 .NET에서 그룹핑합니다. GPU 텐서화·왕복 전송·문자열 인코딩·Python 서비스 경계가 추가되므로 이득은 미검증입니다. 메타데이터 재추론과 JSON 처리 비용도 별도 프로파일 대상입니다. |
| DuckDB join / merge / filter | 현재 소스당 최대 1천 행 제한입니다. GPU로 옮길 우선순위가 낮습니다. 이 경로는 100만 행 조인 벤치마크가 아닙니다. |
| 웹 산점도 | 사용자 브라우저에서 그립니다. 서버 PyTorch/CUDA는 브라우저 ECharts를 자동 가속하지 않습니다. large 모드 또는 별도 WebGL/WebGPU 어댑터가 직접적인 검토 대상입니다. |
| 포인트 라벨 | 현재 JavaScript 텍스트 배치/겹침 계산 비용이 큽니다. 점을 GPU로 그려도 이 단계 전체가 자동으로 빨라지지는 않습니다. 확대 영역/가시 영역 중심 라벨 배치가 후속 후보입니다. |
| SVG / PNG | Node ECharts SVG → Sharp 변환입니다. 현재 코드에는 CUDA 호출 경로가 없습니다. GPU 래스터 렌더러 교체는 SVG 출력의 의미·품질·폰트와 별도로 검증해야 합니다. |
| 향후 분석 | 대규모 반복 수치 변환, 2D density binning, 거리 계산, 이상탐지/모델 추론은 PyTorch/CuPy 등 GPU 실험 후보입니다. 현재 구현되지 않았습니다. |

이 우선순위는 현재 코드와 규모를 근거로 한 판단이며 CPU/GPU 직접 비교 결과는 아닙니다.
NVIDIA도 작은 데이터에서는 전송 비용 때문에 GPU가 더 느릴 수 있다고 설명합니다.
[cuDF 성능 FAQ](https://docs.nvidia.com/cudf/26.08/cudf_pandas/faq/)

## 직접 실행한 대안 실험 — CUDA 사용 안 함

기존 Oracle 데이터 API의 동일한 점을 ECharts 6.1.0 Canvas normal/large 모드로 비교했습니다.
1000×500 차트 하나, 날짜 X, 제품별 시리즈, 6px 점, 라벨 OFF 조건입니다.
각 모드 워밍업 후 5회, 순서를 번갈아 실행한 중앙값이며 HTTP·React·인스턴스 초기화는 제외합니다.
앞선 통합 앱 전체 표시 시간과 직접 비교할 수 없습니다.

| 원본 행 | 실제 표시 점 | 일반 모드 | large 모드 |
| ---: | ---: | ---: | ---: |
| 1,000 | 1,000 | 11.6ms | 6.1ms |
| 10,000 | 10,000 | 107.0ms | 15.2ms |
| 1,000,000 | 20,000 | 210.6ms | 20.7ms |

원본: `artifacts/render-mode-experiment.json`. 총 30회 측정에서 점 수를 확인했고,
large 모드 캡처도 직접 확인했습니다. 2만 점의 그리기 구간은 약 10배 차이가 났지만
DB 조회·전송을 포함한 앱 전체가 10배 빨라진다는 의미는 아닙니다.

**운영 앱에는 아직 적용하지 않았습니다.** 일반/large 모드는 항목별 스타일 등 기능 차이가 있습니다.
도입 전에 포인트 선택, 툴팁, 레전드, 줌, 날짜축, 라벨 ON 전환, 이미지 내보내기의 호환성을 확인하고,
라벨이 없는 대량 데이터에만 사용하는 선택 경로를 만드는 것이 적절합니다.
[ECharts large 옵션](https://raw.githubusercontent.com/apache/echarts-doc/master/en/option/partial/large.md)

## WebGL 후보와 조건

WebGL은 브라우저 쪽 GPU를 사용하므로 원격 접속 시에도 **접속한 기기**의 기능을 확인해야 합니다.
ECharts-GL은 WebGL 가속을 제공하지만 공식 README의 호환성 설명은 GL 2.x / ECharts 5.x입니다.
현재 앱은 ECharts 6.1.0이므로 호환성 검증 없이 바로 교체하면 안 됩니다.
[ECharts-GL 공식 저장소](https://github.com/ecomfe/echarts-gl)

WebGL 실험은 실제 하드웨어 렌더러인지 확인한 브라우저에서 수행해야 합니다.
현재 SwiftShader로 측정해 놓고 이를 GPU 성능이라고 보고하지 않습니다.
중립 ScatterSpec을 유지하고 Canvas와 GPU 어댑터를 비교하면 서비스 데이터 계약은 유지할 수 있습니다.

## CUDA를 시험할 때의 측정 기준

1. 드라이버·PyTorch 빌드·GPU compute capability·컨테이너 노출을 확인합니다.
2. CPU와 GPU에 같은 입력, dtype, 필터, 그룹 정합성과 오차 허용치를 적용합니다.
3. 숫자 배열 변환, CPU→GPU 전송, 커널, GPU→CPU 전송, 직렬화를 각각 측정합니다.
4. GPU 메모리에 상주시킨 반복 계산과, 매 요청 새로 가져오는 현재 방식의 총비용을 별도로 비교합니다.
5. CUDA 연산은 비동기이므로 이벤트/동기화 없이 호출 시간만 재지 않습니다. 워밍업 및 GPU 메모리 피크를 기록합니다.
6. 실제 전체 요청 지연과 처리량이 개선되는 경우에만 서비스 경로에 추가합니다.

[PyTorch CUDA 실행·동기화 문서](https://docs.pytorch.org/docs/2.14/notes/cuda.html)

## 재현

```bash
python3 scripts/gpu-audit.py
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/gpu-browser-audit.cjs
PLAYWRIGHT_MODULE=/tmp/dac-browser/node_modules/playwright node scripts/render-mode-experiment.cjs
```

이 스크립트들은 진단/실험용이며 앱의 기본 렌더러, DB 스키마, 드라이버를 변경하지 않습니다.
