
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";


const pdfInput      = document.getElementById("pdfInput");
const uploadBox      = document.getElementById("uploadBox");
const uploadInner    = document.getElementById("uploadInner");
const fileMeta       = document.getElementById("fileMeta");
const fileNameEl     = document.getElementById("fileName");
const changeFileBtn  = document.getElementById("changeFileBtn");

const pageNav      = document.getElementById("pageNav");
const prevPageBtn  = document.getElementById("prevPage");
const nextPageBtn  = document.getElementById("nextPage");
const pageInput    = document.getElementById("pageInput");
const pageCountEl  = document.getElementById("pageCount");

const previewWrap  = document.getElementById("previewWrap");
const pdfCanvas    = document.getElementById("pdfCanvas");
const shotFlag     = document.getElementById("shotFlag");

const actionBtns   = document.querySelectorAll(".action-btn");
const resultBody   = document.getElementById("resultBody");
const resultTitle  = document.getElementById("resultTitle");
const copyResultBtn= document.getElementById("copyResult");

const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");


let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let renderTask = null;
let currentImageDataUrl = null;


const MAX_IMAGE_BYTES = 170 * 1024;

const ACTION_LABELS = {
  translate: "ترجمه",
  summarize: "خلاصه‌سازی",
  qa: "۱۰ سوال و پاسخ",
  mindmap: "نقشه ذهنی"
};


uploadBox.addEventListener("click", () => pdfInput.click());
changeFileBtn.addEventListener("click", (e) => { e.stopPropagation(); pdfInput.click(); });

["dragover", "dragleave", "drop"].forEach(evt => {
  uploadBox.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadBox.classList.toggle("drag", evt === "dragover");
  });
});
uploadBox.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadPdf(file);
});
pdfInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadPdf(file);
});

async function loadPdf(file) {
  if (file.type !== "application/pdf") {
    setStatus("این فایل PDF نیست", "error");
    return;
  }
  setStatus("در حال بارگذاری فایل…", "busy");
  uploadInner.hidden = true;
  fileMeta.hidden = false;
  fileNameEl.textContent = file.name;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;

  pageCountEl.textContent = totalPages;
  pageInput.max = totalPages;
  pageNav.hidden = false;
  previewWrap.hidden = false;

  currentPage = 1;
  pageInput.value = 1;
  await renderPage(1);
  setStatus("آماده", "");
}


prevPageBtn.addEventListener("click", () => goToPage(currentPage - 1));
nextPageBtn.addEventListener("click", () => goToPage(currentPage + 1));
pageInput.addEventListener("change", () => goToPage(parseInt(pageInput.value, 10) || 1));

function goToPage(n) {
  if (!pdfDoc) return;
  n = Math.min(Math.max(n, 1), totalPages);
  currentPage = n;
  pageInput.value = n;
  renderPage(n);
}

async function renderPage(num) {
  setStatus("در حال آماده‌سازی صفحه…", "busy");
  prevPageBtn.disabled = num <= 1;
  nextPageBtn.disabled = num >= totalPages;
  disableActions(true);
  currentImageDataUrl = null;

  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: 1.8 }); 
  const ctx = pdfCanvas.getContext("2d");
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  ctx.fillStyle = "#ffffff"; 
  ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);

  if (renderTask) { try { renderTask.cancel(); } catch (_) {} }
  renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;


  shotFlag.hidden = false;
  setStatus("در حال فشرده‌سازی تصویر صفحه…", "busy");
  try {
    currentImageDataUrl = await buildCompressedImage(page);
  } catch (err) {
    console.error(err);
  }
  shotFlag.hidden = true;

  disableActions(!currentImageDataUrl);
  setStatus("آماده", "");
}


async function buildCompressedImage(page) {
  let scale = 1.4;
  let quality = 0.82;

  for (let attempt = 0; attempt < 6; attempt++) {
    const viewport = page.getViewport({ scale });
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = viewport.width;
    tmpCanvas.height = viewport.height;
    const tctx = tmpCanvas.getContext("2d");
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
    await page.render({ canvasContext: tctx, viewport }).promise;

    const dataUrl = tmpCanvas.toDataURL("image/jpeg", quality);
    const approxBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

    if (approxBytes <= MAX_IMAGE_BYTES) {
      return dataUrl;
    }


    if (quality > 0.5) {
      quality -= 0.12;
    } else {
      scale *= 0.8;
      quality = 0.7;
    }
  }


  const viewport = page.getViewport({ scale: 0.7 });
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = viewport.width;
  tmpCanvas.height = viewport.height;
  const tctx = tmpCanvas.getContext("2d");
  tctx.fillStyle = "#ffffff";
  tctx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
  await page.render({ canvasContext: tctx, viewport }).promise;
  return tmpCanvas.toDataURL("image/jpeg", 0.5);
}

function disableActions(disabled) {
  actionBtns.forEach(btn => (btn.disabled = disabled));
}


actionBtns.forEach(btn => {
  btn.addEventListener("click", () => runAction(btn.dataset.action, btn));
});

async function runAction(action, btnEl) {
  if (!currentImageDataUrl) return;

  actionBtns.forEach(b => b.classList.remove("active"));
  btnEl.classList.add("active");
  resultTitle.textContent = `۳. نتیجه — ${ACTION_LABELS[action]}`;
  copyResultBtn.hidden = true;
  resultBody.innerHTML = `<div class="loading"><span class="spinner"></span> در حال دریافت پاسخ از هوش مصنوعی…</div>`;
  setStatus("در حال پردازش با هوش مصنوعی…", "busy");
  disableActions(true);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, image: currentImageDataUrl, page: currentPage })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `خطای سرور (کد ${res.status})`);
    }

    const data = await res.json();
    resultBody.textContent = data.result || "پاسخی دریافت نشد.";
    copyResultBtn.hidden = false;
    setStatus("آماده", "");
  } catch (err) {
    console.error(err);
    resultBody.innerHTML = `<div class="error-box">خطا در دریافت پاسخ: ${escapeHtml(err.message)}</div>`;
    setStatus("خطا", "error");
  } finally {
    disableActions(false);
  }
}

copyResultBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(resultBody.textContent).then(() => {
    copyResultBtn.textContent = "کپی شد!";
    setTimeout(() => (copyResultBtn.textContent = "کپی"), 1500);
  });
});


function setStatus(text, mode) {
  statusText.textContent = text;
  statusPill.classList.remove("busy", "error");
  if (mode) statusPill.classList.add(mode);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
