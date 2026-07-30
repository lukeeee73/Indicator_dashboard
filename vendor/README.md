# vendor/ — 자체 호스팅 프론트엔드 라이브러리

예전에는 이 파일들을 `cdn.jsdelivr.net` 에서 받았다. 그런데 CDN 이 막히거나
느린 네트워크에서는 `Chart` 전역이 없는 상태로 `app.js` 가 실행되고,
`new Chart(...)` 가 던지는 예외가 카드 렌더 루프를 통째로 중단시켜
**미국·한국·주식 탭이 안내 메시지도 없이 빈 화면**이 됐다.

정적 사이트이므로 저장소에 그냥 넣어두면 이 실패 지점이 사라진다.
같은 도메인에서 받으므로 추가 DNS·TLS 핸드셰이크도 없다.

## 파일

| 파일 | 패키지 | 버전 | 라이선스 |
|---|---|---|---|
| `chart.umd.js` | [chart.js](https://www.npmjs.com/package/chart.js) | 4.4.1 | MIT |
| `chartjs-plugin-annotation.min.js` | [chartjs-plugin-annotation](https://www.npmjs.com/package/chartjs-plugin-annotation) | 3.0.1 | MIT |
| `marked.min.js` | [marked](https://www.npmjs.com/package/marked) | 12.0.2 | MIT |

각 패키지의 라이선스 전문은 `*-LICENSE.md` 로 함께 두었다.
모두 npm 레지스트리 배포본을 그대로 복사한 것이며 수정하지 않았다.

## 버전 올리는 방법

```sh
npm pack chart.js@<버전>
tar xzf chart.js-<버전>.tgz
cp package/dist/chart.umd.js vendor/chart.umd.js
cp package/LICENSE.md        vendor/chart.js-LICENSE.md
```

`chart.umd.js` 는 npm 배포본에 최소화(minify) 버전이 없어 원본을 쓴다.
Vercel 이 gzip 으로 전송하므로 실제 전송량은 60KB 남짓이다.
버전을 바꾸면 `index.html` 의 `<script src>` 도 함께 확인한다.
