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
  $("#fitSeatCount").value = request.seatCount || request.headcount || 20;
  $("#fitDeskSize").value = normalizeDeskSize(request.deskSize);
  $("#fitMeetingCapacity").value = request.meetingCapacity || ((request.needs || []).includes("회의실") ? 6 : 0);
  $("#fitMeetingCount").value = request.meetingCount || ((request.needs || []).includes("회의실") ? 1 : 0);
  $("#fitExecutiveRoom").value = (request.needs || []).includes("대표실") ? "standard" : "none";
  $("#fitPantry").value = (request.needs || []).includes("탕비실") ? "standard" : "simple";
  $("#fitStorage").value = (request.needs || []).includes("창고") || (request.needs || []).includes("서버실") ? "high" : "medium";

  const usageMap = {
    visitor: ["방문객", "외부인"],
    separate: ["동선 분리", "마주치지"],
    security: ["보안", "출입 통제"],
    open: ["오픈 오피스", "개방형"],
    call: ["통화", "온라인 회의"],
    growth: ["인원 증가", "향후"],
  };
  const usageText = (request.usageTypes || []).join(" ");
  $$("input[name='fitUsage']").forEach((input) => {
    input.checked = (usageMap[input.value] || []).some((keyword) => usageText.includes(keyword));
  });
  $$("input[name='designChecks']").forEach((input) => {
    input.checked = false;
  });
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
    .diagram-overlay{fill:rgba(255,255,255,.32)}
    .diagram-label{fill:#000;font-size:3.7px;font-weight:400;font-family:Batang,serif}
    .diagram-small{fill:#000;font-size:2.55px;font-family:Batang,serif}
    .diagram-desk{fill:#b88484;stroke:#000;stroke-width:.38}
    .diagram-furniture{fill:#b88484;stroke:#000;stroke-width:.38}
    .diagram-counter{fill:#a8d8e4;stroke:#000;stroke-width:.4}
    .diagram-chair{fill:#b88484;stroke:#000;stroke-width:.34}
    .diagram-clearance{fill:transparent;stroke:transparent;stroke-width:0}
    .diagram-dimension{fill:#000;font-size:2.2px;font-weight:800;font-family:Arial,sans-serif}
    .diagram-aisle{fill:transparent;stroke:transparent;stroke-width:0}
    .diagram-arrow{stroke:transparent;stroke-width:0}
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
