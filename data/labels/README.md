# `data/labels/` — 자동판정 백테스트용 정답지

이 폴더의 JSON 들은 **모델이 아니라 정답** 이다. 4분면 자동판정 로직(현재 그리고 향후
업그레이드 버전)이 얼마나 빠르고 정확한지 채점할 때 기준으로 사용한다.

객관성 원칙:

1. **손으로 고르지 않는다.** 모든 episode 는 (a) 외부 권위 기관의 공식 발표를
   그대로 전사하거나, (b) 사전 등록된 규칙을 데이터에 적용해 자동 생성한다.
2. **사전 등록(pre-registered).** 라벨 생성 규칙·임계는 모델 평가 결과를 보기
   전에 결정한다. 결과를 본 뒤 임계를 바꾸면 라벨이 모델에 맞게 휘어진다.
3. **재현 가능.** `us_inflation_episodes.json` 은 `scripts/build_labels.py` 를
   다시 돌리면 비트 단위로 동일하게 생성되어야 한다.

---

## 파일

### `us_recessions.json`

미국 침체 정답지. **NBER Business Cycle Dating Committee** 공식 발표를 손으로
전사한 정적 파일.

- 출처: <https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions>
- NBER 합의 규칙:
  - `peak`  = 확장의 마지막 달 (이 달은 *확장* 으로 분류)
  - `trough` = 수축의 마지막 달 (이 달은 *침체* 로 분류)
  - 따라서 침체 구간 = `[peak + 1개월, trough]` (양 끝 inclusive)

NBER 가 후일 dates 를 정정하면 이 파일을 업데이트해야 한다.

### `us_inflation_episodes.json`

미국 고인플레이션 국면 정답지. `scripts/build_labels.py` 가 4개의 사전 등록 규칙을
FRED 시계열(`CPIAUCSL`, `CPILFESL`, `PCEPI`)에 적용해 생성한다.

규칙 요약:

| ID | 시리즈 | 임계 | 최소 지속 |
|---|---|---|---|
| `headline_5pct`   | CPI YoY      | ≥ 5.0% (절대)             | 6개월 |
| `core_4pct`       | Core CPI YoY | ≥ 4.0% (절대)             | 6개월 |
| `pce_3pct_long`   | PCE YoY      | ≥ 3.0% (Fed 목표 +1pp)    | 12개월 |
| `relative_top25`  | CPI YoY      | ≥ 75 백분위 (1948- 분포)  | 6개월 |

`consensus.episodes` = **2개 이상 규칙이 동시에 켜진 채로 6개월 이상 지속된 구간**.
백테스트에서 "정답 인플레 국면"을 단일 라벨로 받고 싶다면 이 consensus 를 쓰면
된다. 단일 규칙 결과도 robustness check 용으로 함께 보존한다.

규칙·임계가 자의적으로 보일 수 있으나:
- 5%/4%/3% 는 Fed 의 2% 목표 대비 명백한 위반(2.5x / 2x / 1.5x)이고
- 75 백분위는 데이터 자체로 정의되는 상대 기준이며
- "≥6개월 지속" 은 일시 노이즈를 제거하기 위한 최소 조건이다.

이들은 **결과를 보고 조정하지 않는다**. 만약 향후 다른 임계를 시험하고 싶다면
별도 파일(`us_inflation_episodes_v2.json` 등)로 추가하고 `methodology` 필드에
변경 이력을 명시한다.

---

## 라벨 → 이진 라벨 변환 (참고)

평가 코드에서 월 단위 boolean 시계열로 펴서 쓸 때:

```python
# 침체
recession_months = []
for ep in us_recessions["episodes"]:
    p = pd.Period(ep["peak"], freq="M") + 1   # peak+1
    t = pd.Period(ep["trough"], freq="M")
    recession_months += list(pd.period_range(p, t, freq="M"))

# 인플레 (consensus)
infl_months = []
for ep in us_inflation_episodes["consensus"]["episodes"]:
    s = pd.Period(ep["start"], freq="M")
    e = pd.Period(ep["end"],   freq="M")
    infl_months += list(pd.period_range(s, e, freq="M"))
```
