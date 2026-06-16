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

  const perSeatArea = Math.max(desk.areaPerSeat + density.value, 1.65);
  const workArea = seats * perSeatArea;
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
  const deskColumns = Math.min(Math.max(Math.ceil(Math.sqrt(seatsToDraw * 1.6)), 4), 8);
  const deskWidth = 4.4;
  const deskHeight = 2.5;
  const deskGapX = 1.2;
  const deskGapY = 1.35;
  const deskStartX = 10;
  const deskStartY = 33;
  const deskElements = Array.from({ length: seatsToDraw }, (_, index) => {
    const column = index % deskColumns;
    const row = Math.floor(index / deskColumns);
    const x = deskStartX + column * (deskWidth + deskGapX);
    const y = deskStartY + row * (deskHeight + deskGapY);
    if (y > 61) return "";
    return `
      <rect class="diagram-clearance" x="${x - 0.7}" y="${y - 0.7}" width="${deskWidth + 1.4}" height="${deskHeight + 1.4}" rx="0.45" />
      <rect class="diagram-desk" x="${x}" y="${y}" width="${deskWidth}" height="${deskHeight}" rx="0.35" />
    `;
  }).join("");

  const meetingLabel = result.meetingCount
    ? `${result.meetingCapacity}인 x ${result.meetingCount}`
    : "필요 시";
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
  const meetingChairs = createMeetingChairs(33, 9.2, meetingFurniture);

  return `
    <svg viewBox="0 0 100 72" role="img" aria-label="내부 테스트핏 블록 플랜 초안">
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e5f68"></path>
        </marker>
      </defs>
      <rect x="2" y="2" width="96" height="68" rx="2.2" fill="#ffffff" stroke="#93aaa0" stroke-width="0.7"></rect>
      ${planBackground}

      <rect class="diagram-room" x="5" y="5" width="19" height="14" rx="1.2" fill="#d7e9e0"></rect>
      <text class="diagram-label" x="8" y="11">ENTRANCE</text>
      <text class="diagram-small" x="8" y="15">${hasVisitorFlow ? "방문객 동선" : "출입/대기"}</text>

      <rect class="diagram-room" x="26" y="5" width="31" height="14" rx="1.2" fill="#c8dedf"></rect>
      <text class="diagram-label" x="30" y="11">MEETING</text>
      <rect class="diagram-clearance" x="30" y="7.1" width="22" height="9.2" rx="0.8" />
      <rect class="diagram-furniture" x="36" y="9" width="${meetingFurniture.tableWidth}" height="${meetingFurniture.tableHeight}" rx="0.55" />
      ${meetingChairs}
      <text class="diagram-small" x="30" y="16.8">${meetingLabel} · ${meetingFurniture.label}</text>
      <text class="diagram-dimension" x="45" y="7">뒤 동선 1000+</text>

      <rect class="diagram-room" x="59" y="5" width="36" height="14" rx="1.2" fill="#e9ded0"></rect>
      <text class="diagram-label" x="63" y="11">EXECUTIVE</text>
      <rect class="diagram-furniture" x="64" y="12.5" width="9" height="3" rx="0.45" />
      <rect class="diagram-clearance" x="63" y="11.5" width="11" height="5.2" rx="0.5" />
      <text class="diagram-small" x="76" y="15">${result.executiveLabel} · ${executiveLabel}평</text>

      <rect class="diagram-room" x="5" y="22" width="61" height="43" rx="1.4" fill="#a8cfc0"></rect>
      <text class="diagram-label" x="9" y="28">OPEN WORK AREA</text>
      <text class="diagram-small" x="9" y="31">${growthText} · ${roundArea(result.workArea)}평</text>
      <rect class="diagram-aisle" x="8" y="54.5" width="55" height="5.6" rx="0.7"></rect>
      <text class="diagram-dimension" x="10" y="58">좌석 후면/보조 동선 1000 이상</text>
      ${deskElements}

      <rect class="diagram-aisle" x="68" y="22" width="7" height="43" rx="1"></rect>
      <text class="diagram-small" x="69.2" y="40" transform="rotate(90 69.2 40)">${mainAisleText}</text>

      <rect class="diagram-room" x="77" y="22" width="18" height="17" rx="1.2" fill="#f0d99f"></rect>
      <text class="diagram-label" x="80" y="29">PANTRY</text>
      <rect class="diagram-furniture" x="79" y="31.5" width="13.8" height="3.6" rx="0.4" />
      <rect class="diagram-furniture" x="80" y="27.7" width="4.4" height="2.6" rx="0.35" />
      <rect class="diagram-clearance" x="79" y="35.5" width="13.8" height="2.8" rx="0.35" />
      <text class="diagram-small" x="80" y="37.8">${pantryText}</text>

      <rect class="diagram-room" x="77" y="41" width="18" height="17" rx="1.2" fill="#d8d2e7"></rect>
      <text class="diagram-label" x="80" y="48">STORAGE</text>
      <rect class="diagram-furniture" x="79" y="51" width="13.8" height="2.4" rx="0.25" />
      <rect class="diagram-clearance" x="79" y="53.9" width="13.8" height="3.1" rx="0.35" />
      <text class="diagram-small" x="80" y="56">${storageText}</text>

      <line class="diagram-arrow" x1="14" y1="20" x2="14" y2="54"></line>
      <line class="diagram-arrow" x1="24" y1="12" x2="55" y2="12"></line>
      <line class="diagram-arrow" x1="66" y1="42" x2="76" y2="42"></line>

      <text class="diagram-small" x="5" y="69">면적 기준: 약 ${result.rangeLow}~${result.rangeHigh}평 / ${securityText}${designBadge}</text>
    </svg>
  `;
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
  if (!capacity || capacity <= 4) return { label: "W1400 회의테이블", tableWidth: 8, tableHeight: 3.2, chairs: 4 };
  if (capacity <= 6) return { label: "W1800 회의테이블", tableWidth: 10, tableHeight: 3.5, chairs: 6 };
  if (capacity <= 8) return { label: "W2400 회의테이블", tableWidth: 12, tableHeight: 3.7, chairs: 8 };
  if (capacity <= 10) return { label: "W3000 회의테이블", tableWidth: 14, tableHeight: 3.9, chairs: 10 };
  return { label: "W3600+ 회의테이블", tableWidth: 15, tableHeight: 4.1, chairs: 12 };
}

function createMeetingChairs(tableX, tableY, furniture) {
  const chairs = Math.min(furniture.chairs, 12);
  const topCount = Math.ceil(chairs / 2);
  const bottomCount = chairs - topCount;
  const chairWidth = 1.25;
  const chairHeight = 0.8;
  const topChairs = Array.from({ length: topCount }, (_, index) => {
    const x = tableX + 1 + index * ((furniture.tableWidth - 2) / Math.max(topCount - 1, 1));
    return `<rect class="diagram-chair" x="${x}" y="${tableY - 1.3}" width="${chairWidth}" height="${chairHeight}" rx="0.2" />`;
  }).join("");
  const bottomChairs = Array.from({ length: bottomCount }, (_, index) => {
    const x = tableX + 1 + index * ((furniture.tableWidth - 2) / Math.max(bottomCount - 1, 1));
    return `<rect class="diagram-chair" x="${x}" y="${tableY + furniture.tableHeight + 0.5}" width="${chairWidth}" height="${chairHeight}" rx="0.2" />`;
  }).join("");
  return topChairs + bottomChairs;
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
    .diagram-room{stroke:#fff;stroke-width:.9}
    .diagram-plan-image{opacity:.42}
    .diagram-plan-grid{stroke:rgba(45,138,104,.18);stroke-width:.18}
    .diagram-overlay{fill:rgba(255,255,255,.32)}
    .diagram-label{fill:#17201c;font-size:3.1px;font-weight:800;font-family:Arial,sans-serif}
    .diagram-small{fill:#48554f;font-size:2.4px;font-family:Arial,sans-serif}
    .diagram-desk{fill:rgba(255,255,255,.8);stroke:rgba(23,32,28,.22);stroke-width:.25}
    .diagram-furniture{fill:rgba(255,255,255,.72);stroke:rgba(23,32,28,.38);stroke-width:.28}
    .diagram-chair{fill:rgba(23,32,28,.16)}
    .diagram-clearance{fill:rgba(255,255,255,.26);stroke:rgba(30,95,104,.48);stroke-dasharray:.9 .75;stroke-width:.3}
    .diagram-dimension{fill:#1e5f68;font-size:2.2px;font-weight:800;font-family:Arial,sans-serif}
    .diagram-aisle{fill:rgba(255,255,255,.6);stroke:rgba(30,95,104,.3);stroke-dasharray:1.3 1.1;stroke-width:.35}
    .diagram-arrow{stroke:#1e5f68;stroke-width:.5;marker-end:url(#arrowHead)}
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
