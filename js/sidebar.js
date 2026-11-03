// Responsive sidebar controls and persisted desktop collapse preference.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ════════════════════════════════════════════════════════════════
// 사이드바 — 열기/닫기
//   데스크톱: 접힌 상태를 localStorage 에 저장, ☰ 플로팅 버튼으로 복원
//   모바일(≤900px): 드로어 방식 — ☰ 로 열고, 배경/탭 선택/✕ 로 닫기
// ════════════════════════════════════════════════════════════════
const SIDEBAR_LS_KEY = "lukeDashSidebarCollapsed";

function sbGetCollapsed() {
  try { return localStorage.getItem(SIDEBAR_LS_KEY) === "1"; } catch { return false; }
}
function sbSetCollapsed(v) {
  try { localStorage.setItem(SIDEBAR_LS_KEY, v ? "1" : "0"); } catch { /* private mode 등 */ }
}

function initSidebar() {
  const openBtn  = document.getElementById("sidebar-open");
  const closeBtn = document.getElementById("sidebar-close");
  const backdrop = document.getElementById("sidebar-backdrop");
  const nav      = document.querySelector(".sidebar-nav");
  if (!openBtn || !closeBtn || !backdrop) return;

  const mq = window.matchMedia("(max-width: 900px)");

  function apply() {
    if (mq.matches) {
      // 모바일: transform 드로어 — 닫혀 있을 때만 ☰ 버튼 표시
      const open = document.body.classList.contains("sb-mobile-open");
      openBtn.hidden = open;
      backdrop.hidden = !open;
    } else {
      document.body.classList.remove("sb-mobile-open");
      backdrop.hidden = true;
      const collapsed = sbGetCollapsed();
      document.body.classList.toggle("sb-collapsed", collapsed);
      openBtn.hidden = !collapsed;
    }
  }

  openBtn.addEventListener("click", () => {
    if (mq.matches) document.body.classList.add("sb-mobile-open");
    else sbSetCollapsed(false);
    apply();
  });
  closeBtn.addEventListener("click", () => {
    if (mq.matches) document.body.classList.remove("sb-mobile-open");
    else sbSetCollapsed(true);
    apply();
  });
  backdrop.addEventListener("click", () => {
    document.body.classList.remove("sb-mobile-open");
    apply();
  });
  // 모바일 드로어에서 탭을 고르면 자동으로 닫는다
  if (nav) {
    nav.addEventListener("click", (e) => {
      if (mq.matches && e.target.closest(".tab-btn")) {
        document.body.classList.remove("sb-mobile-open");
        apply();
      }
    });
  }
  mq.addEventListener("change", apply);
  apply();
}
