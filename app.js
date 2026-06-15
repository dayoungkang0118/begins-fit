const STORAGE_KEY = "begins-fit-requests";
const ADMIN_SESSION_KEY = "begins-fit-admin-session";
const ADMIN_ID = "begins";
const ADMIN_PASSWORD = "2026";
const DRAWING_DB_NAME = "begins-fit-drawings";
const DRAWING_STORE_NAME = "files";
const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const GOOGLE_SHEETS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbz6PVd1PzAL9JK_S8i5fzWsV3S5F3ZCakP2Q_FrZilKDBM27uYU3HVsX_JStVGk8CGRPw/exec";

const statusOptions = [
  "신청 접수",
  "도면 수급",
  "테스트핏 작업",
  "전달 완료",
  "견적 상담",
  "견적 제출",
  "계약 성공",
  "보류",
];

const sampleRequests = [
  {
    clientName: "이서준",
    phone: "010-2488-1024",
    company: "에이치랩스",
    industry: "IT 소프트웨어",
    moveIn: "2026년 8월 마지막 주",
    seatCount: "24",
    deskSize: "1400×700mm",
    property: "문정 지식산업센터 A동 1201호",
    partnerName: "문정 A부동산 김대표",
    needs: ["대표실", "회의실", "오픈 업무공간", "탕비실"],
    meetingCapacity: "6",
    meetingCount: "2",
    usageTypes: ["방문객과 직원 동선 분리", "온라인 회의와 통화가 잦음"],
    drawingSource: "부동산에서 받기",
    drawingFiles: [],
    memo: "회의실 2개와 24석 가능 여부 확인 필요",
    status: "도면 수급",
    createdAt: "2026-06-10",
  },
  {
    clientName: "박하린",
    phone: "010-3100-7771",
    company: "바디웍스",
    industry: "유통",
    moveIn: "2026년 9월 둘째 주",
    seatCount: "8",
    deskSize: "1200×600mm",
    property: "가산 B타워 806호",
    partnerName: "가산 오피스부동산",
    needs: ["대표실", "회의실", "쇼룸"],
    meetingCapacity: "4",
    meetingCount: "1",
    usageTypes: ["보안과 출입 통제 중요", "부서별 공간 구분"],
    drawingSource: "직접 업로드",
    drawingFiles: [],
    memo: "쇼룸과 업무공간을 함께 검토",
    status: "견적 상담",
    createdAt: "2026-06-10",
  },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  requests: load(STORAGE_KEY, []),
  isAdmin: sessionStorage.getItem(ADMIN_SESSION_KEY) === "true",
};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.requests));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `fit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDrawingDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAWING_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAWING_STORE_NAME)) {
        database.createObjectStore(DRAWING_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDrawingFiles(requestId, files) {
  if (!files.length) return [];
  const database = await openDrawingDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAWING_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DRAWING_STORE_NAME);
    const metadata = files.map((file, index) => {
      const record = {
        id: `${requestId}-${index}-${createId()}`,
        requestId,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: file,
      };
      store.put(record);
      return {
        id: record.id,
        name: record.name,
        type: record.type,
        size: record.size,
      };
    });

    transaction.oncomplete = () => {
      database.close();
      resolve(metadata);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function downloadDrawingFile(fileId) {
  const database = await openDrawingDatabase();
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAWING_STORE_NAME, "readonly");
    const request = transaction.objectStore(DRAWING_STORE_NAME).get(fileId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();

  if (!record) {
    showToast("이 브라우저에 저장된 파일을 찾을 수 없습니다.");
    return;
  }

  const url = URL.createObjectURL(record.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = record.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function sendRequestToGoogleSheets(request, files) {
  if (!GOOGLE_SHEETS_WEB_APP_URL) return;

  const emailAttachments = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type || "application/octet-stream",
      base64: await readFileAsBase64(file),
    })),
  );

  const payload = {
    ...request,
    drawingFiles: (request.drawingFiles || []).map((file) => file.name),
    emailAttachments,
  };

  await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function activateView(viewName) {
  if (viewName === "admin" && !state.isAdmin) {
    openLoginModal();
    showToast("관리자 로그인이 필요합니다.");
    return;
  }

  $$(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${viewName}View`).classList.add("active");
  $(".main").classList.toggle("about-active", viewName === "about");
}

function initNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      activateView(button.dataset.view);
    });
  });

  $$("[data-go-request]").forEach((button) => {
    button.addEventListener("click", () => {
      activateView("request");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function initAdminAuth() {
  $("#adminLoginButton").addEventListener("click", openLoginModal);
  $("#loginCloseButton").addEventListener("click", closeLoginModal);
  $("#loginModal").addEventListener("click", (event) => {
    if (event.target.id === "loginModal") closeLoginModal();
  });
  $("#adminLogoutButton").addEventListener("click", () => {
    state.isAdmin = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    renderAdminAccess();
    activateView("request");
    showToast("관리자에서 로그아웃했습니다.");
  });

  $("#adminLoginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const adminId = form.get("adminId").trim();
    const adminPassword = form.get("adminPassword").trim();

    if (adminId !== ADMIN_ID || adminPassword !== ADMIN_PASSWORD) {
      showToast("아이디 또는 비밀번호가 맞지 않습니다.");
      return;
    }

    state.isAdmin = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    event.currentTarget.reset();
    closeLoginModal();
    renderAdminAccess();
    activateView("admin");
    showToast("관리자 화면에 접속했습니다.");
  });

  renderAdminAccess();
}

function openLoginModal() {
  $("#loginModal").classList.remove("hidden");
  window.setTimeout(() => $("#adminLoginForm input[name='adminId']").focus(), 0);
}

function closeLoginModal() {
  $("#loginModal").classList.add("hidden");
}

function renderAdminAccess() {
  $$(".admin-only").forEach((element) => element.classList.toggle("hidden", !state.isAdmin));
  $("#adminLoginButton").classList.toggle("hidden", state.isAdmin);
  $("#adminLogoutButton").classList.toggle("hidden", !state.isAdmin);
}

function initPartnerFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const partner = params.get("partner");
  if (!partner) return;

  const decoded = decodeURIComponent(partner);
  $("#partnerBadge").textContent = `${decoded} 소개`;
  $("#partnerNameInput").value = decoded;
}

function initRequestForm() {
  const fileInput = $("#drawingFiles");
  const fileList = $("#fileList");
  const fileHelp = $("#fileHelp");
  const meetingRoomCheck = $("#meetingRoomCheck");
  const meetingDetail = $("#meetingDetail");
  const meetingCapacity = $("#meetingCapacity");
  const meetingCount = $("#meetingCount");

  meetingRoomCheck.addEventListener("change", () => {
    meetingDetail.classList.toggle("hidden", !meetingRoomCheck.checked);
    meetingCapacity.required = meetingRoomCheck.checked;
    meetingCount.required = meetingRoomCheck.checked;
    if (!meetingRoomCheck.checked) {
      meetingCapacity.value = "";
      meetingCount.value = "";
    }
  });

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files);
    fileList.innerHTML = files.length
      ? files.map((file) => `<span>${escapeHtml(file.name)} · ${formatFileSize(file.size)}</span>`).join("")
      : "";
  });

  $$("input[name='drawingSource']").forEach((input) => {
    input.addEventListener("change", () => {
      const directUpload = input.checked && input.value === "직접 업로드";
      if (directUpload) {
        fileHelp.textContent =
          "직접 업로드를 선택하면 도면 파일을 1개 이상 첨부해야 합니다. 전체 15MB 이하";
        fileInput.setAttribute("required", "");
      } else if (input.checked) {
        fileHelp.textContent = "도면은 소개 부동산에서 비긴에스로 전달합니다.";
        fileInput.removeAttribute("required");
      }
    });
  });

  $("#requestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request = Object.fromEntries(form.entries());
    const files = Array.from(fileInput.files);
    const totalFileSize = files.reduce((total, file) => total + file.size, 0);

    if (request.drawingSource === "직접 업로드" && !files.length) {
      showToast("도면 파일을 1개 이상 첨부해주세요.");
      fileInput.focus();
      return;
    }

    if (totalFileSize > MAX_EMAIL_ATTACHMENT_BYTES) {
      showToast("첨부파일 전체 용량은 15MB 이하로 올려주세요.");
      fileInput.focus();
      return;
    }

    request.needs = form.getAll("needs");
    request.usageTypes = form.getAll("usageTypes");
    request.status = "신청 접수";
    request.createdAt = today();
    request.id = createId();
    delete request.drawingFiles;
    delete request.consent;

    try {
      request.drawingFiles = await storeDrawingFiles(request.id, files);
    } catch {
      showToast("도면 파일 저장에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    state.requests.unshift(request);
    save();

    let sheetsSynced = true;
    try {
      await sendRequestToGoogleSheets(request, files);
    } catch {
      sheetsSynced = false;
    }

    renderAll();
    event.currentTarget.reset();
    fileList.innerHTML = "";
    fileInput.removeAttribute("required");
    fileHelp.textContent = "직접 업로드를 선택하면 도면 파일을 첨부해주세요. 전체 15MB 이하";
    meetingDetail.classList.add("hidden");
    meetingCapacity.required = false;
    meetingCount.required = false;
    initPartnerFromUrl();
    showToast(
      sheetsSynced
        ? "테스트핏 신청이 접수되었습니다."
        : "신청은 저장됐지만 구글시트 연동에 실패했습니다.",
    );
  });
}

function initSeedButton() {
  $("#seedButton").addEventListener("click", () => {
    const seeded = sampleRequests.map((request) => ({
      ...request,
      id: createId(),
    }));
    state.requests = [...seeded, ...state.requests];
    save();
    renderAll();
    showToast("샘플 요청 2건을 추가했습니다.");
  });
}

function renderRequests() {
  const table = $("#requestTable");
  if (!state.requests.length) {
    table.innerHTML = `
      <tr>
        <td class="empty-row" colspan="7">아직 접수된 테스트핏 요청이 없습니다.</td>
      </tr>
    `;
    return;
  }

  table.innerHTML = state.requests
    .map(
      (request) => `
        <tr>
          <td>
            <strong>${escapeHtml(request.clientName)}</strong>
            <small>${escapeHtml(request.company || "회사명 미입력")} · ${escapeHtml(request.industry || "업종 미입력")}</small>
            <small>${escapeHtml(request.phone)} · 입주 ${escapeHtml(request.moveIn || "미정")}</small>
            <small>좌석 ${escapeHtml(request.seatCount || request.headcount || "-")}석 · 책상 ${escapeHtml(request.deskSize || "미정")}</small>
          </td>
          <td>
            ${escapeHtml(request.property)}
          </td>
          <td>${escapeHtml(request.partnerName || "직접 신청")}</td>
          <td>
            ${escapeHtml((request.needs || []).join(", ") || "미입력")}
            ${
              (request.needs || []).includes("회의실")
                ? `<small>회의실 ${escapeHtml(request.meetingCapacity || "-")}인용 × ${escapeHtml(request.meetingCount || "-")}개</small>`
                : ""
            }
            ${
              (request.usageTypes || []).length
                ? `<small>사용 방식: ${escapeHtml(request.usageTypes.join(", "))}</small>`
                : ""
            }
          </td>
          <td>
            <strong>${escapeHtml(request.drawingSource || "미선택")}</strong>
            ${
              (request.drawingFiles || []).length
                ? `<div class="admin-file-list">${request.drawingFiles
                    .map(
                      (file) =>
                        `<button type="button" class="file-download" data-file-id="${file.id}">${escapeHtml(file.name)}</button>`,
                    )
                    .join("")}</div>`
                : "<small>첨부 파일 없음</small>"
            }
          </td>
          <td>
            <select data-request-id="${request.id}" aria-label="진행 상태">
              ${statusOptions
                .map(
                  (status) =>
                    `<option value="${status}" ${request.status === status ? "selected" : ""}>${status}</option>`,
                )
                .join("")}
            </select>
          </td>
          <td>${escapeHtml(request.memo || "-")}</td>
        </tr>
      `,
    )
    .join("");

  $$("select[data-request-id]").forEach((select) => {
    select.addEventListener("change", () => {
      const target = state.requests.find((request) => request.id === select.dataset.requestId);
      if (!target) return;
      target.status = select.value;
      save();
      renderMetrics();
      showToast("진행 상태를 업데이트했습니다.");
    });
  });

  $$(".file-download").forEach((button) => {
    button.addEventListener("click", () => downloadDrawingFile(button.dataset.fileId));
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMetrics() {
  $("#requestCount").textContent = state.requests.length;
  $("#metricNew").textContent = state.requests.filter((request) => request.status === "신청 접수").length;
  $("#metricPlan").textContent = state.requests.filter((request) => request.status === "도면 수급").length;
  $("#metricEstimate").textContent = state.requests.filter((request) =>
    ["견적 상담", "견적 제출", "계약 성공"].includes(request.status),
  ).length;
}

function renderAll() {
  renderMetrics();
  renderRequests();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

initNavigation();
initAdminAuth();
initPartnerFromUrl();
initRequestForm();
initSeedButton();
renderAll();
