/* ============================================================
 * Luke Dashboard — 통화 가치·환율·물가
 *
 * 역할:
 *   1. Supabase 에서 지표·자산·종목·지수 데이터를 조회
 *   2. 각 지표를 카드 + Chart.js 라인 차트로 렌더링
 *   3. 최신값 / 최근 변화 / 카테고리별 분류 표시
 *
 * 원칙: "해석과 판단은 수동"
 *   - 각 지표의 수치와 추세만 중립적으로 보여준다
 * ============================================================ */

// index.html loads js/ foundations and feature scripts before this entry point.
// Keep classic scripts in that order: inline handlers use the existing global functions.
// Modules register behavior only; DOMContentLoaded opens Korea and starts the indicator data load.
document.addEventListener("DOMContentLoaded", () => {
  // 탭 버튼 이벤트 연결 — 데이터 로드 실패와 무관하게 탭 전환은 항상 동작
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
  });
  initSidebar();
  wireEventsToggle();   // 체크박스는 데이터와 무관 — 먼저 연결한다
  // 첫 화면은 한국의 원화 가치·환율
  switchToTab("KR");
  loadDashboardData();
  renderRateReports();  // 정적 리포트 파일 — 지표 데이터 로드와 독립
});
