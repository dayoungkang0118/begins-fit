const STORAGE_KEY = "begins-fit-requests";
const ADMIN_SESSION_KEY = "begins-fit-admin-session";
const ADMIN_ID = "begins";
const ADMIN_PASSWORD = "2026";
const DRAWING_DB_NAME = "begins-fit-drawings";
const DRAWING_STORE_NAME = "files";
const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const PUBLIC_REQUEST_BASE_COUNT = 32;
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

const deskCriteria = {
  "1200x600": { label: "1200×600mm", areaPerSeat: 1.95, aisle: "900~1000mm" },
  "1400x700": { label: "1400×700mm", areaPerSeat: 2.25, aisle: "1000~1200mm" },
  "1600x800": { label: "1600×800mm", areaPerSeat: 2.65, aisle: "1100~1300mm" },
  "1800x800": { label: "1800×800mm", areaPerSeat: 3.0, aisle: "1200~1500mm" },
};

const densityAdjustments = {
  compact: { label: "효율형", value: -0.18 },
  standard: { label: "표준형", value: 0 },
  roomy: { label: "여유형", value: 0.28 },
};

const executiveCriteria = {
  none: { label: "대표실 없음", area: 0 },
  small: { label: "소형 대표실", area: 5 },
  standard: { label: "일반 대표실", area: 7 },
  meeting: { label: "미팅 겸용 대표실", area: 9.5 },
};

const pantryCriteria = {
  simple: { label: "커피존", area: 2 },
  standard: { label: "싱크/냉장고/수납", area: 3.5 },
  dining: { label: "식사 가능한 탕비실", area: 5.5 },
};

const storageCriteria = {
  low: { label: "수납 적음", area: 1.5 },
  medium: { label: "수납 보통", area: 3 },
  high: { label: "수납 많음", area: 5 },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  requests: load(STORAGE_KEY, []),
  isAdmin: sessionStorage.getItem(ADMIN_SESSION_KEY) === "true",
  fitFloorPlan: {
    dataUrl: "",
    name: "",
  },
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

function initFitCalculator() {
  $("#fitCalculatorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    renderFitCalculation();
  });

  $("#fitRequestSelect").addEventListener("change", (event) => {
    const request = state.requests.find((item) => item.id === event.target.value);
    if (!request) return;
    fillCalculatorFromRequest(request);
    renderFitCalculation();
  });

  $$("[data-diagram-download]").forEach((button) => {
    button.addEventListener("click", () => downloadFitDiagram(button.dataset.diagramDownload));
  });

  $("#fitFloorPlanImage").addEventListener("change", handleFitFloorPlanUpload);
  $("#clearFitFloorPlan").addEventListener("click", () => {
    state.fitFloorPlan = { dataUrl: "", name: "" };
    $("#fitFloorPlanImage").value = "";
    $("#fitFloorPlanName").textContent = "업로드된 도면 없음";
    renderFitCalculation();
  });
  ["#fitPlanWidth", "#fitPlanDepth"].forEach((selector) => {
    $(selector).addEventListener("input", renderFitCalculation);
  });
  $$("#fitCalculatorForm input, #fitCalculatorForm select").forEach((control) => {
    if (control.type === "file") return;
    const eventName = control.tagName === "SELECT" || control.type === "checkbox" ? "change" : "input";
    control.addEventListener(eventName, renderFitCalculation);
  });
  $$("input[name='fitUsage'], input[name='designChecks']").forEach((input) => {
    input.addEventListener("change", renderFitCalculation);
  });

  renderFitRequestOptions();
  renderFitCalculation();
}

async function handleFitFloorPlanUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const isJpg = file.type.includes("jpeg") || /\.(jpe?g)$/i.test(file.name);
  if (!isJpg) {
    showToast("JPG 도면 파일만 업로드해주세요.");
    event.target.value = "";
    return;
  }

  try {
    state.fitFloorPlan = {
      dataUrl: await readFileAsDataUrl(file),
      name: file.name,
    };
    $("#fitFloorPlanName").textContent = file.name;
    renderFitCalculation();
    showToast("도면을 블록 플랜 배경으로 불러왔습니다.");
  } catch {
    showToast("도면 파일을 읽지 못했습니다.");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderFitRequestOptions() {
  const select = $("#fitRequestSelect");
  const currentValue = select.value;
  select.innerHTML = `
    <option value="">직접 입력</option>
    ${state.requests
      .map(
        (request) =>
          `<option value="${request.id}">${escapeHtml(request.company || request.clientName)} · ${escapeHtml(
            request.property || "매물 미입력",
          )}</option>`,
      )
      .join("")}
  `;
  if (state.requests.some((request) => request.id === currentValue)) {
    select.value = currentValue;
  }
}

function fillCalculatorFromRequest(request) {
  const usageMap = {
    visitor: ["방문객", "외부인"],
    separate: ["동선 분리", "마주치지"],
    security: ["보안", "출입 통제"],
    open: ["오픈 오피스", "개방형"],
    focus: ["집중 업무", "조용한 공간"],
    call: ["통화", "온라인 회의"],
    dining: ["탕비실에서 식사", "식사 공간"],
    executive: ["독립적인 대표실", "대표실을 직원"],
    department: ["부서별 공간", "부서별로"],
    growth: ["인원 증가", "향후"],
  };
  const needs = request.needs || [];
  const usageText = (request.usageTypes || []).join(" ");
  const hasUsage = (key) => (usageMap[key] || []).some((keyword) => usageText.includes(keyword));
  const seatCount = Number(request.seatCount || request.headcount) || 20;
  const deskSize = normalizeDeskSize(request.deskSize);
  const meetingCapacity = Number(request.meetingCapacity) || (needs.includes("회의실") ? 6 : 0);
  const meetingCount = Number(request.meetingCount) || (needs.includes("회의실") ? 1 : 0);

  $("#fitSeatCount").value = seatCount;
  $("#fitDeskSize").value = deskSize;
  $("#fitDeskBackAisle").value = deskSize === "1200x600" ? "900" : deskSize === "1600x800" || deskSize === "1800x800" ? "1100" : "1000";
  $("#fitMeetingCapacity").value = meetingCapacity;
  $("#fitMeetingCount").value = meetingCount;

  $("#fitDensity").value = hasUsage("growth") || hasUsage("dining") ? "roomy" : deskSize === "1200x600" ? "compact" : "standard";
  $("#fitLayoutType").value = hasUsage("visitor") || hasUsage("separate")
    ? "visitor_heavy"
    : hasUsage("open") || hasUsage("dining")
      ? "communication"
      : hasUsage("focus") || hasUsage("security") || hasUsage("department") || hasUsage("executive")
        ? "independent"
        : "general";
  $("#fitDaylightPriority").value = hasUsage("executive") || needs.includes("대표실")
    ? "ceo_room_first"
    : hasUsage("open") || hasUsage("growth")
      ? "employee_first"
      : "balanced";
  $("#fitMeetingFrequency").value = hasUsage("call") || meetingCount >= 2 ? "high" : meetingCount >= 1 ? "medium" : "low";
  $("#fitVisitorFrequency").value = hasUsage("visitor") || hasUsage("separate") ? "high" : "medium";
  if (request.propertyArea || request.area || request.exclusiveArea) {
    $("#fitPropertyArea").value = request.propertyArea || request.area || request.exclusiveArea;
  }

  $("#fitExecutiveRoom").value = needs.includes("대표실") || hasUsage("executive") ? "standard" : "none";
  $("#fitPantry").value = needs.includes("탕비실") ? (hasUsage("dining") ? "dining" : "standard") : "simple";
  $("#fitStorage").value = needs.includes("창고") || needs.includes("서버실") || hasUsage("security") ? "high" : "medium";
  $("#fitDepartments").value = buildDepartmentMemoFromRequest(request, seatCount, hasUsage);

  $$("input[name='fitUsage']").forEach((input) => {
    input.checked = hasUsage(input.value);
  });
  $$("input[name='designChecks']").forEach((input) => {
    input.checked = false;
  });
}

function buildDepartmentMemoFromRequest(request, seatCount, hasUsage) {
  if (request.departments) return request.departments;
  const industry = String(request.industry || "").trim();
  if (!hasUsage("department")) {
    return `${industry ? `${industry} 업무팀` : "업무팀"} ${seatCount}명`;
  }
  const sales = seatCount >= 3 ? Math.max(Math.round(seatCount * 0.35), 1) : seatCount;
  const operation = seatCount >= 3 ? Math.max(Math.round(seatCount * 0.4), 1) : 0;
  const support = Math.max(seatCount - sales - operation, 0);
  return [
    sales ? `영업/대외팀 ${sales}명 회의실근접` : "",
    operation ? `업무/운영팀 ${operation}명 ${hasUsage("focus") ? "집중" : "협업"}` : "",
    support ? `경영지원팀 ${support}명 ${hasUsage("executive") ? "대표실근접" : "지원"}` : "",
  ].filter(Boolean).join("\n");
}

function normalizeDeskSize(value) {
  const text = String(value || "");
  if (text.includes("1200")) return "1200x600";
  if (text.includes("1600")) return "1600x800";
  if (text.includes("1800")) return "1800x800";
  return "1400x700";
}

function renderFitCalculation() {
  const result = calculateFitPlan();
  $("#fitTotalArea").textContent = `약 ${result.rangeLow}~${result.rangeHigh}평`;
  $("#fitSuitability").textContent = result.suitability;
  $("#fitWorkArea").textContent = `${roundArea(result.workArea)}평`;
  $("#fitMeetingArea").textContent = `${roundArea(result.meetingArea)}평`;
  $("#fitExecutiveArea").textContent = `${roundArea(result.executiveArea)}평`;
  $("#fitSupportArea").textContent = `${roundArea(result.supportArea)}평`;
  $("#fitLayoutCapacity").textContent = result.layoutCapacityText;
  $("#fitNotes").innerHTML = result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  $("#fitDiagram").innerHTML = createFitDiagram(result);
}

function calculateFitPlan() {
  const seats = Math.max(Number($("#fitSeatCount").value) || 0, 0);
  const desk = deskCriteria[$("#fitDeskSize").value] || deskCriteria["1400x700"];
  const density = densityAdjustments[$("#fitDensity").value] || densityAdjustments.standard;
  const meetingCapacity = Math.max(Number($("#fitMeetingCapacity").value) || 0, 0);
  const meetingCount = Math.max(Number($("#fitMeetingCount").value) || 0, 0);
  const executive = executiveCriteria[$("#fitExecutiveRoom").value] || executiveCriteria.none;
  const pantry = pantryCriteria[$("#fitPantry").value] || pantryCriteria.standard;
  const storage = storageCriteria[$("#fitStorage").value] || storageCriteria.medium;
  const propertyArea = Number($("#fitPropertyArea").value) || 0;
  const planWidth = Number($("#fitPlanWidth").value) || 0;
  const planDepth = Number($("#fitPlanDepth").value) || 0;
  const usageTypes = $$("input[name='fitUsage']:checked").map((input) => input.value);
  const designChecks = $$("input[name='designChecks']:checked").map((input) => input.value);
  const baseResultForLayout = {
    seats,
    usageTypes,
    designChecks,
    floorPlan: {
      ...state.fitFloorPlan,
      width: planWidth,
      depth: planDepth,
    },
  };
  const compactPlan = isCompactPlan(baseResultForLayout.floorPlan);
  const rooms = compactPlan ? getCompactRoomLayout(baseResultForLayout) : getStandardRoomLayout(baseResultForLayout);
  const seatLayout = getDeskLayoutCapacity({
    seats,
    x: rooms.work.x + 8,
    y: rooms.work.y + 6,
    maxWidth: rooms.work.width - 12,
    maxHeight: rooms.work.height - 16,
    compact: compactPlan,
  });

  const perSeatArea = Math.max(desk.areaPerSeat + density.value, 1.65);
  const missingSeats = Math.max(seats - seatLayout.visibleSeats, 0);
  const layoutShortageArea = missingSeats * perSeatArea;
  const workArea = seats * perSeatArea + layoutShortageArea;
  const meetingArea = getMeetingArea(meetingCapacity) * meetingCount;
  const executiveArea = executive.area;
  const phoneBoothArea =
    usageTypes.includes("call") || designChecks.includes("acoustic") ? Math.max(Math.ceil(seats / 12), 1) * 0.8 : 0;
  const serverArea = designChecks.includes("secureServer") ? 1.5 : 0;
  const receptionArea = designChecks.includes("reception") ? 2 : 0;
  const storageWallArea = designChecks.includes("storageWall") ? 1.2 : 0;
  const aisleBuffer = designChecks.includes("mainAisle") || designChecks.includes("firePath") ? Math.max(seats * 0.06, 1.2) : 0;
  const bufferArea = Math.max(seats * 0.08, 1.5) + aisleBuffer;
  const supportArea = pantry.area + storage.area + phoneBoothArea + serverArea + receptionArea + storageWallArea + bufferArea;
  const growthBuffer = usageTypes.includes("growth") || designChecks.includes("expansion") ? 1.1 : 1;
  const totalArea = (workArea + meetingArea + executiveArea + supportArea) * growthBuffer;
  const rangeLow = Math.ceil(totalArea * 0.92);
  const rangeHigh = Math.ceil(totalArea * 1.08);

  return {
    workArea,
    meetingArea,
    executiveArea,
    supportArea,
    rangeLow,
    rangeHigh,
    seats,
    meetingCapacity,
    meetingCount,
    executiveLabel: executive.label,
    pantryLabel: pantry.label,
    storageLabel: storage.label,
    designChecks,
    layoutCapacity: seatLayout.visibleSeats,
    layoutCapacityText: seatLayout.visibleSeats >= seats ? `${seats}석 배치 가능` : `${seatLayout.visibleSeats}/${seats}석`,
    floorPlan: {
      ...state.fitFloorPlan,
      width: planWidth,
      depth: planDepth,
    },
    usageTypes,
    suitability: getSuitability(propertyArea, totalArea, rangeHigh),
    notes: buildFitNotes({
      seats,
      desk,
      density,
      meetingCapacity,
      meetingCount,
      executive,
      pantry,
      storage,
      phoneBoothArea,
      propertyArea,
      planWidth,
      planDepth,
      floorPlanName: state.fitFloorPlan.name,
      totalArea,
      usageTypes,
      designChecks,
      layoutCapacity: seatLayout.visibleSeats,
      missingSeats,
      layoutShortageArea,
    }),
  };
}

function getMeetingArea(capacity) {
  if (!capacity) return 0;
  if (capacity <= 4) return 3.2;
  if (capacity <= 6) return 4.5;
  if (capacity <= 8) return 6.2;
  if (capacity <= 10) return 8;
  return Math.max(capacity * 0.85, 8.5);
}

function getSuitability(propertyArea, totalArea, rangeHigh) {
  if (!propertyArea) return "매물 전용평을 입력하면 적합도를 함께 판단합니다.";
  if (propertyArea >= rangeHigh) return `전용 ${propertyArea}평 기준 여유 있게 검토 가능합니다.`;
  if (propertyArea >= totalArea * 0.96) return `전용 ${propertyArea}평 기준 가능하지만 동선과 수납은 타이트하게 봐야 합니다.`;
  return `전용 ${propertyArea}평 기준 현재 요구사항은 조정이 필요해 보입니다.`;
}

function buildFitNotes(inputs) {
  const notes = [
    `${inputs.seats}석 기준 ${inputs.desk.label} 책상은 ${inputs.desk.aisle} 통로를 우선 기준으로 검토합니다.`,
    `${inputs.density.label} 기준으로 좌석 효율을 계산했습니다. 실제 도면에서는 기둥과 창가 라인 때문에 5~10% 오차가 생길 수 있습니다.`,
  ];

  if (inputs.meetingCount > 0) {
    notes.push(`${inputs.meetingCapacity}인 회의실 ${inputs.meetingCount}개는 입구 접근성과 소음 분리를 함께 봐야 합니다.`);
  }
  if (inputs.executive.area > 0) {
    notes.push(`${inputs.executive.label}은 업무공간과 시선이 직접 겹치지 않는 위치를 우선 검토합니다.`);
  }
  if (inputs.pantry.label.includes("식사")) {
    notes.push("식사 가능한 탕비실은 냄새, 소음, 급배수 위치를 먼저 확인해야 합니다.");
  }
  if (inputs.storage.area >= 5) {
    notes.push("수납이 많은 조건이므로 창고 또는 서버/문서 보관 구역을 별도 구획으로 잡는 편이 좋습니다.");
  }
  if (inputs.phoneBoothArea > 0) {
    notes.push("통화와 온라인 회의가 잦아 폰부스 또는 1인 집중실을 함께 반영했습니다.");
  }
  if (inputs.usageTypes.includes("visitor")) {
    notes.push("외부인 출입이 잦으므로 회의실과 대기 영역은 입구 가까운 쪽이 유리합니다.");
  }
  if (inputs.usageTypes.includes("separate")) {
    notes.push("방문객 동선과 직원 업무공간 동선이 섞이지 않도록 전면부/내부 영역을 분리해 검토합니다.");
  }
  if (inputs.usageTypes.includes("security")) {
    notes.push("보안이 중요한 조건이므로 출입통제, 서버/대표실 위치, 유리 파티션 시야 차단을 체크합니다.");
  }
  if (inputs.usageTypes.includes("open")) {
    notes.push("오픈 오피스 선호 조건이 있어 고정 벽체는 최소화하고 회의실/집중실 중심으로 구획합니다.");
  }
  if (inputs.usageTypes.includes("growth")) {
    notes.push("향후 인원 증가를 고려해 전체 필요 면적에 약 10% 여유를 반영했습니다.");
  }
  if (inputs.designChecks.includes("frontMeeting")) {
    notes.push("설계실 체크: 회의실을 입구 전면부에 우선 배치해 외부 미팅 동선을 짧게 잡습니다.");
  }
  if (inputs.designChecks.includes("reception")) {
    notes.push("설계실 체크: 입구에 대기/응대 여유공간을 추가 반영했습니다.");
  }
  if (inputs.designChecks.includes("wetZone")) {
    notes.push("설계실 체크: 탕비실은 급배수 가능 위치를 우선하고, 하부장 D600 앞 동선 900 이상을 확인합니다.");
  }
  if (inputs.designChecks.includes("column")) {
    notes.push("설계실 체크: 기둥 간섭 구간은 좌석 열보다 수납, 복합기, 대기공간으로 흡수하는 방향을 검토합니다.");
  }
  if (inputs.designChecks.includes("windowSeat")) {
    notes.push("설계실 체크: 창가 라인은 업무좌석 우선 배치로 보고, 대표실/회의실 과점유를 피합니다.");
  }
  if (inputs.designChecks.includes("mainAisle")) {
    notes.push("설계실 체크: 메인 동선은 최소 900mm보다 여유 있는 1200mm 기준으로 보정했습니다.");
  }
  if (inputs.designChecks.includes("firePath")) {
    notes.push("설계실 체크: 피난/소방 동선을 막지 않도록 출입구와 코어 주변은 비워두는 기준으로 봅니다.");
  }
  if (inputs.designChecks.includes("secureServer")) {
    notes.push("설계실 체크: 서버/보안 구역을 별도 면적으로 반영하고 출입통제 위치를 검토합니다.");
  }
  if (inputs.designChecks.includes("storageWall")) {
    notes.push("설계실 체크: 벽면 수납장은 D400 기준으로 잡고 전면 동선 900 이상을 확보합니다.");
  }
  if (inputs.designChecks.includes("executivePrivacy")) {
    notes.push("설계실 체크: 대표실은 직원석과 직접 시선이 마주치지 않는 독립 위치를 우선합니다.");
  }
  if (inputs.designChecks.includes("expansion")) {
    notes.push("설계실 체크: 증원 좌석 예비를 위해 전체 필요 면적에 약 10% 여유를 반영했습니다.");
  }
  if (inputs.missingSeats > 0) {
    notes.push(
      `블록플랜 검증: 현재 배치 프레임에서는 ${inputs.layoutCapacity}석까지 표시되어 ${inputs.missingSeats}석이 부족합니다. 권장 필요 면적에 약 ${roundArea(inputs.layoutShortageArea)}평을 추가 반영했습니다.`,
    );
  } else {
    notes.push(`블록플랜 검증: 현재 배치 프레임에서 요청 좌석 ${inputs.seats}석이 들어가는 것으로 계산했습니다.`);
  }
  if (inputs.propertyArea) {
    notes.push(`전용 ${inputs.propertyArea}평 매물은 도면상 기둥, 코어 위치, 창면 길이를 확인한 뒤 최종 가능 좌석을 조정합니다.`);
  }
  if (inputs.floorPlanName) {
    notes.push(`업로드된 JPG 도면 "${inputs.floorPlanName}"을 배경으로 블록 플랜 초안을 겹쳐 표시합니다.`);
  } else if (inputs.planWidth && inputs.planDepth) {
    notes.push(`도면이 없는 조건으로 가로 ${inputs.planWidth}m × 세로 ${inputs.planDepth}m 기준 빈 평면 프레임에 블록을 배치했습니다.`);
  } else {
    notes.push("도면이 없으면 매물의 가로/세로 치수를 입력해 평면 비율을 먼저 잡는 것이 좋습니다.");
  }

  return notes;
}

function roundArea(value) {
  return Number(value).toFixed(value >= 10 ? 0 : 1);
}

function createFitDiagram(result) {
  const planBackground = createPlanBackground(result.floorPlan);
  const seatsToDraw = Math.min(result.seats, 48);
  const meetingLabel = result.meetingCount
    ? `${result.meetingCapacity}인 x ${result.meetingCount}`
    : "필요 시";
  const meetingRoomName = result.meetingCapacity ? `${result.meetingCapacity}인회의실` : "회의실";
  const executiveLabel = result.executiveArea > 0 ? roundArea(result.executiveArea) : "없음";
  const hasVisitorFlow =
    result.usageTypes.includes("visitor") ||
    result.usageTypes.includes("separate") ||
    result.designChecks.includes("frontMeeting") ||
    result.designChecks.includes("reception");
  const securityText =
    result.usageTypes.includes("security") || result.designChecks.includes("secureServer") ? "보안 구역 고려" : "내부 업무 구역";
  const growthText =
    result.usageTypes.includes("growth") || result.designChecks.includes("expansion") ? "증원 여유 포함" : `${result.seats}석 기준`;
  const mainAisleText = result.designChecks.includes("mainAisle") ? "MAIN AISLE 1200" : "MAIN AISLE 900+";
  const pantryText = result.designChecks.includes("wetZone") ? "급배수 우선 · D600 · 동선 900+" : "하부장 D600 · 동선 900+";
  const storageText = result.designChecks.includes("storageWall") ? "벽면 수납 D400 · 동선 900+" : "수납장 D400 · 동선 900+";
  const designBadge = getDesignBadgeText(result.designChecks);
  const meetingFurniture = getMeetingFurniture(result.meetingCapacity);
  const compactPlan = isCompactPlan(result.floorPlan);
  const rooms = compactPlan ? getCompactRoomLayout(result) : getStandardRoomLayout(result);
  const deskElements = createDeskRows({
    seats: seatsToDraw,
    x: rooms.work.x + 8,
    y: rooms.work.y + 6,
    maxWidth: rooms.work.width - 12,
    maxHeight: rooms.work.height - 16,
    compact: compactPlan,
  });
  return `
    <svg viewBox="0 0 100 72" role="img" aria-label="내부 테스트핏 블록 플랜 초안">
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
        </marker>
      </defs>
      <rect x="2" y="2" width="96" height="68" rx="2.2" fill="#ffffff" stroke="#93aaa0" stroke-width="0.7"></rect>
      ${planBackground}

      <rect class="diagram-zone-fill" x="${rooms.entry.x}" y="${rooms.entry.y}" width="${rooms.entry.width}" height="${rooms.entry.height}" fill="#d7e9e0"></rect>
      <rect class="diagram-zone-fill" x="${rooms.meeting.x}" y="${rooms.meeting.y}" width="${rooms.meeting.width}" height="${rooms.meeting.height}" fill="#c8dedf"></rect>
      <rect class="diagram-zone-fill" x="${rooms.executive.x}" y="${rooms.executive.y}" width="${rooms.executive.width}" height="${rooms.executive.height}" fill="#e9ded0"></rect>
      <rect class="diagram-zone-fill" x="${rooms.work.x}" y="${rooms.work.y}" width="${rooms.work.width}" height="${rooms.work.height}" fill="#a8cfc0"></rect>
      <rect class="diagram-zone-fill" x="${rooms.pantry.x}" y="${rooms.pantry.y}" width="${rooms.pantry.width}" height="${rooms.pantry.height}" fill="#f0d99f"></rect>
      <rect class="diagram-zone-fill" x="${rooms.storage.x}" y="${rooms.storage.y}" width="${rooms.storage.width}" height="${rooms.storage.height}" fill="#d8d2e7"></rect>

      ${createWallRoom(rooms.meeting)}
      ${createWallRoom(rooms.executive)}
      ${createWallRoom(rooms.work)}
      ${createWallRoom(rooms.pantry)}
      ${createCorePartitionLines(rooms)}

      ${createDoubleDoor(rooms.entry.x, rooms.entry.y + rooms.entry.height, rooms.entry.width)}
      ${createDoorForRoom(rooms.executive)}
      ${createDoorForRoom(rooms.meeting)}
      ${createDoorForRoom(rooms.pantry)}
      <text class="diagram-small" x="${rooms.entry.x + 1.7}" y="${rooms.entry.y + rooms.entry.height - 1.2}">출입문</text>

      <text class="diagram-label" x="${rooms.executive.x + rooms.executive.width * 0.34}" y="${rooms.executive.y + rooms.executive.height * 0.62}">대표실</text>
      ${createExecutiveFurniture(rooms.executive)}

      <text class="diagram-label" x="${rooms.meeting.x + rooms.meeting.width * 0.24}" y="${rooms.meeting.y + rooms.meeting.height - 5}">${meetingRoomName}</text>
      ${createMeetingFurniture(rooms.meeting, meetingFurniture)}

      ${deskElements}

      ${createStorageFurniture(rooms.storage)}

      ${createPantryFurniture(rooms.pantry, pantryText)}

      <line class="diagram-arrow" x1="${rooms.entry.x + rooms.entry.width}" y1="${rooms.entry.y + rooms.entry.height - 4}" x2="${rooms.meeting.x}" y2="${rooms.meeting.y + rooms.meeting.height - 4}"></line>
      <line class="diagram-arrow" x1="${rooms.aisle.x + rooms.aisle.width / 2}" y1="${rooms.aisle.y + 2}" x2="${rooms.aisle.x + rooms.aisle.width / 2}" y2="${rooms.aisle.y + rooms.aisle.height - 4}"></line>

      <text class="diagram-small" x="5" y="69">면적 기준: 약 ${result.rangeLow}~${result.rangeHigh}평 / 좌석 뒤 2000 · 옆 1000 / ${meetingLabel} / ${securityText}${designBadge}</text>
    </svg>
  `;
}

function isCompactPlan(floorPlan) {
  const width = Number(floorPlan?.width) || 0;
  const depth = Number(floorPlan?.depth) || 0;
  return width > 0 && depth > 0 && width <= 5 && depth <= 4;
}

function getStandardRoomLayout(result) {
  const entry = getBottomEntryRoom(10);
  const options = getLayoutOptions(result);
  if (options.frontMeeting) {
    return {
      entry,
      meeting: { x: 5, y: 42, width: 26, height: 23, door: "right" },
      executive: options.executivePrivate
        ? { x: 69, y: 5, width: 26, height: 18, door: "bottom" }
        : { x: 5, y: 5, width: 26, height: 24, door: "right" },
      work: { x: 31, y: 5, width: 64, height: 43 },
      aisle: { x: 44, y: 52, width: 16, height: 7 },
      pantry: options.wetZone
        ? { x: 66, y: 48, width: 29, height: 17, door: "left" }
        : { x: 66, y: 5, width: 29, height: 15, door: "bottom" },
      storage: options.storageWall ? { x: 37, y: 49, width: 24, height: 4 } : { x: 39, y: 50, width: 16, height: 4 },
    };
  }
  if (options.executivePrivate) {
    return {
      entry,
      meeting: { x: 5, y: 34, width: 26, height: 31, door: "right" },
      executive: { x: 69, y: 5, width: 26, height: 20, door: "bottom" },
      work: { x: 31, y: 5, width: 64, height: 43 },
      aisle: { x: 56, y: 50, width: 10, height: 8 },
      pantry: { x: 64, y: 48, width: 31, height: 17, door: "left" },
      storage: { x: 37, y: 49, width: 16, height: 5 },
    };
  }
  return {
    entry,
    meeting: { x: 5, y: 30, width: 26, height: 35, door: "right" },
    executive: { x: 5, y: 5, width: 26, height: 25, door: "right" },
    work: { x: 31, y: 5, width: 64, height: 54 },
    aisle: { x: 56, y: 50, width: 10, height: 8 },
    pantry: { x: 64, y: 48, width: 31, height: 17, door: "left" },
    storage: { x: 37, y: 49, width: 16, height: 5 },
  };
}

function getCompactRoomLayout(result) {
  const entry = getBottomEntryRoom(9);
  const layout = getStandardRoomLayout(result);
  return {
    ...layout,
    entry,
  };
}

function getLayoutOptions(result) {
  return {
    frontMeeting:
      result.usageTypes.includes("visitor") ||
      result.usageTypes.includes("separate") ||
      result.designChecks.includes("frontMeeting") ||
      result.designChecks.includes("reception"),
    wetZone: result.designChecks.includes("wetZone"),
    executivePrivate: result.designChecks.includes("executivePrivacy") || result.usageTypes.includes("security"),
    storageWall: result.designChecks.includes("storageWall") || result.designChecks.includes("secureServer"),
  };
}

function getBottomEntryRoom(width) {
  return {
    x: 50 - width / 2,
    y: 59,
    width,
    height: 7,
  };
}

function createWallRoom(room) {
  return `<rect class="diagram-room" x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}"></rect>`;
}

function createCorePartitionLines(rooms) {
  return `
    <line class="diagram-partition" x1="${rooms.executive.x + rooms.executive.width}" y1="${rooms.executive.y}" x2="${rooms.executive.x + rooms.executive.width}" y2="${rooms.meeting.y + rooms.meeting.height}"></line>
    <line class="diagram-partition" x1="${rooms.executive.x}" y1="${rooms.meeting.y}" x2="${rooms.executive.x + rooms.executive.width}" y2="${rooms.meeting.y}"></line>
    <line class="diagram-partition" x1="${rooms.work.x}" y1="${rooms.work.y}" x2="${rooms.work.x}" y2="${rooms.work.y + rooms.work.height}"></line>
    <line class="diagram-partition" x1="${rooms.pantry.x}" y1="${rooms.pantry.y}" x2="${rooms.pantry.x}" y2="${rooms.pantry.y + rooms.pantry.height}"></line>
  `;
}

function createDoor(x, y, direction) {
  if (direction === "down") {
    return `
      <line class="diagram-door" x1="${x}" y1="${y}" x2="${x + 4.2}" y2="${y}"></line>
      <path class="diagram-swing" d="M ${x} ${y} A 4.2 4.2 0 0 1 ${x + 4.2} ${y - 4.2}"></path>
    `;
  }
  return `
    <line class="diagram-door" x1="${x}" y1="${y}" x2="${x}" y2="${y + 4.2}"></line>
    <path class="diagram-swing" d="M ${x} ${y} A 4.2 4.2 0 0 0 ${x + 4.2} ${y + 4.2}"></path>
  `;
}

function createDoorForRoom(room) {
  if (room.door === "bottom") return createDoor(room.x + 3, room.y + room.height, "down");
  if (room.door === "left") return createDoor(room.x, room.y + 4, "left");
  if (room.door === "top") return createDoor(room.x + 3, room.y, "down");
  return createDoor(room.x + room.width, room.y + Math.max(2, room.height - 8), "right");
}

function createDoubleDoor(x, y, width) {
  const center = x + width / 2;
  return `
    <line class="diagram-door" x1="${center - 4.8}" y1="${y}" x2="${center - 4.8}" y2="${y - 5.6}"></line>
    <line class="diagram-door" x1="${center + 4.8}" y1="${y}" x2="${center + 4.8}" y2="${y - 5.6}"></line>
    <path class="diagram-swing" d="M ${center - 4.8} ${y} L ${center} ${y - 5.6} L ${center + 4.8} ${y}"></path>
  `;
}

function createExecutiveFurniture(room) {
  const deskX = room.x + 1.4;
  const deskY = room.y + Math.max(5.5, room.height * 0.42);
  return `
    <rect class="diagram-furniture" x="${deskX}" y="${deskY}" width="${Math.min(10, room.width - 5)}" height="2.8" rx="0.1" />
    <circle class="diagram-chair" cx="${deskX + 4.5}" cy="${deskY - 2.2}" r="1.35"></circle>
  `;
}

function createMeetingFurniture(room, furniture) {
  const vertical = room.height > room.width;
  const tableWidth = Math.min(vertical ? furniture.tableDepth : furniture.tableLength, room.width - 10);
  const tableHeight = Math.min(vertical ? furniture.tableLength : furniture.tableDepth, room.height - 12);
  const tableX = room.x + (room.width - tableWidth) / 2;
  const tableY = room.y + Math.max(6, (room.height - tableHeight) / 2);
  return `
    <rect class="diagram-furniture" x="${tableX}" y="${tableY}" width="${tableWidth}" height="${tableHeight}" rx="0.15" />
    ${createMeetingChairs(tableX, tableY, { ...furniture, tableWidth, tableHeight, vertical })}
    <text class="diagram-small" x="${room.x + 2}" y="${room.y + room.height - 2.2}">${furniture.label}</text>
  `;
}

function createPantryFurniture(room, label) {
  const counterHeight = 3.2;
  const counterY = room.y + 0.8;
  return `
    <rect class="diagram-counter" x="${room.x}" y="${counterY}" width="${room.width}" height="${counterHeight}" rx="0.1" />
    <rect class="diagram-furniture" x="${room.x + 1.8}" y="${counterY + 0.45}" width="3.4" height="2.15" rx="0.2" />
    <text class="diagram-label" x="${room.x + room.width * 0.38}" y="${counterY + 2.55}">수납장</text>
    <text class="diagram-label" x="${room.x + room.width * 0.34}" y="${room.y + room.height * 0.76}">탕비실</text>
    <text class="diagram-small" x="${room.x + 2}" y="${room.y + room.height - 1.6}">${label}</text>
  `;
}

function createStorageFurniture(room) {
  return `
    <rect class="diagram-counter" x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" rx="0.1" />
    <text class="diagram-label" x="${room.x + room.width * 0.42}" y="${room.y + room.height * 0.65}">oa</text>
  `;
}

function createWindowLine(x, y, width) {
  return `
    <line class="diagram-window" x1="${x}" y1="${y - 0.7}" x2="${x + width}" y2="${y - 0.7}"></line>
    <line class="diagram-window" x1="${x}" y1="${y - 1.25}" x2="${x + width}" y2="${y - 1.25}"></line>
  `;
}

function createDeskRows({ seats, x, y, maxWidth, maxHeight, compact }) {
  const layout = getDeskLayoutCapacity({ seats, x, y, maxWidth, maxHeight, compact });
  const { clusterWidth, clusterHeight, gapX, gapY, columns, clusterCount, visibleSeats } = layout;
  const desks = Array.from({ length: clusterCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const deskX = x + column * (clusterWidth + gapX);
    const deskY = y + row * (clusterHeight + gapY);
    return `
      <rect class="diagram-clearance" x="${deskX - gapX / 2}" y="${deskY - gapY / 2}" width="${clusterWidth + gapX}" height="${clusterHeight + gapY}" rx="0.25" />
      <rect class="diagram-desk" x="${deskX}" y="${deskY}" width="${clusterWidth / 2}" height="${clusterHeight / 2}" rx="0.1" />
      <rect class="diagram-desk" x="${deskX + clusterWidth / 2}" y="${deskY}" width="${clusterWidth / 2}" height="${clusterHeight / 2}" rx="0.1" />
      <rect class="diagram-desk" x="${deskX}" y="${deskY + clusterHeight / 2}" width="${clusterWidth / 2}" height="${clusterHeight / 2}" rx="0.1" />
      <rect class="diagram-desk" x="${deskX + clusterWidth / 2}" y="${deskY + clusterHeight / 2}" width="${clusterWidth / 2}" height="${clusterHeight / 2}" rx="0.1" />
      <line class="diagram-partition" x1="${deskX + clusterWidth / 2}" y1="${deskY}" x2="${deskX + clusterWidth / 2}" y2="${deskY + clusterHeight}"></line>
      <line class="diagram-partition" x1="${deskX}" y1="${deskY + clusterHeight / 2}" x2="${deskX + clusterWidth}" y2="${deskY + clusterHeight / 2}"></line>
      <circle class="diagram-chair" cx="${deskX - 2.2}" cy="${deskY + clusterHeight * 0.25}" r="1.35"></circle>
      <circle class="diagram-chair" cx="${deskX - 2.2}" cy="${deskY + clusterHeight * 0.75}" r="1.35"></circle>
      <circle class="diagram-chair" cx="${deskX + clusterWidth + 2.2}" cy="${deskY + clusterHeight * 0.25}" r="1.35"></circle>
      <circle class="diagram-chair" cx="${deskX + clusterWidth + 2.2}" cy="${deskY + clusterHeight * 0.75}" r="1.35"></circle>
    `;
  }).join("");
  const overflowLabel =
    visibleSeats < seats
      ? `<text class="diagram-small" x="${x}" y="${y + maxHeight + 2.2}">표시 ${visibleSeats}석 / 요청 ${seats}석 - 면적 추가 필요</text>`
      : `<text class="diagram-small" x="${x}" y="${y + maxHeight + 2.2}">업무좌석 ${seats}석</text>`;
  const guideLabel = `<text class="diagram-small" x="${x}" y="${y - 1.4}">책상 옆 1000 / 등뒤 2000 기준</text>`;
  return guideLabel + desks + overflowLabel;
}

function getDeskLayoutCapacity({ seats, maxWidth, maxHeight, compact }) {
  const clusterWidth = compact ? 6.2 : 6.8;
  const clusterHeight = compact ? 10.5 : 11.2;
  const gapX = compact ? 3.6 : 4.2;
  const gapY = compact ? 7.2 : 8.2;
  const columns = Math.max(1, Math.floor((maxWidth + gapX) / (clusterWidth + gapX)));
  const rows = Math.max(1, Math.floor((maxHeight + gapY) / (clusterHeight + gapY)));
  const clusterCount = Math.min(Math.ceil(seats / 4), columns * rows);
  const visibleSeats = clusterCount * 4;
  return { clusterWidth, clusterHeight, gapX, gapY, columns, rows, clusterCount, visibleSeats };
}

function getDesignBadgeText(designChecks) {
  if (!designChecks.length) return "";
  const labels = {
    frontMeeting: "회의 전면",
    reception: "응대",
    wetZone: "급배수",
    column: "기둥",
    windowSeat: "창가좌석",
    mainAisle: "동선1200",
    firePath: "피난",
    acoustic: "소음",
    secureServer: "보안서버",
    storageWall: "벽수납",
    executivePrivacy: "대표실독립",
    expansion: "증원",
  };
  return ` / 설계체크: ${designChecks.map((check) => labels[check]).filter(Boolean).slice(0, 4).join(", ")}`;
}

function createPlanBackground(floorPlan) {
  const gridLines = Array.from({ length: 11 }, (_, index) => {
    const x = 4 + index * 9.2;
    const y = 4 + index * 6.4;
    return `
      <line class="diagram-plan-grid" x1="${x}" y1="4" x2="${x}" y2="68"></line>
      <line class="diagram-plan-grid" x1="4" y1="${y}" x2="96" y2="${y}"></line>
    `;
  }).join("");

  if (floorPlan?.dataUrl) {
    return `
      <image class="diagram-plan-image" href="${floorPlan.dataUrl}" x="4" y="4" width="92" height="64" preserveAspectRatio="xMidYMid meet"></image>
      <rect class="diagram-overlay" x="4" y="4" width="92" height="64" rx="1.6"></rect>
      <text class="diagram-dimension" x="5.5" y="7.5">업로드 도면 기준 · ${escapeHtml(floorPlan.name || "JPG 도면")}</text>
    `;
  }

  const width = Number(floorPlan?.width) || 0;
  const depth = Number(floorPlan?.depth) || 0;
  const label = width && depth ? `도면 없음 · ${width}m x ${depth}m 기준` : "도면 없음 · 매물 가로/세로 입력 필요";
  const ratio = width && depth ? width / depth : 1.45;
  const frame = getPlanFrameByRatio(ratio);

  return `
    <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="1.4" fill="#fbfdfc" stroke="#93aaa0" stroke-width="0.5"></rect>
    ${gridLines}
    <text class="diagram-dimension" x="${frame.x + 2}" y="${frame.y + 4}">${label}</text>
    ${width && depth ? `<text class="diagram-small" x="${frame.x + frame.width - 27}" y="${frame.y + frame.height - 3}">평면 비율 ${ratio.toFixed(2)}:1</text>` : ""}
  `;
}

function getPlanFrameByRatio(ratio) {
  const maxWidth = 92;
  const maxHeight = 64;
  let width = maxWidth;
  let height = width / Math.max(ratio, 0.4);
  if (height > maxHeight) {
    height = maxHeight;
    width = height * Math.min(Math.max(ratio, 0.4), 2.8);
  }
  return {
    x: 4 + (maxWidth - width) / 2,
    y: 4 + (maxHeight - height) / 2,
    width,
    height,
  };
}

function getMeetingFurniture(capacity) {
  if (!capacity || capacity <= 4) return { label: "1800×700", tableLength: 9, tableDepth: 3.5, chairs: 4 };
  if (capacity <= 6) return { label: "2200×800", tableLength: 11, tableDepth: 4, chairs: 6 };
  if (capacity <= 8) return { label: "2800×800", tableLength: 14, tableDepth: 4, chairs: 8 };
  if (capacity <= 10) return { label: "3200×900", tableLength: 16, tableDepth: 4.5, chairs: 10 };
  return { label: "3600×1000", tableLength: 18, tableDepth: 5, chairs: 12 };
}

function createMeetingChairs(tableX, tableY, furniture) {
  const chairs = Math.min(furniture.chairs, 12);
  const sideCount = Math.ceil(chairs / 2);
  const otherSideCount = chairs - sideCount;
  if (furniture.vertical) {
    const left = Array.from({ length: sideCount }, (_, index) => {
      const y = tableY + 1.2 + index * ((furniture.tableHeight - 2.4) / Math.max(sideCount - 1, 1));
      return `<circle class="diagram-chair" cx="${tableX - 2.1}" cy="${y}" r="1.15"></circle>`;
    }).join("");
    const right = Array.from({ length: otherSideCount }, (_, index) => {
      const y = tableY + 1.2 + index * ((furniture.tableHeight - 2.4) / Math.max(otherSideCount - 1, 1));
      return `<circle class="diagram-chair" cx="${tableX + furniture.tableWidth + 2.1}" cy="${y}" r="1.15"></circle>`;
    }).join("");
    return left + right;
  }

  const top = Array.from({ length: sideCount }, (_, index) => {
    const x = tableX + 1.2 + index * ((furniture.tableWidth - 2.4) / Math.max(sideCount - 1, 1));
    return `<circle class="diagram-chair" cx="${x}" cy="${tableY - 2.1}" r="1.15"></circle>`;
  }).join("");
  const bottom = Array.from({ length: otherSideCount }, (_, index) => {
    const x = tableX + 1.2 + index * ((furniture.tableWidth - 2.4) / Math.max(otherSideCount - 1, 1));
    return `<circle class="diagram-chair" cx="${x}" cy="${tableY + furniture.tableHeight + 2.1}" r="1.15"></circle>`;
  }).join("");
  return top + bottom;
}

const densityProfiles = {
  compact: {
    key: "dense",
    label: "효율형",
    mainAisle: 9.5,
    chairBack: 9,
    deskSide: 7.5,
    sqmPerSeat: 3.15,
    buffer: 0.1,
  },
  standard: {
    key: "standard",
    label: "표준형",
    mainAisle: 11,
    chairBack: 10,
    deskSide: 8.5,
    sqmPerSeat: 4,
    buffer: 0.16,
  },
  roomy: {
    key: "efficient",
    label: "여유형",
    mainAisle: 13,
    chairBack: 11.5,
    deskSide: 10,
    sqmPerSeat: 5.2,
    buffer: 0.24,
  },
};

const layoutTypeLabels = {
  communication: "소통형",
  independent: "독립형",
  visitor_heavy: "외부인 방문 많은형",
  general: "일반형",
};

const daylightLabels = {
  ceo_room_first: "대표실 창가 우선",
  employee_first: "직원 채광 우선",
  balanced: "균형형",
};

const meetingSpecs = {
  4: { table: "1200x750", minArea: 7, recommendedArea: 9, tableW: 12, tableD: 3.8 },
  6: { table: "1800x800", minArea: 10, recommendedArea: 13, tableW: 15, tableD: 4.2 },
  8: { table: "2400x900", minArea: 15, recommendedArea: 18, tableW: 19, tableD: 4.8 },
  10: { table: "3000x1000", minArea: 20, recommendedArea: 24, tableW: 22, tableD: 5.2 },
  12: { table: "3600x1200", minArea: 26, recommendedArea: 31, tableW: 25, tableD: 6 },
};

function renderFitCalculation() {
  const result = calculateFitPlan();
  $("#fitTotalArea").textContent = `약 ${result.rangeLow}~${result.rangeHigh}평`;
  $("#fitSuitability").textContent = result.suitability;
  $("#fitWorkArea").textContent = `${roundArea(result.workArea)}평`;
  $("#fitMeetingArea").textContent = `${roundArea(result.meetingArea)}평`;
  $("#fitExecutiveArea").textContent = `${roundArea(result.executiveArea)}평`;
  $("#fitSupportArea").textContent = `${roundArea(result.supportArea)}평`;
  $("#fitLayoutCapacity").textContent = result.layoutCapacityText;
  const score = $("#fitScore");
  if (score) score.textContent = `${result.score.total}점`;
  $("#fitNotes").innerHTML = result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const report = $("#fitReport");
  if (report) {
    report.innerHTML = `
      <h3>고객용 설명</h3>
      <p>${escapeHtml(result.clientSummary)}</p>
      <dl>
        <div><dt>장점</dt><dd>${escapeHtml(result.strengths.join(" / "))}</dd></div>
        <div><dt>주의점</dt><dd>${escapeHtml(result.weaknesses.join(" / "))}</dd></div>
        <div><dt>개선안</dt><dd>${escapeHtml(result.recommendations.join(" / "))}</dd></div>
      </dl>
    `;
  }
  $("#fitDiagram").innerHTML = createFitDiagram(result);
}

function calculateFitPlan() {
  const program = buildOfficeProgram();
  const blocks = buildSpaceBlocks(program);
  const plan = generateOfficeLayout(program, blocks);
  const score = scoreOfficeLayout(program, blocks, plan);
  const totals = summarizeOfficeAreas(program, blocks, plan);
  const propertyArea = Number($("#fitPropertyArea").value) || 0;
  const notes = buildFitNotes({ program, blocks, plan, score, totals, propertyArea });
  const clientSummary = buildClientSummary(program, score, totals);

  return {
    ...totals,
    seats: program.employeeCount,
    meetingCapacity: program.meetingRooms[0]?.capacity || 0,
    meetingCount: program.meetingRooms.reduce((sum, room) => sum + room.count, 0),
    layoutCapacity: plan.capacity.visibleSeats,
    layoutCapacityText:
      plan.capacity.visibleSeats >= program.employeeCount
        ? `${program.employeeCount}석 초안 배치`
        : `${plan.capacity.visibleSeats}/${program.employeeCount}석`,
    floorPlan: program.floorPlan,
    usageTypes: program.usageTypes,
    designChecks: program.designChecks,
    score,
    notes,
    suitability: getSuitability(propertyArea, totals.totalArea, totals.rangeHigh),
    clientSummary,
    strengths: score.strengths,
    weaknesses: score.weaknesses,
    recommendations: score.recommendations,
    plan,
    blocks,
    program,
  };
}

function buildOfficeProgram() {
  const usageTypes = $$("input[name='fitUsage']:checked").map((input) => input.value);
  const designChecks = $$("input[name='designChecks']:checked").map((input) => input.value);
  const seats = Math.max(Number($("#fitSeatCount").value) || 0, 1);
  const meetingCapacity = normalizeMeetingCapacity(Number($("#fitMeetingCapacity").value) || 0);
  const meetingCount = Math.max(Number($("#fitMeetingCount").value) || 0, 0);
  const explicitLayoutType = $("#fitLayoutType")?.value || "general";
  const visitorFrequency = usageTypes.includes("visitor") || usageTypes.includes("separate")
    ? "high"
    : $("#fitVisitorFrequency")?.value || "medium";
  const layoutType = visitorFrequency === "high" ? "visitor_heavy" : explicitLayoutType;
  const pantryValue = $("#fitPantry").value;
  const densityType = $("#fitDensity").value;

  return {
    totalArea: Number($("#fitPropertyArea").value) || 0,
    employeeCount: seats,
    desk: deskCriteria[$("#fitDeskSize").value] || deskCriteria["1400x700"],
    deskBackAisleMm: Number($("#fitDeskBackAisle")?.value) || 1000,
    deskSideAisleMm: densityType === "compact" ? 900 : densityType === "roomy" ? 1100 : 1000,
    densityType,
    density: densityProfiles[densityType] || densityProfiles.standard,
    layoutType,
    departments: parseDepartments($("#fitDepartments")?.value || "", seats),
    daylightPriority: $("#fitDaylightPriority")?.value || "balanced",
    meetingFrequency: $("#fitMeetingFrequency")?.value || "medium",
    visitorFrequency,
    needsCeoRoom: $("#fitExecutiveRoom").value !== "none" || usageTypes.includes("executive"),
    executive: executiveCriteria[$("#fitExecutiveRoom").value] || executiveCriteria.none,
    meetingRooms: meetingCapacity && meetingCount ? [{ capacity: meetingCapacity, count: meetingCount }] : [],
    needsPantry: pantryValue !== "none",
    pantry: pantryCriteria[pantryValue] || pantryCriteria.standard,
    pantryStyle: layoutType === "communication" || usageTypes.includes("dining") ? "semi_open" : pantryValue === "simple" ? "semi_open" : "closed",
    needsStorage: $("#fitStorage").value !== "low" || designChecks.includes("storageWall"),
    storage: storageCriteria[$("#fitStorage").value] || storageCriteria.medium,
    needsServerRoom: designChecks.includes("secureServer"),
    needsPhoneBooth: usageTypes.includes("call") || usageTypes.includes("focus") || designChecks.includes("acoustic"),
    needsLounge: layoutType === "communication" || usageTypes.includes("dining"),
    needsCopyZone: true,
    needsLocker: seats >= 20,
    usageTypes,
    designChecks,
    floorPlan: {
      ...state.fitFloorPlan,
      width: Number($("#fitPlanWidth").value) || 0,
      depth: Number($("#fitPlanDepth").value) || 0,
    },
  };
}

function normalizeMeetingCapacity(capacity) {
  if (!capacity) return 0;
  if (capacity <= 4) return 4;
  if (capacity <= 6) return 6;
  if (capacity <= 8) return 8;
  if (capacity <= 10) return 10;
  return 12;
}

function parseDepartments(value, fallbackSeats) {
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return [{ name: "업무팀", employeeCount: fallbackSeats, needsFocus: false, needsCollaboration: true }];
  }
  return lines.map((line, index) => {
    const count = Number((line.match(/(\d+)\s*명?/) || [])[1]) || Math.max(1, Math.round(fallbackSeats / lines.length));
    const name = line.replace(/\d+\s*명?/g, "").replace(/집중|협업|회의실근접|대표실근접/g, "").trim() || `팀 ${index + 1}`;
    return {
      name,
      employeeCount: count,
      needsFocus: /집중|개발|연구|회계/.test(line),
      needsCollaboration: /협업|영업|디자인|기획|회의/.test(line),
      shouldBeNear: /회의실근접|영업/.test(line) ? ["meeting_room"] : /대표실근접|경영지원/.test(line) ? ["ceo_room"] : [],
      shouldBeSeparatedFrom: /집중/.test(line) ? ["pantry", "open_lounge"] : [],
    };
  });
}

function buildSpaceBlocks(program) {
  const blocks = [
    createSpaceBlock("entry", "entry", "출입구", 2, 2, 10, 4, "near_entry", 2, 2, 5, "외부인과 직원 동선의 시작점입니다."),
  ];
  const visitorHeavy = program.visitorFrequency === "high" || program.layoutType === "visitor_heavy";
  if (visitorHeavy) {
    blocks.push(createSpaceBlock("waiting", "waiting_area", "대기/응대", 3, 5, 13, 7, "near_entry", 2, 2, 5, "방문객이 업무공간 안쪽으로 들어가지 않게 입구에 둡니다."));
  }
  program.meetingRooms.forEach((room, roomIndex) => {
    const spec = meetingSpecs[room.capacity] || meetingSpecs[6];
    Array.from({ length: room.count }, (_, index) => {
      blocks.push({
        ...createSpaceBlock(`meeting-${roomIndex}-${index}`, "meeting_room", `${room.capacity}인 회의실`, spec.minArea, spec.recommendedArea, 18, 11, visitorHeavy ? "near_entry" : "center", 4, 3, visitorHeavy ? 5 : 3, `${room.capacity}인 테이블 ${spec.table} 기준, 의자 뒤 동선 1000mm 이상을 봅니다.`),
        capacity: room.capacity,
        table: spec,
      });
    });
  });
  if (program.needsCeoRoom) {
    blocks.push(createSpaceBlock("ceo", "ceo_room", "대표실", Math.max(program.executive.area, 5), Math.max(program.executive.area + 1.5, 7), 16, 12, program.daylightPriority === "employee_first" ? "deep_inside" : "near_window", 5, 2, 2, "대표실은 독립성과 채광, 회의실 접근성을 함께 봅니다."));
  }
  program.departments.forEach((department, index) => {
    blocks.push({
      ...createSpaceBlock(`team-${index}`, "team_zone", department.name, department.employeeCount * program.density.sqmPerSeat, department.employeeCount * program.density.sqmPerSeat * 1.08, 22, 16, program.daylightPriority === "ceo_room_first" ? "center" : "near_window", department.needsFocus ? 4 : 2, department.needsCollaboration ? 3 : 2, 1, `${department.employeeCount}석 팀존입니다. ${department.needsFocus ? "집중 업무를 위해 소음원과 거리를 둡니다." : "협업 접근성을 우선합니다."}`),
      department,
    });
  });
  if (program.needsPantry) {
    const pantryArea = getPantryArea(program);
    blocks.push(createSpaceBlock("pantry", "pantry", program.pantryStyle === "closed" ? "탕비실" : "탕비/라운지", pantryArea.min, pantryArea.recommended, 18, 9, program.designChecks.includes("wetZone") ? "near_plumbing" : "center", 2, 4, 2, "하부장 D600, 전면 동선 900mm 이상을 기준으로 둡니다."));
  }
  if (program.needsLounge) {
    blocks.push(createSpaceBlock("lounge", "open_lounge", "라운지", 4, Math.max(6, program.employeeCount * 0.35), 18, 9, "center", 1, 3, 2, "소통형에서는 탕비와 연결된 커뮤니케이션 존으로 봅니다."));
  }
  if (program.needsPhoneBooth) {
    blocks.push(createSpaceBlock("phone", "phone_booth", "폰부스", 1.2, Math.max(1.8, Math.ceil(program.employeeCount / 12) * 1.3), 8, 7, "center", 4, 2, 1, "업무공간 근처이되 탕비/복합기와는 분리합니다."));
  }
  if (program.needsStorage) {
    blocks.push(createSpaceBlock("storage", "storage", "수납", program.storage.area, program.storage.area + 1, 18, 4, "near_core", 3, 1, 1, "D400 벽면 수납과 죽은 공간 활용을 우선합니다."));
  }
  if (program.needsServerRoom) {
    blocks.push(createSpaceBlock("server", "server_room", "서버/보안", 1.5, 2.5, 8, 7, "near_core", 5, 2, 1, "환기와 출입통제 가능 위치를 우선 검토합니다."));
  }
  if (program.needsCopyZone) {
    blocks.push(createSpaceBlock("copy", "copy_zone", "OA", 1.2, 2, 10, 4, "center", 2, 3, 1, "직원 접근성은 좋게, 대표실/회의실 바로 앞은 피합니다."));
  }
  return blocks;
}

function createSpaceBlock(id, type, name, minArea, recommendedArea, minWidth, minDepth, preferredLocation, privacyLevel, noiseLevel, visitorAccessLevel, reason) {
  return {
    id,
    type,
    name,
    minArea,
    recommendedArea,
    minWidth,
    minDepth,
    preferredRatio: "flexible",
    privacyLevel,
    noiseLevel,
    visitorAccessLevel,
    mustBeNear: [],
    shouldBeNear: [],
    shouldBeFarFrom: [],
    preferredLocation,
    canBeOpen: ["entry", "waiting_area", "team_zone", "open_lounge", "copy_zone"].includes(type),
    canBeSemiOpen: ["pantry", "meeting_room", "team_zone"].includes(type),
    mustBeClosed: ["ceo_room", "server_room", "phone_booth"].includes(type),
    hasDoor: ["meeting_room", "ceo_room", "server_room", "phone_booth", "pantry"].includes(type),
    needsWindow: ["ceo_room", "team_zone"].includes(type),
    needsPlumbing: type === "pantry",
    needsVentilation: ["pantry", "server_room", "phone_booth"].includes(type),
    reason,
  };
}

function getPantryArea(program) {
  const seats = program.employeeCount;
  const communication = program.layoutType === "communication";
  if (seats <= 10) return communication ? { min: 3, recommended: 5 } : { min: 2, recommended: 4 };
  if (seats <= 25) return communication ? { min: 5, recommended: 9 } : { min: 4, recommended: 7 };
  if (seats <= 50) return communication ? { min: 9, recommended: 15 } : { min: 7, recommended: 12 };
  return communication ? { min: 15, recommended: 20 } : { min: 12, recommended: 16 };
}

function generateOfficeLayout(program, blocks) {
  const width = Number(program.floorPlan?.width) || 18;
  const depth = Number(program.floorPlan?.depth) || 12;
  const ratio = width / depth;
  const frame = getPlanFrameByRatio(ratio);
  const visitorHeavy = program.visitorFrequency === "high" || program.layoutType === "visitor_heavy";
  const frontH = visitorHeavy ? 19 : 14;
  const serviceH = program.layoutType === "communication" ? 12 : 10;
  const leftW = visitorHeavy ? 31 : 26;
  const rightW = program.needsCeoRoom ? 24 : 14;
  const workX = frame.x + leftW;
  const workY = frame.y + 5;
  const workW = Math.max(26, frame.width - leftW - rightW);
  const workH = Math.max(24, frame.height - frontH - 7);
  const spaces = [];

  spaces.push({ id: "entry", type: "entry", name: "출입구", x: frame.x + frame.width * 0.43, y: frame.y + frame.height - 5, width: frame.width * 0.14, height: 5, open: true });
  if (visitorHeavy) {
    spaces.push({ id: "waiting", type: "waiting_area", name: "대기/응대", x: frame.x + 2, y: frame.y + frame.height - frontH + 2, width: leftW - 5, height: frontH - 7, open: true });
  }

  const meetingBlocks = blocks.filter((block) => block.type === "meeting_room");
  meetingBlocks.forEach((block, index) => {
    const roomW = Math.min(leftW - 5, Math.max(19, block.capacity === 4 ? 19 : block.capacity === 6 ? 23 : 27));
    const roomH = Math.min(22, Math.max(14, 10 + block.capacity * 0.9));
    const nearEntryY = frame.y + frame.height - frontH - roomH - index * 3;
    const internalY = frame.y + 6 + index * (roomH + 2);
    spaces.push({
      id: block.id,
      type: "meeting_room",
      name: block.name,
      x: frame.x + 2,
      y: visitorHeavy ? Math.max(frame.y + 4, nearEntryY) : internalY,
      width: roomW,
      height: roomH,
      door: "right",
      block,
    });
  });

  if (program.needsCeoRoom) {
    const ceoW = Math.min(24, Math.max(17, rightW - 3));
    const ceoH = program.executive.area >= 9 ? 18 : 15;
    const ceoTop = program.daylightPriority !== "employee_first";
    spaces.push({
      id: "ceo",
      type: "ceo_room",
      name: "대표실",
      x: frame.x + frame.width - ceoW - 2,
      y: ceoTop ? frame.y + 4 : frame.y + frame.height - frontH - ceoH - 2,
      width: ceoW,
      height: ceoH,
      door: "left",
    });
  }

  const workSpaces = layoutTeamZones(program, workX, workY, workW, workH);
  const teamCapacity = workSpaces.reduce((sum, space) => {
    const capacity = getDeskLayoutCapacity({
      seats: space.team?.employeeCount || 0,
      maxWidth: space.width - 3,
      maxHeight: space.height - 5,
      compact: program.densityType === "compact",
    });
    return sum + capacity.visibleSeats;
  }, 0);
  spaces.push(...workSpaces);

  const pantryW = program.layoutType === "communication" ? 24 : 19;
  const pantryH = program.layoutType === "communication" ? 11 : 9;
  spaces.push({
    id: "pantry",
    type: "pantry",
    name: program.layoutType === "communication" ? "탕비/라운지" : "탕비실",
    x: frame.x + frame.width - pantryW - 2,
    y: frame.y + frame.height - serviceH - 2,
    width: pantryW,
    height: pantryH,
    door: program.pantryStyle === "closed" ? "left" : "open",
  });
  if (program.needsLounge) {
    spaces.push({ id: "lounge", type: "open_lounge", name: "오픈 라운지", x: workX, y: frame.y + frame.height - serviceH - 1, width: Math.max(20, workW * 0.45), height: serviceH - 4, open: true });
  }
  spaces.push({ id: "copy", type: "copy_zone", name: "OA", x: workX + workW * 0.42, y: frame.y + frame.height - serviceH + 2, width: 14, height: 4, open: true });
  if (program.needsStorage) {
    spaces.push({ id: "storage", type: "storage", name: "수납 D400", x: frame.x + frame.width - 24, y: frame.y + 2, width: 21, height: 4, open: true });
  }
  if (program.needsPhoneBooth) {
    spaces.push({ id: "phone", type: "phone_booth", name: "폰부스", x: workX + workW - 9, y: workY + workH - 9, width: 7, height: 7, door: "left" });
  }
  if (program.needsServerRoom) {
    spaces.push({ id: "server", type: "server_room", name: "서버", x: frame.x + frame.width - 10, y: frame.y + 8, width: 8, height: 8, door: "left" });
  }

  return {
    frame,
    spaces,
    capacity: {
      ...getDeskLayoutCapacity({ seats: program.employeeCount, maxWidth: workW - 3, maxHeight: workH - 4, compact: program.densityType === "compact" }),
      visibleSeats: teamCapacity,
    },
    mainAisle: { x: frame.x + frame.width * 0.48, y: frame.y + 4, width: 5.5, height: frame.height - 10 },
    visitorPath: visitorHeavy,
    windowLine: { x: frame.x + 3, y: frame.y + 1.5, width: frame.width - 6 },
  };
}

function layoutTeamZones(program, x, y, width, height) {
  const total = program.departments.reduce((sum, team) => sum + team.employeeCount, 0) || program.employeeCount;
  let cursorY = y;
  return program.departments.map((team, index) => {
    const zoneH = index === program.departments.length - 1
      ? y + height - cursorY
      : Math.max(10, height * (team.employeeCount / total));
    const zone = {
      id: `team-${index}`,
      type: "team_zone",
      name: `${team.name} ${team.employeeCount}석`,
      x,
      y: cursorY,
      width,
      height: Math.max(10, zoneH - 1.5),
      open: true,
      team,
    };
    cursorY += zoneH;
    return zone;
  });
}

function summarizeOfficeAreas(program, blocks, plan) {
  const workArea = blocks.filter((block) => block.type === "team_zone").reduce((sum, block) => sum + block.recommendedArea, 0);
  const meetingArea = blocks.filter((block) => block.type === "meeting_room").reduce((sum, block) => sum + block.recommendedArea, 0);
  const executiveArea = blocks.filter((block) => block.type === "ceo_room").reduce((sum, block) => sum + block.recommendedArea, 0);
  const supportArea = blocks
    .filter((block) => !["team_zone", "meeting_room", "ceo_room", "entry"].includes(block.type))
    .reduce((sum, block) => sum + block.recommendedArea, 0);
  const shortageSeats = Math.max(program.employeeCount - plan.capacity.visibleSeats, 0);
  const shortageArea = shortageSeats * program.density.sqmPerSeat;
  const totalArea = (workArea + meetingArea + executiveArea + supportArea + shortageArea) * (1 + program.density.buffer);
  return {
    workArea: sqmToPyeong(workArea + shortageArea),
    meetingArea: sqmToPyeong(meetingArea),
    executiveArea: sqmToPyeong(executiveArea),
    supportArea: sqmToPyeong(supportArea),
    totalArea: sqmToPyeong(totalArea),
    rangeLow: Math.ceil(sqmToPyeong(totalArea) * 0.92),
    rangeHigh: Math.ceil(sqmToPyeong(totalArea) * 1.1),
    shortageSeats,
    shortageArea: sqmToPyeong(shortageArea),
  };
}

function sqmToPyeong(value) {
  return value / 3.3058;
}

function scoreOfficeLayout(program, blocks, plan) {
  let score = 100;
  const strengths = [];
  const weaknesses = [];
  const recommendations = [];
  const hasVisitorFront = plan.spaces.some((space) => ["meeting_room", "waiting_area"].includes(space.type) && space.y > plan.frame.y + plan.frame.height * 0.5);
  const ceo = plan.spaces.find((space) => space.type === "ceo_room");
  const pantry = plan.spaces.find((space) => space.type === "pantry");

  if (program.visitorFrequency === "high" && hasVisitorFront) strengths.push("외부인 영역을 입구 가까이에 분리했습니다.");
  if (program.visitorFrequency === "high" && !hasVisitorFront) {
    score -= 18;
    weaknesses.push("방문객 동선이 업무공간 안쪽으로 들어갈 수 있습니다.");
    recommendations.push("회의실과 대기공간을 입구 전면으로 재배치하세요.");
  }
  if (program.daylightPriority === "employee_first" && ceo && ceo.y <= plan.frame.y + 8) {
    score -= 10;
    weaknesses.push("직원 채광 우선 조건에서 대표실이 창가를 많이 점유합니다.");
    recommendations.push("대표실 폭을 줄이고 창가 업무존을 늘리는 보정이 필요합니다.");
  } else if (program.daylightPriority !== "employee_first" && ceo) {
    strengths.push("대표실의 독립성과 창가 접근성을 확보했습니다.");
  }
  if (program.layoutType === "communication" && pantry) strengths.push("탕비와 라운지를 메인 동선 가까이에 묶었습니다.");
  if (program.layoutType === "independent" && pantry && pantry.x < plan.frame.x + plan.frame.width * 0.55) {
    score -= 7;
    weaknesses.push("독립형 조건에서는 탕비/라운지 소음이 업무존에 가까울 수 있습니다.");
  }
  if (program.employeeCount > plan.capacity.visibleSeats) {
    score -= Math.min(22, (program.employeeCount - plan.capacity.visibleSeats) * 2);
    weaknesses.push(`현재 프레임에서는 ${program.employeeCount - plan.capacity.visibleSeats}석이 부족합니다.`);
    recommendations.push("업무존 폭을 넓히거나 회의실/라운지 면적을 조정하세요.");
  } else {
    strengths.push("요청 좌석 수가 업무존 프레임 안에 들어갑니다.");
  }
  if (program.designChecks.includes("wetZone")) strengths.push("탕비실은 급배수 우선 검토 대상으로 표시했습니다.");
  if (program.designChecks.includes("firePath")) strengths.push("피난/소방 동선 체크를 필수 조건으로 반영했습니다.");
  if (program.needsServerRoom && !program.designChecks.includes("secureServer")) {
    score -= 5;
    recommendations.push("서버실은 환기와 출입통제 체크를 추가하세요.");
  }

  return {
    total: Math.max(45, Math.min(100, Math.round(score))),
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.length ? weaknesses.slice(0, 4) : ["자동 초안 기준에서 큰 충돌은 보이지 않습니다."],
    recommendations: recommendations.length ? recommendations.slice(0, 4) : ["실측 도면 위에서 벽체, 문 열림, 기둥 간섭을 수동 보정하세요."],
  };
}

function buildFitNotes({ program, plan, score, totals, propertyArea }) {
  const notes = [
    `${layoutTypeLabels[program.layoutType]} / ${program.density.label} / ${daylightLabels[program.daylightPriority]} 기준으로 자동 블럭 초안을 생성했습니다.`,
    `메인 동선은 약 ${program.density.mainAisle * 100}mm, 의자 뒤 여유는 약 ${program.density.chairBack * 100}mm 기준으로 계산했습니다.`,
    `부서 구성 ${program.departments.length}개를 팀존으로 분할했고, 좌석 ${program.employeeCount}석 중 도면 프레임상 ${plan.capacity.visibleSeats}석까지 표시 가능합니다.`,
    `적합성 점수는 ${score.total}점입니다. 공간 관계, 외부인 동선, 채광, 좌석 수용성을 함께 반영했습니다.`,
  ];
  if (program.meetingRooms.length) {
    notes.push(`회의실은 ${program.meetingRooms.map((room) => `${room.capacity}인 ${room.count}개`).join(", ")} 기준이며, 외부인 방문 빈도에 따라 입구 접근성을 우선 조정합니다.`);
  }
  if (program.layoutType === "communication") notes.push("소통형 조건으로 탕비실은 반오픈 라운지 성격을 우선 추천합니다.");
  if (program.layoutType === "independent") notes.push("독립형 조건으로 소음원과 집중 업무존 사이의 거리를 점수에 반영했습니다.");
  if (program.visitorFrequency === "high") notes.push("외부인 방문 빈도가 높아 회의실/대기공간을 입구 전면부에 우선 배치했습니다.");
  if (program.floorPlan.name) notes.push(`업로드된 도면 "${program.floorPlan.name}"은 배경 참고용이며, 현재 MVP는 도면 자동 인식보다 룰 기반 배치를 우선합니다.`);
  if (program.floorPlan.width && program.floorPlan.depth) notes.push(`평면 비율은 가로 ${program.floorPlan.width}m x 세로 ${program.floorPlan.depth}m 기준으로 잡았습니다.`);
  if (propertyArea) notes.push(`검토 매물 ${propertyArea}평 대비 권장 범위는 약 ${totals.rangeLow}~${totals.rangeHigh}평입니다.`);
  return notes;
}

function buildClientSummary(program, score, totals) {
  return `입력하신 조건을 기준으로 ${layoutTypeLabels[program.layoutType]} 오피스 초안을 검토했습니다. 현재 안은 약 ${totals.rangeLow}~${totals.rangeHigh}평 수준의 전용면적을 권장하며, 적합성은 ${score.total}점으로 산정됩니다. 본 결과는 확정 도면이 아니라 계약 전 가능성을 빠르게 판단하기 위한 블록 플랜 초안이며, 실측 도면 확인 후 벽체와 문 위치를 디자이너가 보정합니다.`;
}

function getSuitability(propertyArea, totalArea, rangeHigh) {
  if (!propertyArea) return "매물 전용평을 입력하면 적합성을 함께 판단합니다.";
  if (propertyArea >= rangeHigh) return `전용 ${propertyArea}평 기준 여유 있게 검토 가능합니다.`;
  if (propertyArea >= totalArea * 0.96) return `전용 ${propertyArea}평 기준 가능하지만 동선과 수납을 타이트하게 봐야 합니다.`;
  return `전용 ${propertyArea}평 기준 현재 요구사항은 일부 조정이 필요합니다.`;
}

function createFitDiagram(result) {
  const { plan, program } = result;
  const background = createPlanBackground(program.floorPlan);
  const rooms = plan.spaces.map((space) => createSmartSpace(space, program)).join("");
  const workFurniture = plan.spaces.filter((space) => space.type === "team_zone").map((space) => createTeamFurniture(space, program)).join("");
  const meetingFurniture = plan.spaces.filter((space) => space.type === "meeting_room").map((space) => createSmartMeetingFurniture(space)).join("");
  const doors = plan.spaces.map(createSmartDoor).join("");
  const visitorPath = plan.visitorPath
    ? `<path class="diagram-visitor-path" d="M ${plan.frame.x + plan.frame.width * 0.5} ${plan.frame.y + plan.frame.height - 2} L ${plan.frame.x + 15} ${plan.frame.y + plan.frame.height - 12} L ${plan.frame.x + 15} ${plan.frame.y + plan.frame.height - 30}" />`
    : "";
  return `
    <svg viewBox="0 0 100 72" role="img" aria-label="오피스 테스트핏 자동 블록 초안">
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
        </marker>
      </defs>
      <rect x="2" y="2" width="96" height="68" fill="#ffffff" stroke="#111111" stroke-width="0.45"></rect>
      ${background}
      <line class="diagram-window" x1="${plan.windowLine.x}" y1="${plan.windowLine.y}" x2="${plan.windowLine.x + plan.windowLine.width}" y2="${plan.windowLine.y}"></line>
      <rect class="diagram-aisle-fill" x="${plan.mainAisle.x}" y="${plan.mainAisle.y}" width="${plan.mainAisle.width}" height="${plan.mainAisle.height}"></rect>
      ${visitorPath}
      ${rooms}
      ${workFurniture}
      ${meetingFurniture}
      ${doors}
      <text class="diagram-dimension" x="5" y="68">자동 초안: ${layoutTypeLabels[program.layoutType]} / 점수 ${result.score.total} / 메인동선 ${program.density.mainAisle * 100}mm / 의자 뒤 ${program.density.chairBack * 100}mm</text>
    </svg>
  `;
}

function createSmartSpace(space, program) {
  const color = {
    entry: "#e6efe9",
    waiting_area: "#d9ece8",
    meeting_room: "#ffffff",
    ceo_room: "#ffffff",
    team_zone: "#fdfdfb",
    pantry: program.pantryStyle === "closed" ? "#ffffff" : "#f5fbf7",
    open_lounge: "#f5fbf7",
    copy_zone: "#d6edf3",
    storage: "#d6edf3",
    server_room: "#ffffff",
    phone_booth: "#ffffff",
  }[space.type] || "#ffffff";
  const stroke = space.open ? "#777777" : "#000000";
  return `
    <rect class="diagram-smart-room" x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" fill="${color}" stroke="${stroke}"></rect>
    <text class="diagram-label" x="${space.x + 1.2}" y="${space.y + Math.min(space.height - 1.5, 4.3)}">${escapeHtml(space.name)}</text>
  `;
}

function createTeamFurniture(space, program) {
  const seats = Math.max(space.team?.employeeCount || 0, 1);
  const cluster = getDeskLayoutCapacity({ seats, maxWidth: space.width - 3, maxHeight: space.height - 5, compact: program.densityType === "compact" });
  const desks = Array.from({ length: cluster.clusterCount }, (_, index) => {
    const col = index % cluster.columns;
    const row = Math.floor(index / cluster.columns);
    const x = space.x + 1.8 + col * (cluster.clusterWidth + cluster.gapX);
    const y = space.y + 4.5 + row * (cluster.clusterHeight + cluster.gapY);
    return createDeskCluster(x, y, cluster.clusterWidth, cluster.clusterHeight, cluster.gapX, cluster.gapY);
  }).join("");
  return `
    <rect class="diagram-clearance" x="${space.x + 1}" y="${space.y + 3.2}" width="${space.width - 2}" height="${space.height - 4.2}"></rect>
    ${desks}
  `;
}

function createDeskCluster(x, y, width, height, gapX, gapY) {
  return `
    <rect class="diagram-clearance" x="${x - gapX / 2}" y="${y - gapY / 2}" width="${width + gapX}" height="${height + gapY}"></rect>
    <rect class="diagram-desk" x="${x}" y="${y}" width="${width / 2}" height="${height / 2}"></rect>
    <rect class="diagram-desk" x="${x + width / 2}" y="${y}" width="${width / 2}" height="${height / 2}"></rect>
    <rect class="diagram-desk" x="${x}" y="${y + height / 2}" width="${width / 2}" height="${height / 2}"></rect>
    <rect class="diagram-desk" x="${x + width / 2}" y="${y + height / 2}" width="${width / 2}" height="${height / 2}"></rect>
    <circle class="diagram-chair" cx="${x - 1.7}" cy="${y + height * 0.25}" r="1.05"></circle>
    <circle class="diagram-chair" cx="${x - 1.7}" cy="${y + height * 0.75}" r="1.05"></circle>
    <circle class="diagram-chair" cx="${x + width + 1.7}" cy="${y + height * 0.25}" r="1.05"></circle>
    <circle class="diagram-chair" cx="${x + width + 1.7}" cy="${y + height * 0.75}" r="1.05"></circle>
  `;
}

function createSmartMeetingFurniture(space) {
  const spec = space.block?.table || meetingSpecs[6];
  const tableW = Math.min(spec.tableW, space.width - 7);
  const tableD = Math.min(spec.tableD, space.height - 8);
  const x = space.x + (space.width - tableW) / 2;
  const y = space.y + (space.height - tableD) / 2;
  return `
    <rect class="diagram-clearance" x="${space.x + 2}" y="${space.y + 3}" width="${space.width - 4}" height="${space.height - 5}"></rect>
    <rect class="diagram-furniture" x="${x}" y="${y}" width="${tableW}" height="${tableD}"></rect>
    <text class="diagram-small" x="${space.x + 2}" y="${space.y + space.height - 1.5}">${spec.table} / 의자 뒤 1000+</text>
  `;
}

function createSmartDoor(space) {
  if (space.type === "entry") {
    const center = space.x + space.width / 2;
    return `
      <line class="diagram-door" x1="${center - 4}" y1="${space.y + space.height}" x2="${center - 4}" y2="${space.y + space.height - 5}"></line>
      <line class="diagram-door" x1="${center + 4}" y1="${space.y + space.height}" x2="${center + 4}" y2="${space.y + space.height - 5}"></line>
      <text class="diagram-small" x="${space.x + 1}" y="${space.y + space.height - 1}">출입문</text>
    `;
  }
  if (space.open || space.door === "open" || !space.door) return "";
  if (space.door === "left") return createDoor(space.x, space.y + space.height - 6, "left");
  if (space.door === "right") return createDoor(space.x + space.width, space.y + space.height - 6, "right");
  return createDoor(space.x + 3, space.y + space.height, "down");
}

function getDeskLayoutCapacity({ seats, maxWidth, maxHeight, compact }) {
  const clusterWidth = compact ? 5.8 : 6.6;
  const clusterHeight = compact ? 6.4 : 7.2;
  const gapX = compact ? 4.2 : 5.4;
  const gapY = compact ? 4.8 : 5.8;
  const columns = Math.max(1, Math.floor((maxWidth + gapX) / (clusterWidth + gapX)));
  const rows = Math.max(1, Math.floor((maxHeight + gapY) / (clusterHeight + gapY)));
  const clusterCount = Math.min(Math.ceil(seats / 4), columns * rows);
  const visibleSeats = Math.min(seats, clusterCount * 4);
  return { clusterWidth, clusterHeight, gapX, gapY, columns, rows, clusterCount, visibleSeats };
}

function renderFitCalculation() {
  const result = calculateFitPlan();
  $("#fitTotalArea").textContent = `약 ${result.rangeLow}~${result.rangeHigh}평`;
  $("#fitSuitability").textContent = result.suitability;
  $("#fitWorkArea").textContent = `${roundArea(result.workArea)}평`;
  $("#fitMeetingArea").textContent = `${roundArea(result.meetingArea)}평`;
  $("#fitExecutiveArea").textContent = `${roundArea(result.executiveArea)}평`;
  $("#fitSupportArea").textContent = `${roundArea(result.supportArea)}평`;
  $("#fitLayoutCapacity").textContent = result.layoutCapacityText;
  const score = $("#fitScore");
  if (score) score.textContent = `${result.score.total}점`;
  $("#fitNotes").innerHTML = result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const report = $("#fitReport");
  if (report) {
    report.innerHTML = `
      <h3>고객용 설명</h3>
      <p>${escapeHtml(result.clientSummary)}</p>
      <div class="score-breakdown">
        ${Object.entries(result.score.items)
          .map(([key, item]) => `<span><b>${escapeHtml(item.label)}</b>${item.value}/${item.max}</span>`)
          .join("")}
      </div>
      <dl>
        <div><dt>장점</dt><dd>${escapeHtml(result.score.pros.join(" / "))}</dd></div>
        <div><dt>단점</dt><dd>${escapeHtml(result.score.cons.join(" / "))}</dd></div>
        <div><dt>개선안</dt><dd>${escapeHtml(result.score.suggestions.join(" / "))}</dd></div>
      </dl>
      <h3>블럭별 배치 이유</h3>
      <ul class="block-reason-list">
        ${result.plan.spaces
          .filter((space) => space.reason)
          .map((space) => `<li><strong>${escapeHtml(space.name)}</strong> ${escapeHtml(space.reason)}</li>`)
          .join("")}
      </ul>
    `;
  }
  $("#fitDiagram").innerHTML = createFitDiagram(result);
}

function calculateFitPlan() {
  const program = buildOfficeProgram();
  const blocks = buildSpaceBlocks(program);
  const plan = generateOfficeLayout(program, blocks);
  const score = scoreOfficeLayout(program, blocks, plan);
  const totals = summarizeOfficeAreas(program, blocks, plan);
  const propertyArea = Number($("#fitPropertyArea").value) || 0;
  const notes = buildFitNotes({ program, blocks, plan, score, totals, propertyArea });
  const clientSummary = buildClientSummary(program, score, totals);

  return {
    ...totals,
    seats: program.employeeCount,
    meetingCapacity: program.meetingRooms[0]?.capacity || 0,
    meetingCount: program.meetingRooms.reduce((sum, room) => sum + room.count, 0),
    layoutCapacity: plan.capacity.visibleSeats,
    layoutCapacityText:
      plan.capacity.visibleSeats >= program.employeeCount
        ? `${program.employeeCount}석 초안 배치`
        : `${plan.capacity.visibleSeats}/${program.employeeCount}석`,
    floorPlan: program.floorPlan,
    usageTypes: program.usageTypes,
    designChecks: program.designChecks,
    score,
    notes,
    suitability: getSuitability(propertyArea, totals.totalArea, totals.rangeHigh),
    clientSummary,
    strengths: score.pros,
    weaknesses: score.cons,
    recommendations: score.suggestions,
    plan,
    blocks,
    program,
  };
}

function buildOfficeProgram() {
  const usageTypes = $$("input[name='fitUsage']:checked").map((input) => input.value);
  const designChecks = $$("input[name='designChecks']:checked").map((input) => input.value);
  const seats = Math.max(Number($("#fitSeatCount").value) || 0, 1);
  const meetingCapacity = normalizeMeetingCapacity(Number($("#fitMeetingCapacity").value) || 0);
  const meetingCount = Math.max(Number($("#fitMeetingCount").value) || 0, 0);
  const explicitLayoutType = $("#fitLayoutType")?.value || "general";
  const visitorFrequency = usageTypes.includes("visitor") || usageTypes.includes("separate")
    ? "high"
    : $("#fitVisitorFrequency")?.value || "medium";
  const layoutType = visitorFrequency === "high" ? "visitor_heavy" : explicitLayoutType;
  const pantryValue = $("#fitPantry").value;
  const densityType = $("#fitDensity").value;

  return {
    totalArea: Number($("#fitPropertyArea").value) || 0,
    employeeCount: seats,
    desk: deskCriteria[$("#fitDeskSize").value] || deskCriteria["1400x700"],
    deskBackAisleMm: Number($("#fitDeskBackAisle")?.value) || 1000,
    deskSideAisleMm: densityType === "compact" ? 900 : densityType === "roomy" ? 1100 : 1000,
    densityType,
    density: densityProfiles[densityType] || densityProfiles.standard,
    layoutType,
    departments: parseDepartments($("#fitDepartments")?.value || "", seats),
    daylightPriority: $("#fitDaylightPriority")?.value || "balanced",
    meetingFrequency: $("#fitMeetingFrequency")?.value || "medium",
    visitorFrequency,
    needsCeoRoom: $("#fitExecutiveRoom").value !== "none" || usageTypes.includes("executive"),
    executive: executiveCriteria[$("#fitExecutiveRoom").value] || executiveCriteria.none,
    meetingRooms: meetingCapacity && meetingCount ? [{ capacity: meetingCapacity, count: meetingCount }] : [],
    needsPantry: pantryValue !== "none",
    pantry: pantryCriteria[pantryValue] || pantryCriteria.standard,
    pantryStyle: layoutType === "communication" || usageTypes.includes("dining") ? "semi_open" : pantryValue === "simple" ? "semi_open" : "closed",
    needsStorage: $("#fitStorage").value !== "low" || designChecks.includes("storageWall"),
    storage: storageCriteria[$("#fitStorage").value] || storageCriteria.medium,
    needsServerRoom: designChecks.includes("secureServer"),
    needsPhoneBooth: usageTypes.includes("call") || usageTypes.includes("focus") || designChecks.includes("acoustic"),
    needsLounge: layoutType === "communication" || usageTypes.includes("dining"),
    needsCopyZone: true,
    needsLocker: seats >= 20,
    usageTypes,
    designChecks,
    site: {
      entryPosition: $("#fitEntryPosition")?.value || "bottom",
      windowPosition: $("#fitWindowPosition")?.value || "top",
      plumbingPosition: $("#fitPlumbingPosition")?.value || "bottom_right",
      columnCount: Math.max(Number($("#fitColumnCount")?.value) || 0, 0),
      fixedElements: $("#fitFixedElements")?.value || "",
    },
    floorPlan: {
      ...state.fitFloorPlan,
      width: Number($("#fitPlanWidth").value) || 0,
      depth: Number($("#fitPlanDepth").value) || 0,
    },
  };
}

function generateOfficeLayout(program, blocks) {
  const width = Number(program.floorPlan?.width) || 18;
  const depth = Number(program.floorPlan?.depth) || 12;
  const ratio = width / depth;
  const frame = getPlanFrameByRatio(ratio);
  const visitorHeavy = program.visitorFrequency === "high" || program.layoutType === "visitor_heavy";
  const frontH = visitorHeavy ? 19 : 14;
  const serviceH = program.layoutType === "communication" ? 12 : 10;
  const leftW = visitorHeavy ? 31 : 26;
  const rightW = program.needsCeoRoom ? 24 : 14;
  const workX = frame.x + leftW;
  const workY = frame.y + 5;
  const workW = Math.max(26, frame.width - leftW - rightW);
  const workH = Math.max(24, frame.height - frontH - 7);
  const spaces = [];
  const entry = getEntrySpace(frame, program.site.entryPosition);

  spaces.push({
    ...entry,
    id: "entry",
    type: "entry",
    name: "출입구",
    open: true,
    reason: "출입구는 사용자가 지정한 위치를 기준으로 외부인 동선과 직원 동선의 시작점으로 잡았습니다.",
  });
  if (visitorHeavy) {
    spaces.push({
      id: "waiting",
      type: "waiting_area",
      name: "대기/응대",
      x: frame.x + 2,
      y: frame.y + frame.height - frontH + 2,
      width: leftW - 5,
      height: frontH - 7,
      open: true,
      reason: "외부인 방문 빈도가 높아 입구 가까이에 대기/응대 영역을 두었습니다.",
    });
  }

  const meetingBlocks = blocks.filter((block) => block.type === "meeting_room");
  meetingBlocks.forEach((block, index) => {
    const roomW = Math.min(leftW - 5, Math.max(19, block.capacity === 4 ? 19 : block.capacity === 6 ? 23 : 27));
    const roomH = Math.min(22, Math.max(14, 10 + block.capacity * 0.9));
    const nearEntryY = frame.y + frame.height - frontH - roomH - index * 3;
    const internalY = frame.y + 6 + index * (roomH + 2);
    spaces.push({
      id: block.id,
      type: "meeting_room",
      name: block.name,
      x: frame.x + 2,
      y: visitorHeavy ? Math.max(frame.y + 4, nearEntryY) : internalY,
      width: roomW,
      height: roomH,
      door: "right",
      block,
      reason: visitorHeavy
        ? "방문객이 업무공간을 관통하지 않도록 회의실을 입구 전면부에 배치했습니다."
        : "직원 접근성과 소음 분리를 균형 있게 보기 위해 업무존 가장자리에 배치했습니다.",
    });
  });

  if (program.needsCeoRoom) {
    const ceoW = Math.min(24, Math.max(17, rightW - 3));
    const ceoH = program.executive.area >= 9 ? 18 : 15;
    const ceoTop = program.daylightPriority !== "employee_first";
    spaces.push({
      id: "ceo",
      type: "ceo_room",
      name: "대표실",
      x: frame.x + frame.width - ceoW - 2,
      y: ceoTop ? frame.y + 4 : frame.y + frame.height - frontH - ceoH - 2,
      width: ceoW,
      height: ceoH,
      door: "left",
      reason: ceoTop
        ? "대표실 창가 또는 균형형 조건이라 창가 접근성과 독립성을 우선했습니다."
        : "직원 채광 우선 조건이라 대표실이 창가를 과점하지 않도록 후면으로 낮춰 배치했습니다.",
    });
  }

  const workSpaces = layoutTeamZones(program, workX, workY, workW, workH);
  const teamCapacity = workSpaces.reduce((sum, space) => {
    const capacity = getDeskLayoutCapacity({
      seats: space.team?.employeeCount || 0,
      maxWidth: space.width - 3,
      maxHeight: space.height - 5,
      compact: program.densityType === "compact",
    });
    return sum + capacity.visibleSeats;
  }, 0);
  spaces.push(...workSpaces);

  const pantryW = program.layoutType === "communication" ? 24 : 19;
  const pantryH = program.layoutType === "communication" ? 11 : 9;
  const pantryNearPlumbing = getPlumbingPoint(frame, program.site.plumbingPosition);
  spaces.push({
    id: "pantry",
    type: "pantry",
    name: program.layoutType === "communication" ? "탕비/라운지" : "탕비실",
    x: Math.min(frame.x + frame.width - pantryW - 2, Math.max(frame.x + 2, pantryNearPlumbing.x - pantryW * 0.72)),
    y: Math.min(frame.y + frame.height - pantryH - 2, Math.max(frame.y + 2, pantryNearPlumbing.y - pantryH * 0.45)),
    width: pantryW,
    height: pantryH,
    door: program.pantryStyle === "closed" ? "left" : "open",
    reason: "급배수 위치와 직원 접근성을 함께 고려해 배치했습니다. 하부장 D600과 전면 동선 900mm를 기준으로 봅니다.",
  });
  if (program.needsLounge) {
    spaces.push({
      id: "lounge",
      type: "open_lounge",
      name: "오픈 라운지",
      x: workX,
      y: frame.y + frame.height - serviceH - 1,
      width: Math.max(20, workW * 0.45),
      height: serviceH - 4,
      open: true,
      reason: "소통형 조건에서 직원들이 자연스럽게 마주치는 메인 동선 가까이에 두었습니다.",
    });
  }
  spaces.push({
    id: "copy",
    type: "copy_zone",
    name: "OA",
    x: workX + workW * 0.42,
    y: frame.y + frame.height - serviceH + 2,
    width: 14,
    height: 4,
    open: true,
    reason: "업무공간 접근성은 확보하되 대표실 바로 앞은 피하는 위치입니다.",
  });
  if (program.needsStorage) {
    spaces.push({
      id: "storage",
      type: "storage",
      name: "수납 D400",
      x: frame.x + frame.width - 24,
      y: frame.y + 2,
      width: 21,
      height: 4,
      open: true,
      reason: "창가 우선순위가 낮은 수납은 벽면과 죽은 공간 활용을 우선했습니다.",
    });
  }
  if (program.needsPhoneBooth) {
    spaces.push({
      id: "phone",
      type: "phone_booth",
      name: "폰부스",
      x: workX + workW - 9,
      y: workY + workH - 9,
      width: 7,
      height: 7,
      door: "left",
      reason: "업무공간에서 너무 멀지 않으면서 탕비/OA 소음과 분리되는 위치입니다.",
    });
  }
  if (program.needsServerRoom) {
    spaces.push({
      id: "server",
      type: "server_room",
      name: "서버",
      x: frame.x + frame.width - 10,
      y: frame.y + 8,
      width: 8,
      height: 8,
      door: "left",
      reason: "보안과 환기, 코어 접근성을 고려해 외곽부에 둔 초안입니다.",
    });
  }

  return {
    frame,
    spaces,
    capacity: {
      ...getDeskLayoutCapacity({ seats: program.employeeCount, maxWidth: workW - 3, maxHeight: workH - 4, compact: program.densityType === "compact" }),
      visibleSeats: teamCapacity,
    },
    mainAisle: { x: frame.x + frame.width * 0.48, y: frame.y + 4, width: 5.5, height: frame.height - 10 },
    visitorPath: visitorHeavy,
    windowLine: getWindowLine(frame, program.site.windowPosition),
    plumbingPoint: pantryNearPlumbing,
    columns: createColumnMarkers(frame, program.site.columnCount),
  };
}

function layoutTeamZones(program, x, y, width, height) {
  const total = program.departments.reduce((sum, team) => sum + team.employeeCount, 0) || program.employeeCount;
  let cursorY = y;
  return program.departments.map((team, index) => {
    const zoneH = index === program.departments.length - 1
      ? y + height - cursorY
      : Math.max(10, height * (team.employeeCount / total));
    const reason = team.needsFocus
      ? "집중 업무가 필요한 팀이라 메인 동선과 소음원에서 거리를 두는 방향으로 잡았습니다."
      : team.needsCollaboration
        ? "협업 빈도가 높은 팀이라 회의실과 공용공간 접근성을 우선했습니다."
        : "기본 업무존으로 좌석 효율과 창가 접근성을 균형 있게 반영했습니다.";
    const zone = {
      id: `team-${index}`,
      type: "team_zone",
      name: `${team.name} ${team.employeeCount}석`,
      x,
      y: cursorY,
      width,
      height: Math.max(10, zoneH - 1.5),
      open: true,
      team,
      reason,
    };
    cursorY += zoneH;
    return zone;
  });
}

function scoreOfficeLayout(program, blocks, plan) {
  const hasVisitorFront = plan.spaces.some((space) => ["meeting_room", "waiting_area"].includes(space.type) && space.y > plan.frame.y + plan.frame.height * 0.48);
  const ceo = plan.spaces.find((space) => space.type === "ceo_room");
  const pantry = plan.spaces.find((space) => space.type === "pantry");
  const meetingCount = plan.spaces.filter((space) => space.type === "meeting_room").length;
  const columns = program.site.columnCount;
  const shortage = Math.max(program.employeeCount - plan.capacity.visibleSeats, 0);
  const focusedTeams = program.departments.filter((team) => team.needsFocus).length;
  const collaborativeTeams = program.departments.filter((team) => team.needsCollaboration).length;

  const items = {
    seatFit: scoreItem("좌석 수", 15, shortage ? Math.max(0, 15 - shortage * 2) : 15),
    circulation: scoreItem("동선 효율", 15, 15 - (program.designChecks.includes("firePath") ? 0 : 1) - (columns >= 4 ? 2 : 0)),
    meetingFit: scoreItem("회의/공용", 15, Math.min(15, 8 + meetingCount * 3 + (program.meetingFrequency === "high" && meetingCount >= 2 ? 2 : 0))),
    typeMatch: scoreItem("타입 일치", 15, getTypeMatchScore(program, hasVisitorFront)),
    constructability: scoreItem("시공성", 10, 10 - (program.site.plumbingPosition && pantry ? 0 : 2) - (columns >= 6 ? 2 : 0)),
    daylight: scoreItem("채광", 10, getDaylightScore(program, ceo)),
    visitorSeparation: scoreItem("방문객 분리", 10, program.visitorFrequency === "high" ? (hasVisitorFront ? 10 : 4) : 8),
    departmentFit: scoreItem("부서 구성", 5, Math.min(5, 3 + (focusedTeams ? 1 : 0) + (collaborativeTeams ? 1 : 0))),
    pantryLoungeFit: scoreItem("탕비/라운지", 5, program.layoutType === "communication" ? (program.needsLounge ? 5 : 3) : pantry ? 4 : 2),
  };
  const total = Object.values(items).reduce((sum, item) => sum + item.value, 0);
  const pros = [];
  const cons = [];
  const suggestions = [];

  if (!shortage) pros.push("요청 좌석 수가 업무존 프레임 안에 들어갑니다.");
  else {
    cons.push(`현재 초안에서는 ${shortage}석이 부족합니다.`);
    suggestions.push("업무존 폭을 넓히거나 회의실/라운지 면적을 조정하세요.");
  }
  if (program.visitorFrequency === "high" && hasVisitorFront) pros.push("회의실과 대기공간이 입구 가까이에 있어 외부인 응대에 유리합니다.");
  if (program.visitorFrequency === "high" && !hasVisitorFront) {
    cons.push("외부인이 직원 업무공간을 깊게 지나갈 가능성이 있습니다.");
    suggestions.push("회의실과 대기공간을 입구 전면으로 옮기세요.");
  }
  if (program.daylightPriority === "employee_first" && ceo && ceo.y <= plan.frame.y + 8) {
    cons.push("직원 채광 우선 조건에서 대표실이 창가를 많이 점유합니다.");
    suggestions.push("대표실 폭을 줄이거나 위치를 후면으로 조정하세요.");
  } else if (ceo) {
    pros.push("대표실의 독립성과 채광 조건을 함께 고려했습니다.");
  }
  if (program.layoutType === "communication" && program.needsLounge) pros.push("탕비실과 라운지를 연결해 직원 소통 흐름을 만들었습니다.");
  if (program.layoutType === "independent" && pantry && pantry.x < plan.frame.x + plan.frame.width * 0.55) {
    cons.push("독립형 조건에서는 탕비/라운지 소음이 업무존에 가까울 수 있습니다.");
    suggestions.push("탕비실을 코어 또는 외곽 쪽으로 이동하면 집중도가 좋아집니다.");
  }
  if (columns >= 4) {
    cons.push("기둥 수가 많아 좌석 효율과 동선에 간섭이 생길 수 있습니다.");
    suggestions.push("기둥 주변은 수납, OA, 라운지 보조 영역으로 활용하세요.");
  }
  if (program.site.fixedElements) suggestions.push(`고정 요소 메모(${program.site.fixedElements})는 실측 도면 위에서 벽체 충돌을 재확인하세요.`);
  if (!cons.length) cons.push("자동 초안 기준에서 큰 충돌은 보이지 않습니다.");
  if (!suggestions.length) suggestions.push("실측 도면 위에서 벽체, 문 열림, 기둥 간섭을 수동 보정하세요.");

  return {
    total: Math.max(45, Math.min(100, Math.round(total))),
    seatFit: items.seatFit.value,
    circulation: items.circulation.value,
    meetingFit: items.meetingFit.value,
    typeMatch: items.typeMatch.value,
    constructability: items.constructability.value,
    daylight: items.daylight.value,
    visitorSeparation: items.visitorSeparation.value,
    departmentFit: items.departmentFit.value,
    pantryLoungeFit: items.pantryLoungeFit.value,
    items,
    pros: pros.slice(0, 5),
    cons: cons.slice(0, 5),
    suggestions: suggestions.slice(0, 5),
    strengths: pros.slice(0, 5),
    weaknesses: cons.slice(0, 5),
    recommendations: suggestions.slice(0, 5),
  };
}

function scoreItem(label, max, rawValue) {
  return { label, max, value: Math.max(0, Math.min(max, Math.round(rawValue))) };
}

function getTypeMatchScore(program, hasVisitorFront) {
  if (program.layoutType === "visitor_heavy") return hasVisitorFront ? 15 : 7;
  if (program.layoutType === "communication") return program.needsLounge ? 15 : 11;
  if (program.layoutType === "independent") return program.needsPhoneBooth || program.designChecks.includes("acoustic") ? 14 : 12;
  return 13;
}

function getDaylightScore(program, ceo) {
  if (!ceo) return program.daylightPriority === "employee_first" ? 10 : 8;
  const ceoNearWindow = ceo.y <= 12;
  if (program.daylightPriority === "ceo_room_first") return ceoNearWindow ? 10 : 6;
  if (program.daylightPriority === "employee_first") return ceoNearWindow ? 6 : 10;
  return 8;
}

function buildFitNotes({ program, plan, score, totals, propertyArea }) {
  const notes = [
    `${layoutTypeLabels[program.layoutType]} / ${program.density.label} / ${daylightLabels[program.daylightPriority]} 기준으로 자동 블럭 초안을 생성했습니다.`,
    `메인 동선은 약 ${program.density.mainAisle * 100}mm, 의자 뒤 여유는 약 ${program.density.chairBack * 100}mm 기준으로 계산했습니다.`,
    `부서 구성 ${program.departments.length}개를 팀존으로 분할했고, 좌석 ${program.employeeCount}석 중 도면 프레임상 ${plan.capacity.visibleSeats}석까지 표시 가능합니다.`,
    `적합성 점수는 ${score.total}점입니다. 좌석 ${score.seatFit}/15, 동선 ${score.circulation}/15, 타입 ${score.typeMatch}/15, 시공성 ${score.constructability}/10으로 나누어 산정했습니다.`,
  ];
  if (program.meetingRooms.length) notes.push(`회의실은 ${program.meetingRooms.map((room) => `${room.capacity}인 ${room.count}개`).join(", ")} 기준이며, 회의 빈도와 외부인 방문 빈도에 따라 입구 접근성을 조정합니다.`);
  if (program.layoutType === "communication") notes.push("소통형 조건으로 탕비실은 반오픈 라운지 성격을 우선 추천합니다.");
  if (program.layoutType === "independent") notes.push("독립형 조건으로 소음원과 집중 업무존 사이의 거리를 점수에 반영했습니다.");
  if (program.visitorFrequency === "high") notes.push("외부인 방문 빈도가 높아 회의실/대기공간을 입구 전면부에 우선 배치했습니다.");
  if (program.site.columnCount) notes.push(`기둥 ${program.site.columnCount}개를 도면 마커로 표시하고, 좌석 효율/동선 감점 요소로 반영했습니다.`);
  if (program.site.fixedElements) notes.push(`코어/화장실/고정벽 메모: ${program.site.fixedElements}`);
  if (program.floorPlan.name) notes.push(`업로드된 도면 "${program.floorPlan.name}"은 배경 참고용이며, 현재 MVP는 도면 자동 인식보다 룰 기반 배치를 우선합니다.`);
  if (program.floorPlan.width && program.floorPlan.depth) notes.push(`평면 비율은 가로 ${program.floorPlan.width}m x 세로 ${program.floorPlan.depth}m 기준으로 잡았습니다.`);
  if (propertyArea) notes.push(`검토 매물 ${propertyArea}평 대비 권장 범위는 약 ${totals.rangeLow}~${totals.rangeHigh}평입니다.`);
  return notes;
}

function buildClientSummary(program, score, totals) {
  const firstSuggestion = score.suggestions[0] || "실측 도면 위에서 세부 벽체와 문 위치를 보정하는 것이 좋습니다.";
  return `이 배치는 ${layoutTypeLabels[program.layoutType]} 조건에 맞춰 공간 관계와 동선을 우선 검토한 초안입니다. 현재 안은 약 ${totals.rangeLow}~${totals.rangeHigh}평 수준의 전용면적을 권장하며, 적합성은 ${score.total}점으로 산정됩니다. ${score.pros[0] || "요청 조건을 기준으로 주요 공간을 배치했습니다."} 다만 ${score.cons[0] || "실측 도면 확인 전까지는 일부 오차가 있을 수 있습니다."} ${firstSuggestion}`;
}

function createFitDiagram(result) {
  const { plan, program } = result;
  const background = createPlanBackground(program.floorPlan);
  const rooms = plan.spaces.map((space) => createSmartSpace(space, program)).join("");
  const workFurniture = plan.spaces.filter((space) => space.type === "team_zone").map((space) => createTeamFurniture(space, program)).join("");
  const meetingFurniture = plan.spaces.filter((space) => space.type === "meeting_room").map((space) => createSmartMeetingFurniture(space)).join("");
  const doors = plan.spaces.map(createSmartDoor).join("");
  const columns = plan.columns.map((column, index) => `<circle class="diagram-column" cx="${column.x}" cy="${column.y}" r="1.35"></circle><text class="diagram-small" x="${column.x + 1.8}" y="${column.y + 0.7}">C${index + 1}</text>`).join("");
  const visitorPath = plan.visitorPath
    ? `<path class="diagram-visitor-path" d="M ${plan.frame.x + plan.frame.width * 0.5} ${plan.frame.y + plan.frame.height - 2} L ${plan.frame.x + 15} ${plan.frame.y + plan.frame.height - 12} L ${plan.frame.x + 15} ${plan.frame.y + plan.frame.height - 30}" />`
    : "";
  return `
    <svg viewBox="0 0 100 72" role="img" aria-label="오피스 테스트핏 자동 블록 초안">
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
        </marker>
      </defs>
      <rect x="2" y="2" width="96" height="68" fill="#ffffff" stroke="#111111" stroke-width="0.45"></rect>
      ${background}
      ${createWindowMarker(plan.windowLine)}
      <circle class="diagram-plumbing" cx="${plan.plumbingPoint.x}" cy="${plan.plumbingPoint.y}" r="1.45"></circle>
      <text class="diagram-small" x="${plan.plumbingPoint.x + 2}" y="${plan.plumbingPoint.y + 0.8}">급배수</text>
      <rect class="diagram-aisle-fill" x="${plan.mainAisle.x}" y="${plan.mainAisle.y}" width="${plan.mainAisle.width}" height="${plan.mainAisle.height}"></rect>
      ${visitorPath}
      ${rooms}
      ${columns}
      ${workFurniture}
      ${meetingFurniture}
      ${doors}
      <text class="diagram-dimension" x="5" y="68">자동 초안: ${layoutTypeLabels[program.layoutType]} / 점수 ${result.score.total} / 메인동선 ${program.density.mainAisle * 100}mm / 의자 뒤 ${program.density.chairBack * 100}mm</text>
    </svg>
  `;
}

function createSmartSpace(space, program) {
  const color = {
    entry: "#e6efe9",
    waiting_area: "#d9ece8",
    meeting_room: "#ffffff",
    ceo_room: "#ffffff",
    team_zone: "#fdfdfb",
    pantry: program.pantryStyle === "closed" ? "#ffffff" : "#f5fbf7",
    open_lounge: "#f5fbf7",
    copy_zone: "#d6edf3",
    storage: "#d6edf3",
    server_room: "#ffffff",
    phone_booth: "#ffffff",
  }[space.type] || "#ffffff";
  const stroke = space.open ? "#777777" : "#000000";
  return `
    <rect class="diagram-smart-room" x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" fill="${color}" stroke="${stroke}"></rect>
    <text class="diagram-label" x="${space.x + 1.2}" y="${space.y + Math.min(space.height - 1.5, 4.3)}">${escapeHtml(space.name)}</text>
  `;
}

function getEntrySpace(frame, position) {
  if (position === "left") return { x: frame.x, y: frame.y + frame.height * 0.72, width: 5, height: 9 };
  if (position === "right") return { x: frame.x + frame.width - 5, y: frame.y + frame.height * 0.72, width: 5, height: 9 };
  if (position === "top") return { x: frame.x + frame.width * 0.43, y: frame.y, width: frame.width * 0.14, height: 5 };
  return { x: frame.x + frame.width * 0.43, y: frame.y + frame.height - 5, width: frame.width * 0.14, height: 5 };
}

function getWindowLine(frame, position) {
  if (position === "left") return { x1: frame.x + 1, y1: frame.y + 3, x2: frame.x + 1, y2: frame.y + frame.height - 3 };
  if (position === "right") return { x1: frame.x + frame.width - 1, y1: frame.y + 3, x2: frame.x + frame.width - 1, y2: frame.y + frame.height - 3 };
  if (position === "bottom") return { x1: frame.x + 3, y1: frame.y + frame.height - 1, x2: frame.x + frame.width - 3, y2: frame.y + frame.height - 1 };
  return { x1: frame.x + 3, y1: frame.y + 1.5, x2: frame.x + frame.width - 3, y2: frame.y + 1.5 };
}

function createWindowMarker(line) {
  return `<line class="diagram-window" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"></line>`;
}

function getPlumbingPoint(frame, position) {
  const map = {
    bottom_right: { x: frame.x + frame.width - 8, y: frame.y + frame.height - 8 },
    top_right: { x: frame.x + frame.width - 8, y: frame.y + 8 },
    bottom_left: { x: frame.x + 8, y: frame.y + frame.height - 8 },
    top_left: { x: frame.x + 8, y: frame.y + 8 },
  };
  return map[position] || map.bottom_right;
}

function createColumnMarkers(frame, count) {
  const safeCount = Math.min(count, 12);
  const columns = [];
  const cols = Math.ceil(Math.sqrt(safeCount || 1));
  const rows = Math.ceil((safeCount || 1) / cols);
  for (let index = 0; index < safeCount; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    columns.push({
      x: frame.x + frame.width * (0.28 + (col / Math.max(cols - 1, 1)) * 0.42),
      y: frame.y + frame.height * (0.28 + (row / Math.max(rows - 1, 1)) * 0.38),
    });
  }
  return columns;
}

function generateOfficeLayout(program, blocks) {
  const widthM = Number(program.floorPlan?.width) || 18;
  const depthM = Number(program.floorPlan?.depth) || 12;
  const ratio = widthM / depthM;
  const frame = getPlanFrameByRatio(ratio);
  const visitorHeavy = program.visitorFrequency === "high" || program.layoutType === "visitor_heavy";
  const unit = getPlanUnit(frame, widthM, depthM);
  const m = (value) => value * unit;
  const entry = getEntrySpace(frame, program.site.entryPosition);
  const frontDepth = visitorHeavy ? Math.min(m(4.2), frame.height * 0.34) : Math.min(m(2.8), frame.height * 0.24);
  const serviceDepth = Math.min(program.layoutType === "communication" ? m(3.2) : m(2.5), frame.height * 0.22);
  const leftWidth = Math.min(visitorHeavy ? m(5.8) : m(4.8), frame.width * 0.34);
  const rightWidth = program.needsCeoRoom ? Math.min(m(4.6), frame.width * 0.28) : Math.min(m(2.8), frame.width * 0.18);
  const spaces = [];

  spaces.push({
    ...entry,
    id: "entry",
    type: "entry",
    name: "출입구",
    open: true,
    reason: "출입구 지정값을 기준으로 배치했고, 회의/응대 동선이 여기서 바로 시작되도록 했습니다.",
  });

  if (visitorHeavy) {
    spaces.push({
      id: "waiting",
      type: "waiting_area",
      name: "대기/응대",
      x: frame.x,
      y: frame.y + frame.height - frontDepth,
      width: leftWidth,
      height: frontDepth,
      open: true,
      reason: "외부인 출입이 잦은 조건이므로 입구 바로 옆에 두어 직원 업무공간 관통을 줄였습니다.",
    });
  }

  const meetingBlocks = blocks.filter((block) => block.type === "meeting_room");
  const meetingAreaX = visitorHeavy ? frame.x + leftWidth : frame.x;
  const meetingAreaY = visitorHeavy ? frame.y + frame.height - frontDepth : frame.y;
  const meetingAreaW = visitorHeavy ? Math.min(m(6.2), frame.width * 0.34) : leftWidth;
  const meetingAreaH = visitorHeavy ? frontDepth : Math.max(frame.height - serviceDepth, m(6));
  meetingBlocks.forEach((block, index) => {
    const roomH = meetingBlocks.length > 1 ? meetingAreaH / meetingBlocks.length : meetingAreaH;
    spaces.push({
      id: block.id,
      type: "meeting_room",
      name: block.name,
      x: meetingAreaX,
      y: meetingAreaY + index * roomH,
      width: meetingAreaW,
      height: roomH,
      door: visitorHeavy ? "top" : "right",
      block,
      reason: visitorHeavy
        ? "외부인 방문 빈도가 높아 회의실을 출입구와 같은 전면 밴드에 배치했습니다."
        : "일반 조건에서는 회의실을 업무존 옆에 붙여 내부 접근성과 소음 분리를 함께 봤습니다.",
    });
  });

  const ceoW = program.needsCeoRoom ? rightWidth : 0;
  const ceoH = program.needsCeoRoom ? Math.min(program.executive.area >= 9 ? m(4.2) : m(3.4), frame.height - serviceDepth) : 0;
  if (program.needsCeoRoom) {
    const ceoNearWindow = program.daylightPriority !== "employee_first";
    const ceoY = ceoNearWindow
      ? frame.y
      : frame.y + Math.max(m(3.6), frame.height - frontDepth - ceoH);
    spaces.push({
      id: "ceo",
      type: "ceo_room",
      name: "대표실",
      x: frame.x + frame.width - ceoW,
      y: ceoY,
      width: ceoW,
      height: ceoH,
      door: "left",
      reason: ceoNearWindow
        ? "대표실 창가 우선 또는 균형형 조건이라 창가 쪽 독립실로 배치했습니다."
        : "직원 채광 우선 조건이라 대표실이 창가 전체를 차지하지 않도록 후면으로 내렸습니다.",
    });
  }

  const pantryPoint = getPlumbingPoint(frame, program.site.plumbingPosition);
  const pantryW = Math.min(program.layoutType === "communication" ? m(4.6) : m(3.8), frame.width * 0.28);
  const pantryH = serviceDepth;
  const pantryX = Math.min(frame.x + frame.width - pantryW, Math.max(frame.x, pantryPoint.x - pantryW * 0.65));
  const pantryY = Math.min(frame.y + frame.height - pantryH, Math.max(frame.y, pantryPoint.y - pantryH * 0.5));
  spaces.push({
    id: "pantry",
    type: "pantry",
    name: program.layoutType === "communication" ? "탕비/라운지" : "탕비실",
    x: pantryX,
    y: pantryY,
    width: pantryW,
    height: pantryH,
    door: program.pantryStyle === "closed" ? "left" : "open",
    reason: "급배수 마커와 가장 가까운 서비스 영역에 두고, 하부장 D600과 전면 동선 900mm를 기준으로 잡았습니다.",
  });

  const serviceLeftW = Math.max(0, pantryX - frame.x);
  if (program.layoutType === "communication" && serviceLeftW > m(3)) {
    spaces.push({
      id: "lounge",
      type: "open_lounge",
      name: "오픈 라운지",
      x: frame.x,
      y: frame.y + frame.height - serviceDepth,
      width: serviceLeftW,
      height: serviceDepth,
      open: true,
      reason: "소통형 조건이라 탕비실과 이어지는 공용 라운지로 하단 서비스 밴드를 채웠습니다.",
    });
  }

  const workX = visitorHeavy ? frame.x : frame.x + leftWidth;
  const workY = frame.y;
  const workW = Math.max(m(4), frame.x + frame.width - ceoW - workX);
  const workBottomLimit = Math.min(frame.y + frame.height - serviceDepth, visitorHeavy ? frame.y + frame.height - frontDepth : frame.y + frame.height - serviceDepth);
  const workH = Math.max(m(4), workBottomLimit - workY);
  const workSpaces = layoutTeamZones(program, workX, workY, workW, workH);
  spaces.push(...workSpaces);

  if (program.needsStorage) {
    spaces.push({
      id: "storage",
      type: "storage",
      name: "수납 D400",
      x: frame.x + frame.width - Math.min(m(4.2), frame.width * 0.24),
      y: frame.y + frame.height - serviceDepth - Math.min(m(0.5), 3),
      width: Math.min(m(4.2), frame.width * 0.24),
      height: Math.min(m(0.4), 2.8),
      open: true,
      reason: "수납은 D400 깊이를 스케일에 맞춰 벽면 라인으로 배치했습니다.",
    });
  }
  if (program.needsPhoneBooth && workW > m(3)) {
    spaces.push({
      id: "phone",
      type: "phone_booth",
      name: "폰부스",
      x: workX + workW - m(1.3),
      y: workY + workH - m(1.5),
      width: m(1.2),
      height: m(1.4),
      door: "left",
      reason: "업무공간에서 접근 가능하지만 탕비/OA와 직접 붙지 않는 가장자리로 배치했습니다.",
    });
  }

  const teamCapacity = workSpaces.reduce((sum, space) => sum + calculateScaledSeatCapacity(space, program, frame), 0);
  const circulationSpaces = buildCirculationBlocks(frame, spaces, program, visitorHeavy, unit);
  spaces.push(...circulationSpaces);

  return {
    frame,
    spaces,
    capacity: {
      ...getDeskLayoutCapacity({ seats: program.employeeCount, maxWidth: workW, maxHeight: workH, compact: program.densityType === "compact" }),
      visibleSeats: teamCapacity,
    },
    mainAisle: circulationSpaces[0] || { x: workX - m(1.1), y: frame.y, width: m(1.1), height: frame.height },
    visitorPath: visitorHeavy,
    windowLine: getWindowLine(frame, program.site.windowPosition),
    plumbingPoint: pantryPoint,
    columns: createColumnMarkers(frame, program.site.columnCount),
    unit,
    widthM,
    depthM,
  };
}

function buildCirculationBlocks(frame, spaces, program, visitorHeavy, unit) {
  const aisleWidth = (program.density.mainAisle / 10) * unit;
  const blocks = [];
  if (visitorHeavy) {
    blocks.push({
      id: "visitor-corridor",
      type: "corridor",
      name: "외부인 동선",
      x: frame.x,
      y: frame.y + frame.height - Math.max(aisleWidth, 5),
      width: frame.width,
      height: Math.max(aisleWidth, 5),
      open: true,
      reason: "외부인 출입이 잦아 입구에서 회의실/대기공간으로 바로 이어지는 파스텔 동선 블럭입니다.",
    });
  }
  blocks.push({
    id: "main-corridor",
    type: "corridor",
    name: "직원 메인동선",
    x: Math.max(frame.x, frame.x + frame.width * 0.48 - aisleWidth / 2),
    y: frame.y,
    width: Math.max(aisleWidth, 4.2),
    height: frame.height,
    open: true,
    reason: "직원 메인 동선 폭을 밀도 기준에 맞춰 파스텔 블럭으로 표시했습니다.",
  });
  return blocks;
}

function createFitDiagram(result) {
  const { plan, program } = result;
  const background = createPlanBackground(program.floorPlan);
  const grid = createScaleGrid(plan);
  const orderedSpaces = [
    ...plan.spaces.filter((space) => space.type === "corridor"),
    ...plan.spaces.filter((space) => space.type !== "corridor"),
  ];
  const rooms = orderedSpaces.map((space) => createSmartSpace(space, program)).join("");
  const workFurniture = plan.spaces.filter((space) => space.type === "team_zone").map((space) => createTeamFurniture(space, program, plan)).join("");
  const meetingFurniture = plan.spaces.filter((space) => space.type === "meeting_room").map((space) => createSmartMeetingFurniture(space, plan)).join("");
  const supportFurniture = plan.spaces.map((space) => createSupportFurniture(space, plan)).join("");
  const doors = plan.spaces.map(createSmartDoor).join("");
  const columns = plan.columns.map((column, index) => `<circle class="diagram-column" cx="${column.x}" cy="${column.y}" r="1.35"></circle><text class="diagram-small" x="${column.x + 1.8}" y="${column.y + 0.7}">C${index + 1}</text>`).join("");
  return `
    <svg viewBox="0 0 100 72" role="img" aria-label="오피스 테스트핏 1/50 블록 플랜 초안">
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
        </marker>
      </defs>
      <rect x="2" y="2" width="96" height="68" fill="#ffffff" stroke="#111111" stroke-width="0.45"></rect>
      ${background}
      ${grid}
      ${createWindowMarker(plan.windowLine)}
      <circle class="diagram-plumbing" cx="${plan.plumbingPoint.x}" cy="${plan.plumbingPoint.y}" r="1.25"></circle>
      <text class="diagram-small" x="${plan.plumbingPoint.x + 1.8}" y="${plan.plumbingPoint.y + 0.7}">급배수</text>
      ${rooms}
      ${columns}
      ${workFurniture}
      ${meetingFurniture}
      ${supportFurniture}
      ${doors}
      <text class="diagram-dimension" x="5" y="68">SCALE 1/50 기준 · ${plan.widthM}m x ${plan.depthM}m · ${program.desk.label} · 메인동선 ${program.density.mainAisle * 100}mm · 의자 뒤 ${program.density.chairBack * 100}mm</text>
    </svg>
  `;
}

function createScaleGrid(plan) {
  const lines = [];
  const step = plan.unit;
  for (let x = plan.frame.x; x <= plan.frame.x + plan.frame.width + 0.01; x += step) {
    lines.push(`<line class="diagram-scale-grid" x1="${x}" y1="${plan.frame.y}" x2="${x}" y2="${plan.frame.y + plan.frame.height}"></line>`);
  }
  for (let y = plan.frame.y; y <= plan.frame.y + plan.frame.height + 0.01; y += step) {
    lines.push(`<line class="diagram-scale-grid" x1="${plan.frame.x}" y1="${y}" x2="${plan.frame.x + plan.frame.width}" y2="${y}"></line>`);
  }
  return lines.join("");
}

function createSmartSpace(space, program) {
  const color = {
    entry: "#e8f0eb",
    waiting_area: "#d8ece8",
    meeting_room: "#e8f1f8",
    ceo_room: "#f4eadf",
    team_zone: "#f6f3df",
    pantry: "#f4e5b8",
    open_lounge: "#e4efd8",
    copy_zone: "#d7edf2",
    storage: "#d7edf2",
    server_room: "#ece8f4",
    phone_booth: "#ece8f4",
    corridor: "#e4efe9",
  }[space.type] || "#ffffff";
  const stroke = space.type === "corridor" ? "#7cae96" : "#000000";
  return `
    <rect class="diagram-smart-room diagram-space-${space.type}" x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" fill="${color}" stroke="${stroke}"></rect>
    <text class="diagram-label" x="${space.x + 1.1}" y="${space.y + Math.min(space.height - 1, 3.7)}">${escapeHtml(space.name)}</text>
  `;
}

function createTeamFurniture(space, program, plan) {
  const seats = Math.max(space.team?.employeeCount || 0, 1);
  const desk = getDeskMetric(program);
  const unit = plan.unit;
  const deskW = desk.widthM * unit;
  const deskD = desk.depthM * unit;
  const sideAisle = (program.density.deskSide / 10) * unit;
  const backAisle = (program.density.chairBack / 10) * unit;
  const rowGap = backAisle + deskD;
  const colGap = sideAisle + deskW;
  const usableX = space.x + 1.1;
  const usableY = space.y + 4.2;
  const usableW = Math.max(0, space.width - 2.2);
  const usableH = Math.max(0, space.height - 5.2);
  const columns = Math.max(1, Math.floor((usableW + sideAisle) / colGap));
  const rows = Math.max(1, Math.floor((usableH + backAisle) / rowGap));
  const drawSeats = Math.min(seats, columns * rows);
  const desks = Array.from({ length: drawSeats }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = usableX + col * colGap;
    const y = usableY + row * rowGap;
    return createScaledDesk(x, y, deskW, deskD, unit);
  }).join("");
  return `
    <rect class="diagram-clearance" x="${usableX}" y="${usableY}" width="${Math.min(usableW, columns * colGap - sideAisle)}" height="${Math.min(usableH, rows * rowGap - backAisle)}"></rect>
    ${desks}
    <text class="diagram-small" x="${space.x + 1.1}" y="${space.y + space.height - 1.1}">${drawSeats}/${seats}석 · 책상 ${desk.label}</text>
  `;
}

function createScaledDesk(x, y, width, depth, unit) {
  const chairR = Math.max(0.45, 0.22 * unit);
  return `
    <rect class="diagram-desk" x="${x}" y="${y}" width="${width}" height="${depth}"></rect>
    <line class="diagram-furniture-line" x1="${x + width * 0.5}" y1="${y}" x2="${x + width * 0.5}" y2="${y + depth}"></line>
    <circle class="diagram-chair" cx="${x + width * 0.5}" cy="${y + depth + chairR * 1.9}" r="${chairR}"></circle>
  `;
}

function createSmartMeetingFurniture(space, plan) {
  const spec = space.block?.table || meetingSpecs[6];
  const table = parseMetricLabel(spec.table);
  const tableW = table.widthM * plan.unit;
  const tableD = table.depthM * plan.unit;
  const x = space.x + (space.width - tableW) / 2;
  const y = space.y + (space.height - tableD) / 2;
  return `
    <rect class="diagram-clearance" x="${space.x + plan.unit}" y="${space.y + plan.unit}" width="${Math.max(0, space.width - plan.unit * 2)}" height="${Math.max(0, space.height - plan.unit * 2)}"></rect>
    <rect class="diagram-furniture" x="${x}" y="${y}" width="${tableW}" height="${tableD}"></rect>
    <text class="diagram-small" x="${space.x + 1.1}" y="${space.y + space.height - 1.1}">${spec.table} · 의자 뒤 1000+</text>
  `;
}

function createSupportFurniture(space, plan) {
  if (space.type === "pantry") {
    const counterD = 0.6 * plan.unit;
    return `
      <rect class="diagram-counter" x="${space.x + 0.5}" y="${space.y + 0.5}" width="${Math.max(0, space.width - 1)}" height="${counterD}"></rect>
      <text class="diagram-small" x="${space.x + 1.1}" y="${space.y + counterD + 2.1}">하부장 D600 · 전면 900+</text>
    `;
  }
  if (space.type === "storage") {
    const depth = 0.4 * plan.unit;
    return `<rect class="diagram-counter" x="${space.x}" y="${space.y}" width="${space.width}" height="${Math.max(depth, 1.2)}"></rect>`;
  }
  return "";
}

function calculateScaledSeatCapacity(space, program, planOrFrame) {
  const frame = planOrFrame.frame ? planOrFrame.frame : planOrFrame;
  const widthM = Number(program.floorPlan?.width) || 18;
  const depthM = Number(program.floorPlan?.depth) || 12;
  const unit = planOrFrame.unit || getPlanUnit(frame, widthM, depthM);
  const desk = getDeskMetric(program);
  const deskW = desk.widthM * unit;
  const deskD = desk.depthM * unit;
  const sideAisle = (program.density.deskSide / 10) * unit;
  const backAisle = (program.density.chairBack / 10) * unit;
  const usableW = Math.max(0, space.width - 2.2);
  const usableH = Math.max(0, space.height - 5.2);
  const columns = Math.max(0, Math.floor((usableW + sideAisle) / (deskW + sideAisle)));
  const rows = Math.max(0, Math.floor((usableH + backAisle) / (deskD + backAisle)));
  return Math.min(space.team?.employeeCount || 0, Math.max(columns * rows, columns));
}

function getPlanUnit(frame, widthM, depthM) {
  return Math.min(frame.width / Math.max(widthM, 1), frame.height / Math.max(depthM, 1));
}

function getDeskMetric(program) {
  return parseMetricLabel(program.desk?.label || "1400x700");
}

function parseMetricLabel(label) {
  const match = String(label).match(/(\d{3,4})\D+(\d{3,4})/);
  const width = match ? Number(match[1]) : 1400;
  const depth = match ? Number(match[2]) : 700;
  return {
    label: `${width}x${depth}`,
    widthM: width / 1000,
    depthM: depth / 1000,
  };
}

function generateOfficeLayout(program, blocks) {
  const widthM = Number(program.floorPlan?.width) || 18;
  const depthM = Number(program.floorPlan?.depth) || 12;
  const frame = getPlanFrameByRatio(widthM / depthM);
  const unit = getPlanUnit(frame, widthM, depthM);
  const options = [
    buildBlockPlanOption(program, blocks, frame, unit, widthM, depthM, "A"),
    buildBlockPlanOption(program, blocks, frame, unit, widthM, depthM, "B"),
    buildBlockPlanOption(program, blocks, frame, unit, widthM, depthM, "C"),
  ];
  const preferredKey = program.layoutType === "communication" ? "B" : program.layoutType === "visitor_heavy" ? "C" : "A";
  const primary = options.find((option) => option.key === preferredKey) || options[0];

  return {
    ...primary,
    options,
    optionSummary: options.map((option) => `${option.name}: ${option.reason}`),
  };
}

function buildBlockPlanOption(program, blocks, frame, unit, widthM, depthM, key) {
  const m = (value) => value * unit;
  const visitorHeavy = program.visitorFrequency === "high" || program.layoutType === "visitor_heavy" || key === "C";
  const entry = getEntrySpace(frame, program.site.entryPosition);
  const plumbingPoint = getPlumbingPoint(frame, program.site.plumbingPosition);
  const windowLine = getWindowLine(frame, program.site.windowPosition);
  const columns = createColumnMarkers(frame, program.site.columnCount);
  const meetingBlocks = blocks.filter((block) => block.type === "meeting_room");
  const meetingCount = Math.max(meetingBlocks.length, program.meetingRooms.reduce((sum, room) => sum + room.count, 0), 1);
  const meetingLabel = meetingBlocks[0]?.name || `${program.meetingRooms[0]?.capacity || 6}인 회의실`;
  const spaces = [];
  const optionName = {
    A: "Option A 효율형",
    B: "Option B 소통형",
    C: "Option C 방문객/브랜딩형",
  }[key];
  const optionReason = {
    A: "좌석 수와 면적 효율을 우선하고 벽체를 최소화한 안입니다.",
    B: "탕비/라운지를 중심으로 직원 교류와 공용공간 접근성을 높인 안입니다.",
    C: "입구, 이미지월, 회의실 동선을 강조해 외부 손님 응대와 보안을 우선한 안입니다.",
  }[key];

  spaces.push({
    ...entry,
    id: `${key}-entry`,
    type: "entry",
    zone: "입구존",
    name: "입구존",
    open: true,
    reason: "입구 위치를 기준으로 방문객 동선과 직원 주동선을 분기하는 시작점입니다.",
  });

  if (key === "A") {
    const serviceW = Math.min(m(3.8), frame.width * 0.22);
    const meetingW = Math.min(m(4.8), frame.width * 0.27);
    const ceoW = program.needsCeoRoom ? Math.min(m(4.2), frame.width * 0.25) : 0;
    const serviceX = plumbingPoint.x > frame.x + frame.width / 2 ? frame.x + frame.width - serviceW : frame.x;
    const meetingX = serviceX === frame.x ? frame.x + serviceW : frame.x;
    const workX = frame.x + meetingW;
    const workW = Math.max(m(5), frame.width - meetingW - ceoW - serviceW * 0.35);

    spaces.push(createZone(`${key}-meeting`, "meeting_room", "회의존", meetingLabel, meetingX, frame.y, meetingW, frame.height * 0.42, "회의실을 입구에서 너무 멀지 않은 측면에 두어 외부/내부 접근을 모두 확보했습니다."));
    spaces.push(createZone(`${key}-work`, "team_zone", "업무존", `업무존 ${program.employeeCount}석`, workX, frame.y, workW, frame.height, "가장 큰 연속 면적을 업무공간에 배분해 좌석 효율과 향후 증원을 우선했습니다."));
    if (program.needsCeoRoom) {
      const ceoY = program.daylightPriority === "employee_first" ? frame.y + frame.height * 0.44 : frame.y;
      spaces.push(createZone(`${key}-ceo`, "ceo_room", "임원존", "대표실", frame.x + frame.width - ceoW, ceoY, ceoW, frame.height * 0.34, "대표실은 독립성을 확보하되 직원 채광 우선이면 창가 점유를 줄이는 위치로 조정했습니다."));
    }
    spaces.push(createZone(`${key}-service`, "pantry", "서비스존", "탕비/서비스", serviceX, frame.y + frame.height * 0.42, serviceW, frame.height * 0.38, "탕비실은 급배수 가능 위치와 가까운 외곽 서비스 라인에 배치했습니다."));
    if (program.needsStorage) spaces.push(createZone(`${key}-storage`, "storage", "수납존", "수납존", serviceX, frame.y + frame.height * 0.8, serviceW, frame.height * 0.2, "수납은 남는 공간이 아니라 업무존과 서비스존 모두 접근 가능한 벽면에 두었습니다."));
  }

  if (key === "B") {
    const loungeH = Math.min(m(3.2), frame.height * 0.26);
    const meetingW = Math.min(m(4.5), frame.width * 0.25);
    const ceoW = program.needsCeoRoom ? Math.min(m(4), frame.width * 0.23) : 0;
    const workW = Math.max(m(6), frame.width - meetingW - ceoW);
    const pantryW = Math.min(m(5.2), frame.width * 0.32);

    spaces.push(createZone(`${key}-meeting`, "meeting_room", "회의존", meetingLabel, frame.x, frame.y, meetingW, frame.height - loungeH, "회의존은 업무존과 라운지 모두 접근 가능한 좌측 밴드로 잡았습니다."));
    spaces.push(createZone(`${key}-work`, "team_zone", "업무존", `업무존 ${program.employeeCount}석`, frame.x + meetingW, frame.y, workW, frame.height - loungeH, "업무존은 창가와 넓은 면을 확보하고, 라운지와 가까운 열린 덩어리로 계획했습니다."));
    if (program.needsCeoRoom) spaces.push(createZone(`${key}-ceo`, "ceo_room", "임원존", "대표실", frame.x + frame.width - ceoW, frame.y, ceoW, frame.height * 0.38, "대표실은 독립실로 두되 소통형 흐름을 막지 않도록 외곽에 붙였습니다."));
    spaces.push(createZone(`${key}-lounge`, "open_lounge", "공용존", "오픈 라운지", frame.x, frame.y + frame.height - loungeH, Math.max(0, frame.width - pantryW), loungeH, "공용존은 직원들이 자연스럽게 지나가는 하단 동선과 연결했습니다."));
    spaces.push(createZone(`${key}-pantry`, "pantry", "서비스존", "오픈 탕비", frame.x + frame.width - pantryW, frame.y + frame.height - loungeH, pantryW, loungeH, "탕비는 급배수 방향을 기준으로 라운지와 붙여 소통형 중심 공간으로 만들었습니다."));
    if (program.needsStorage) spaces.push(createZone(`${key}-storage`, "storage", "수납존", "수납존", frame.x + frame.width - pantryW, frame.y + frame.height - loungeH - Math.min(m(1.2), 5), pantryW, Math.min(m(1.2), 5), "수납은 라운지와 업무존 사이 보조 벽면으로 계획했습니다."));
  }

  if (key === "C") {
    const frontH = Math.min(m(4.4), frame.height * 0.34);
    const visitorW = Math.min(m(4), frame.width * 0.24);
    const meetingW = Math.min(m(6.2), frame.width * 0.34);
    const ceoW = program.needsCeoRoom ? Math.min(m(4.4), frame.width * 0.25) : 0;
    const workY = frame.y;
    const workH = frame.height - frontH;

    spaces.push(createZone(`${key}-visitor`, "waiting_area", "방문객존", "방문객/이미지월", frame.x, frame.y + frame.height - frontH, visitorW, frontH, "입구에서 바로 보이는 이미지월과 대기 영역으로 외부 응대 인상을 강화했습니다."));
    spaces.push(createZone(`${key}-meeting`, "meeting_room", "회의존", meetingLabel, frame.x + visitorW, frame.y + frame.height - frontH, meetingW, frontH, "외부 손님이 업무공간 깊숙이 들어오지 않도록 회의실을 입구 전면에 배치했습니다."));
    const workW = Math.max(m(5), frame.width - ceoW);
    spaces.push(createZone(`${key}-work`, "team_zone", "업무존", `보호 업무존 ${program.employeeCount}석`, frame.x, workY, workW, workH, "업무공간은 방문객 전면 동선 뒤쪽으로 보호해 보안성과 집중도를 높였습니다."));
    if (program.needsCeoRoom) {
      spaces.push(createZone(`${key}-ceo`, "ceo_room", "임원존", "대표실", frame.x + frame.width - ceoW, frame.y, ceoW, workH * 0.48, "대표실은 회의존과 가깝고 업무존과 직접 시선이 맞지 않는 독립 위치로 잡았습니다."));
    }
    const pantryW = Math.min(m(4.2), frame.width * 0.24);
    spaces.push(createZone(`${key}-pantry`, "pantry", "서비스존", "탕비실", frame.x + frame.width - pantryW, frame.y + frame.height - frontH, pantryW, frontH, "탕비실은 급배수와 가까운 전면 서비스 밴드에 넣어 시공성을 확보했습니다."));
    if (program.needsStorage) spaces.push(createZone(`${key}-storage`, "storage", "수납존", "수납/서버", frame.x + frame.width - pantryW, frame.y + workH * 0.5, pantryW, workH * 0.18, "수납과 서버는 외부인 시야에서 벗어난 관리 가능한 위치에 두었습니다."));
  }

  const circulationSpaces = buildBlockPlanCirculation(frame, spaces, program, key, unit);
  const workSpaces = spaces.filter((space) => space.type === "team_zone");
  const capacityByModule = workSpaces.reduce((sum, space) => sum + calculateDeskModuleCapacity(space, program, unit), 0);
  const capacity = Math.min(program.employeeCount, Math.max(0, capacityByModule));

  return {
    key,
    name: optionName,
    reason: optionReason,
    frame,
    spaces: [...circulationSpaces, ...spaces],
    capacity: {
      ...getDeskLayoutCapacity({ seats: program.employeeCount, maxWidth: frame.width, maxHeight: frame.height, compact: program.densityType === "compact" }),
      visibleSeats: capacity,
    },
    mainAisle: circulationSpaces.find((space) => space.id.includes("staff")) || circulationSpaces[0],
    visitorPath: key === "C" || visitorHeavy,
    windowLine,
    plumbingPoint,
    columns,
    unit,
    widthM,
    depthM,
  };
}

function createZone(id, type, zone, name, x, y, width, height, reason) {
  return { id, type, zone, name, x, y, width: Math.max(0, width), height: Math.max(0, height), open: true, reason };
}

function buildBlockPlanCirculation(frame, spaces, program, key, unit) {
  const aisle = Math.max((program.density.mainAisle / 10) * unit, 4);
  const blocks = [];
  const frontY = frame.y + frame.height - aisle;
  if (key === "C" || program.visitorFrequency === "high") {
    blocks.push({
      id: `${key}-visitor-flow`,
      type: "corridor",
      zone: "방문객 동선",
      name: "방문객 동선",
      x: frame.x,
      y: frontY,
      width: frame.width,
      height: aisle,
      open: true,
      reason: "입구에서 방문객존과 회의존으로 바로 연결되는 동선을 확보했습니다.",
    });
  }
  blocks.push({
    id: `${key}-staff-flow`,
    type: "corridor",
    zone: "직원 주동선",
    name: "직원 주동선",
    x: frame.x + frame.width * 0.48 - aisle / 2,
    y: frame.y,
    width: aisle,
    height: frame.height,
    open: true,
    reason: "직원이 각 존으로 이동하는 주동선이며, 복도가 과도하게 길어지지 않도록 중앙축으로 잡았습니다.",
  });
  return blocks;
}

function createFitDiagram(result) {
  const plans = result.plan.options || [result.plan];
  return `
    <div class="fit-option-grid">
      ${plans.map((plan) => createBlockPlanOptionSvg(plan, result.program, result.score)).join("")}
    </div>
  `;
}

function createBlockPlanOptionSvg(plan, program, score) {
  const background = createPlanBackground(program.floorPlan);
  const grid = createScaleGrid(plan);
  const cadShell = createCadShell(plan);
  const rooms = plan.spaces.map((space) => createSmartSpace(space, program, plan)).join("");
  const deskModules = plan.spaces
    .filter((space) => space.type === "team_zone")
    .map((space) => createDeskModuleLayer(space, program, plan))
    .join("");
  const arrows = createBlockPlanArrows(plan);
  const columns = plan.columns.map((column, index) => `<circle class="diagram-column" cx="${column.x}" cy="${column.y}" r="1.35"></circle><text class="diagram-small" x="${column.x + 1.8}" y="${column.y + 0.7}">C${index + 1}</text>`).join("");
  return `
    <article class="fit-option-card">
      <div class="fit-option-head">
        <strong>${plan.name}</strong>
        <span>${plan.reason}</span>
      </div>
      <svg viewBox="0 0 100 72" role="img" aria-label="${plan.name} 블럭 플랜 초안">
        <defs>
          <marker id="arrowHead-${plan.key}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
          </marker>
        </defs>
        <rect x="2" y="2" width="96" height="68" fill="#ffffff" stroke="#111111" stroke-width="0.45"></rect>
        ${background}
        ${grid}
        ${cadShell}
        ${createWindowMarker(plan.windowLine)}
        <circle class="diagram-plumbing" cx="${plan.plumbingPoint.x}" cy="${plan.plumbingPoint.y}" r="1.25"></circle>
        <text class="diagram-small" x="${plan.plumbingPoint.x + 1.8}" y="${plan.plumbingPoint.y + 0.7}">급배수</text>
        ${rooms}
        ${deskModules}
        ${columns}
        ${arrows}
        <text class="diagram-dimension" x="5" y="68">CAD STYLE TEST FIT v1 · SCALE 1/50 · ${plan.widthM}m x ${plan.depthM}m · 예상 ${plan.capacity.visibleSeats}/${program.employeeCount}석</text>
      </svg>
      <ul class="fit-option-reasons">
        ${plan.spaces
          .filter((space) => space.type !== "corridor")
          .slice(0, 7)
          .map((space) => `<li><b>${escapeHtml(space.zone || space.name)}</b>${escapeHtml(space.reason)}</li>`)
          .join("")}
      </ul>
    </article>
  `;
}

function createCadShell(plan) {
  const f = plan.frame;
  const dims = `
    <line class="diagram-dim-line" x1="${f.x}" y1="${f.y - 2.2}" x2="${f.x + f.width}" y2="${f.y - 2.2}"></line>
    <line class="diagram-dim-line" x1="${f.x}" y1="${f.y + f.height + 2.2}" x2="${f.x + f.width}" y2="${f.y + f.height + 2.2}"></line>
    <line class="diagram-dim-line" x1="${f.x - 2.2}" y1="${f.y}" x2="${f.x - 2.2}" y2="${f.y + f.height}"></line>
    <line class="diagram-dim-tick" x1="${f.x}" y1="${f.y - 3.2}" x2="${f.x}" y2="${f.y - 1.2}"></line>
    <line class="diagram-dim-tick" x1="${f.x + f.width}" y1="${f.y - 3.2}" x2="${f.x + f.width}" y2="${f.y - 1.2}"></line>
    <line class="diagram-dim-tick" x1="${f.x - 3.2}" y1="${f.y}" x2="${f.x - 1.2}" y2="${f.y}"></line>
    <line class="diagram-dim-tick" x1="${f.x - 3.2}" y1="${f.y + f.height}" x2="${f.x - 1.2}" y2="${f.y + f.height}"></line>
    <text class="diagram-dimension" x="${f.x + f.width / 2 - 5}" y="${f.y - 3.2}">${Math.round(plan.widthM * 1000).toLocaleString()}mm</text>
    <text class="diagram-dimension" x="${f.x - 6.5}" y="${f.y + f.height / 2}">${Math.round(plan.depthM * 1000).toLocaleString()}mm</text>
  `;
  const openings = plan.spaces
    .filter((space) => ["entry", "meeting_room", "ceo_room", "pantry"].includes(space.type))
    .map((space) => createCadOpening(space))
    .join("");
  return `
    <rect class="diagram-cad-wall" x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}"></rect>
    ${dims}
    ${openings}
  `;
}

function createCadOpening(space) {
  if (space.type === "entry") {
    return `<path class="diagram-cad-door" d="M ${space.x} ${space.y + space.height} L ${space.x + space.width} ${space.y + space.height}"></path><text class="diagram-small" x="${space.x + space.width / 2 - 2}" y="${space.y + space.height + 2.2}">ENT</text>`;
  }
  const r = Math.min(5, Math.max(2.8, Math.min(space.width, space.height) * 0.2));
  const hingeX = space.x + space.width;
  const hingeY = space.y + space.height * 0.55;
  return `
    <line class="diagram-cad-door" x1="${hingeX}" y1="${hingeY}" x2="${hingeX - r}" y2="${hingeY}"></line>
    <path class="diagram-cad-swing" d="M ${hingeX} ${hingeY} A ${r} ${r} 0 0 1 ${hingeX - r} ${hingeY - r}"></path>
  `;
}

function createSmartSpace(space, program, plan) {
  const color = {
    entry: "#e8f0eb",
    waiting_area: "#d8ece8",
    meeting_room: "#e8f1f8",
    ceo_room: "#f4eadf",
    team_zone: "#f6f3df",
    pantry: "#f4e5b8",
    open_lounge: "#e4efd8",
    copy_zone: "#d7edf2",
    storage: "#d7edf2",
    server_room: "#ece8f4",
    phone_booth: "#ece8f4",
    corridor: "#dceee5",
  }[space.type] || "#ffffff";
  const area = plan?.unit ? getSpaceAreaSqm(space, plan.unit) : 0;
  const labelY = space.y + Math.min(space.height - 1, 3.7);
  const areaLabel = area ? `${Math.round(area)}m²` : "";
  return `
    <rect class="diagram-smart-room diagram-space-${space.type}" x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" fill="${color}" stroke="${space.type === "corridor" ? "#7cae96" : "#000000"}"></rect>
    <text class="diagram-label" x="${space.x + 1.1}" y="${labelY}">${escapeHtml(space.zone || space.name)}</text>
    ${space.type !== "corridor" ? `<text class="diagram-small" x="${space.x + 1.1}" y="${labelY + 3.1}">${escapeHtml(space.name)} · ${areaLabel}</text>` : ""}
  `;
}

function createBlockPlanArrows(plan) {
  const entry = plan.spaces.find((space) => space.type === "entry");
  const meeting = plan.spaces.find((space) => space.type === "meeting_room");
  const work = plan.spaces.find((space) => space.type === "team_zone");
  const arrows = [];
  if (entry && meeting) {
    arrows.push(`<path class="diagram-flow-arrow diagram-flow-visitor" marker-end="url(#arrowHead-${plan.key})" d="M ${centerX(entry)} ${centerY(entry)} L ${centerX(meeting)} ${centerY(meeting)}"></path>`);
  }
  if (entry && work) {
    arrows.push(`<path class="diagram-flow-arrow diagram-flow-staff" marker-end="url(#arrowHead-${plan.key})" d="M ${centerX(entry)} ${centerY(entry)} L ${centerX(work)} ${centerY(work)}"></path>`);
  }
  return arrows.join("");
}

function getSpaceAreaSqm(space, unit) {
  if (!unit) return 0;
  return (space.width / unit) * (space.height / unit);
}

function centerX(space) {
  return space.x + space.width / 2;
}

function centerY(space) {
  return space.y + space.height / 2;
}

function getDeskPlanningMetrics(program, unit) {
  const desk = getDeskMetric(program);
  const deskA = desk.widthM * unit;
  const deskB = desk.depthM * unit;
  const backAisle = ((program.deskBackAisleMm || 1000) / 1000) * unit;
  const sideAisle = ((program.deskSideAisleMm || 1000) / 1000) * unit;
  return {
    desk,
    deskA,
    deskB,
    backAisle,
    sideAisle,
    moduleW: deskA * 2,
    moduleH: deskB * 2 + backAisle * 2,
  };
}

function calculateDeskModuleCapacity(space, program, unit) {
  const metrics = getDeskPlanningMetrics(program, unit);
  const padding = Math.max(unit * 0.35, 1.2);
  const usableW = Math.max(0, space.width - padding * 2);
  const usableH = Math.max(0, space.height - padding * 2 - 4);
  const moduleStepX = metrics.moduleW + metrics.sideAisle;
  const moduleStepY = metrics.moduleH;
  const columns = Math.max(0, Math.floor((usableW + metrics.sideAisle) / moduleStepX));
  const rows = Math.max(0, Math.floor(usableH / moduleStepY));
  return columns * rows * 4;
}

function createDeskModuleLayer(space, program, plan) {
  const metrics = getDeskPlanningMetrics(program, plan.unit);
  const padding = Math.max(plan.unit * 0.35, 1.2);
  const usableW = Math.max(0, space.width - padding * 2);
  const usableH = Math.max(0, space.height - padding * 2 - 4);
  const moduleStepX = metrics.moduleW + metrics.sideAisle;
  const moduleStepY = metrics.moduleH;
  const columns = Math.max(0, Math.floor((usableW + metrics.sideAisle) / moduleStepX));
  const rows = Math.max(0, Math.floor(usableH / moduleStepY));
  const maxModules = Math.ceil((program.employeeCount || 0) / 4);
  const moduleCount = Math.min(columns * rows, maxModules);
  const startX = space.x + padding;
  const startY = space.y + padding + 4;
  const modules = Array.from({ length: moduleCount }, (_, index) => {
    const col = index % Math.max(columns, 1);
    const row = Math.floor(index / Math.max(columns, 1));
    const x = startX + col * moduleStepX;
    const y = startY + row * moduleStepY;
    return createDeskPlanningModule(x, y, metrics);
  }).join("");
  const info = `${metrics.desk.label} · 뒤 ${program.deskBackAisleMm || 1000} · 옆 ${program.deskSideAisleMm || 1000}`;
  return `
    ${modules}
    <text class="diagram-small diagram-desk-note" x="${space.x + 1.1}" y="${space.y + space.height - 1.1}">책상 a*b=${metrics.desk.label} / ${info}</text>
  `;
}

function createDeskPlanningModule(x, y, metrics) {
  const { deskA, deskB, moduleW, moduleH, backAisle } = metrics;
  const chairR = Math.max(0.42, deskB * 0.22);
  const topDeskY = y + backAisle;
  const bottomDeskY = topDeskY + deskB;
  const topChairY = y + backAisle * 0.5;
  const bottomChairY = bottomDeskY + deskB + backAisle * 0.5;
  return `
    <rect class="diagram-desk-module" x="${x}" y="${y}" width="${moduleW}" height="${moduleH}"></rect>
    <rect class="diagram-back-aisle" x="${x}" y="${y}" width="${moduleW}" height="${backAisle}"></rect>
    <rect class="diagram-back-aisle" x="${x}" y="${bottomDeskY + deskB}" width="${moduleW}" height="${backAisle}"></rect>
    <rect class="diagram-desk" x="${x}" y="${topDeskY}" width="${deskA}" height="${deskB}"></rect>
    <rect class="diagram-desk" x="${x + deskA}" y="${topDeskY}" width="${deskA}" height="${deskB}"></rect>
    <rect class="diagram-desk" x="${x}" y="${bottomDeskY}" width="${deskA}" height="${deskB}"></rect>
    <rect class="diagram-desk" x="${x + deskA}" y="${bottomDeskY}" width="${deskA}" height="${deskB}"></rect>
    <circle class="diagram-chair" cx="${x + deskA * 0.5}" cy="${topChairY}" r="${chairR}"></circle>
    <circle class="diagram-chair" cx="${x + deskA * 1.5}" cy="${topChairY}" r="${chairR}"></circle>
    <circle class="diagram-chair" cx="${x + deskA * 0.5}" cy="${bottomChairY}" r="${chairR}"></circle>
    <circle class="diagram-chair" cx="${x + deskA * 1.5}" cy="${bottomChairY}" r="${chairR}"></circle>
    <line class="diagram-aisle-guide" x1="${x - 0.35}" y1="${y}" x2="${x - 0.35}" y2="${topDeskY}"></line>
    <line class="diagram-aisle-guide" x1="${x - 0.35}" y1="${bottomDeskY + deskB}" x2="${x - 0.35}" y2="${y + moduleH}"></line>
    <line class="diagram-aisle-guide" x1="${x + moduleW}" y1="${topDeskY + deskB * 0.5}" x2="${x + moduleW + metrics.sideAisle}" y2="${topDeskY + deskB * 0.5}"></line>
  `;
}

async function downloadFitDiagram(format = "svg") {
  const svg = $("#fitDiagram svg");
  if (!svg) {
    showToast("저장할 블록 플랜이 없습니다.");
    return;
  }

  if (format === "svg") {
    downloadBlob(new Blob([serializeDiagramSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), "svg");
    return;
  }

  try {
    const image = await renderDiagramToCanvas(svg);
    if (format === "pdf") {
      downloadDiagramPdf(image.canvas);
      return;
    }

    const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
    const extension = format === "jpg" ? "jpg" : "png";
    image.canvas.toBlob(
      (blob) => {
        if (!blob) {
          showToast("이미지 생성에 실패했습니다.");
          return;
        }
        downloadBlob(blob, extension);
      },
      mimeType,
      0.92,
    );
  } catch {
    showToast("블록 플랜 파일 저장에 실패했습니다.");
  }
}

function serializeDiagramSvg(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .diagram-room{fill:#fff;stroke:#000;stroke-width:.5}
    .diagram-zone-fill{opacity:0}
    .diagram-wall{fill:none;stroke:#000;stroke-width:.7;stroke-linecap:square}
    .diagram-partition{fill:none;stroke:#000;stroke-width:.5}
    .diagram-door{fill:none;stroke:#000;stroke-width:.48}
    .diagram-swing{fill:none;stroke:#000;stroke-dasharray:.8 .55;stroke-width:.42}
    .diagram-window{stroke:#3b9fbd;stroke-width:.42}
    .diagram-plan-image{opacity:.42}
    .diagram-plan-grid{stroke:rgba(45,138,104,.18);stroke-width:.18}
    .diagram-scale-grid{stroke:rgba(0,0,0,.12);stroke-width:.13}
    .diagram-cad-wall{fill:none;stroke:#111;stroke-width:1.05}
    .diagram-cad-door{fill:none;stroke:#111;stroke-width:.34}
    .diagram-cad-swing{fill:none;stroke:#111;stroke-width:.28}
    .diagram-dim-line,.diagram-dim-tick{stroke:#7a7a7a;stroke-width:.18}
    .diagram-overlay{fill:rgba(255,255,255,.32)}
    .diagram-label{fill:#000;font-size:3.7px;font-weight:400;font-family:Batang,serif}
    .diagram-small{fill:#000;font-size:2.55px;font-family:Batang,serif}
    .diagram-desk{fill:transparent;stroke:#000;stroke-width:.32}
    .diagram-desk-module{fill:rgba(255,255,255,.08);stroke:#000;stroke-width:.22}
    .diagram-back-aisle{fill:rgba(255,255,255,.01);stroke:rgba(230,75,46,.35);stroke-width:.16}
    .diagram-aisle-guide{stroke:#e64b2e;stroke-width:.22}
    .diagram-desk-note{font-family:Arial,sans-serif}
    .diagram-furniture{fill:transparent;stroke:#000;stroke-width:.32}
    .diagram-furniture-line{stroke:#000;stroke-width:.24}
    .diagram-counter{fill:transparent;stroke:#000;stroke-width:.3}
    .diagram-chair{fill:transparent;stroke:#000;stroke-width:.28}
    .diagram-clearance{fill:transparent;stroke:transparent;stroke-width:0}
    .diagram-dimension{fill:#000;font-size:2.2px;font-weight:800;font-family:Arial,sans-serif}
    .diagram-aisle{fill:transparent;stroke:transparent;stroke-width:0}
    .diagram-arrow{stroke:transparent;stroke-width:0}
    .diagram-smart-room{stroke-width:.48}
    .diagram-space-corridor{opacity:.76}
    .diagram-aisle-fill{fill:rgba(148,204,178,.35);stroke:rgba(45,138,104,.36);stroke-dasharray:.8 .55;stroke-width:.22}
    .diagram-column{fill:#fff;stroke:#000;stroke-width:.42}
    .diagram-plumbing{fill:#a8d8e4;stroke:#000;stroke-width:.34}
  `;
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function renderDiagramToCanvas(svg) {
  return new Promise((resolve, reject) => {
    const svgText = serializeDiagramSvg(svg);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const scale = 3;
      const canvas = document.createElement("canvas");
      canvas.width = 1400;
      canvas.height = 1008;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ canvas, scale });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG image render failed"));
    };
    image.src = url;
  });
}

function downloadDiagramPdf(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const imageData = atob(dataUrl.split(",")[1]);
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 36;
  const drawWidth = pageWidth - margin * 2;
  const drawHeight = drawWidth * (canvas.height / canvas.width);
  const drawY = (pageHeight - drawHeight) / 2;
  const pdf = createPdfWithJpeg(imageData, canvas.width, canvas.height, pageWidth, pageHeight, margin, drawY, drawWidth, drawHeight);
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), "pdf");
}

function createPdfWithJpeg(imageData, imageWidth, imageHeight, pageWidth, pageHeight, x, y, width, height) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const add = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    length += bytes.length;
  };
  const addObject = (id, value) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${value}\nendobj\n`);
  };

  add("%PDF-1.3\n");
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = length;
  add(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageData.length} >>\nstream\n`,
  );
  add(Uint8Array.from(imageData, (character) => character.charCodeAt(0)));
  add("\nendstream\nendobj\n");
  const content = `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ`;
  addObject(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xrefStart = length;
  add(`xref\n0 6\n0000000000 65535 f \n`);
  for (let id = 1; id <= 5; id += 1) {
    add(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const output = new Uint8Array(length);
  let cursor = 0;
  parts.forEach((part) => {
    output.set(part, cursor);
    cursor += part.length;
  });
  return output;
}

function downloadBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `begins-fit-block-plan-${today()}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  $("#requestCount").textContent = PUBLIC_REQUEST_BASE_COUNT + state.requests.length;
  $("#metricNew").textContent = state.requests.filter((request) => request.status === "신청 접수").length;
  $("#metricPlan").textContent = state.requests.filter((request) => request.status === "도면 수급").length;
  $("#metricEstimate").textContent = state.requests.filter((request) =>
    ["견적 상담", "견적 제출", "계약 성공"].includes(request.status),
  ).length;
}

function renderAll() {
  renderMetrics();
  renderFitRequestOptions();
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
initFitCalculator();
renderAll();
