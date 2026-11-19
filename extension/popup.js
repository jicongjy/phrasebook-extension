// 내 문장 모음 - 팝업 화면
// 저장한 문장을 카드로 보여 주고, 누르면 복사해요. 직접 추가·수정·삭제(되돌리기)·검색도 해요.
// 문장은 chrome.storage.local에만 저장하고, 바깥 서버로는 보내지 않아요.

const KEY = "sentences";
const MAX = 30;
const MAX_LEN = 500;
const WARN_AT = 28;

// 하단에 보여 줄 브랜드 정보예요. 값을 바꾸면 화면에 바로 반영돼요.
// 웹사이트·문의 주소를 비워 두면(빈 글자) 그 링크는 숨겨요.
const BRAND = {
  name: "Phrasebook",
  siteLabel: "웹사이트",
  siteUrl: "", // 웹사이트가 없어서 비워 둠 (링크가 숨겨져요)
  contactLabel: "Email",
  contactUrl: "mailto:dangmujy@gmail.com", // 누르면 메일 앱이 열려요
};
const VERSION = chrome.runtime.getManifest().version; // manifest.json의 version을 그대로 보여 줘요

const ICON = {
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.7a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.1M12 17v.5"/>',
};
function svg(name, size, w) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, label, fn) {
  const b = el("button", cls, label);
  b.type = "button";
  if (fn) b.addEventListener("click", fn);
  return b;
}
const uid = () => String(Date.now()) + Math.random().toString(36).slice(2, 6);

// ---------- 상태 ----------
let list = [];
let loading = true;
let loadFailed = false;
let pending = null;   // 30개가 가득 찬 상태에서 저장하려던 새 문장 (지울 문장을 고르기를 기다림)
let pickId = null;
const ui = {
  editingId: null, adding: false, search: "", confirmClear: false,
  highlightId: null, copiedId: null, undo: null, help: false,
};
let toastTimer = null;
let hlTimer = null;

const app = document.getElementById("app");
const toastEl = el("div", "toast");
toastEl.setAttribute("role", "status");
toastEl.setAttribute("aria-live", "polite");
let listWrap = null;

// ---------- 저장소 ----------
async function readList() {
  const data = await chrome.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? data[KEY] : [];
}
async function writeList(next) {
  try {
    await chrome.storage.local.set({ [KEY]: next });
    list = next;
    return true;
  } catch (e) {
    showToast("warn", "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.", null, 5000);
    return false;
  }
}

// ---------- 알림(토스트) ----------
function hideToast() {
  clearTimeout(toastTimer);
  toastEl.className = "toast";
}
function showToast(kind, msg, action, ms) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = "";
  toastEl.className = "toast on " + kind;
  const ic = el("span");
  ic.style.cssText = "flex:none;display:flex";
  ic.innerHTML = svg(kind === "warn" ? "alert" : "check", 16);
  toastEl.append(ic, el("span", "m", msg));
  if (action) toastEl.append(btn("tb", action.label, () => { hideToast(); action.fn(); }));
  toastTimer = setTimeout(hideToast, ms || 3200);
  // 화면을 다시 그릴 때 알림이 처음부터 또 나타나 보이지 않도록, 나타나는 움직임은 한 번만 보여요
  setTimeout(() => { if (toastEl.classList.contains("on")) toastEl.classList.add("settled"); }, 260);
}
// 우클릭 저장 결과(background.js가 적어 둔 알림)를 보여 줘요.
function showStoredNotice(n) {
  if (!n || Date.now() - n.at > 120000) return;
  if (n.id) setHighlight(n.id);
  render();
  showToast(n.kind === "warn" ? "warn" : "ok", n.msg, null, n.kind === "warn" ? 5000 : 3500);
}
function setHighlight(id) {
  ui.highlightId = id;
  clearTimeout(hlTimer);
  hlTimer = setTimeout(() => {
    ui.highlightId = null;
    if (!ui.editingId && !ui.adding && !ui.confirmClear) render();
  }, 3500);
}

// ---------- 문장 검사 ----------
function validate(text, excludeId) {
  text = (text || "").trim();
  if (!text) return "문장을 입력해 주세요.";
  if (text.length > MAX_LEN) return `${MAX_LEN}자 이하로 써 주세요.`;
  if (list.some((it) => it.text === text && it.id !== excludeId)) return "같은 문장이 이미 있어요.";
  return null;
}

// ---------- 복사 ----------
function fallbackCopy(text) {
  const a = document.createElement("textarea");
  a.value = text;
  a.style.cssText = "position:fixed;opacity:0";
  document.body.append(a);
  a.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  a.remove();
  return ok;
}
async function doCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return fallbackCopy(text);
  }
}
async function copySentence(it) {
  const ok = await doCopy(it.text);
  if (ok) {
    ui.copiedId = it.id;
    render();
    showToast("ok", "복사했어요");
    setTimeout(() => {
      if (ui.copiedId === it.id) {
        ui.copiedId = null;
        if (!ui.editingId && !ui.adding && !ui.confirmClear) render();
      }
    }, 1400);
  } else {
    showToast("warn", "복사하지 못했어요. 문장을 드래그해서 직접 복사해 주세요.", null, 4500);
  }
}

// ---------- 입력 상자 (추가 · 수정 공용) ----------
function editor(initial, excludeId, saveLabel, onSave, onCancel) {
  const box = el("div", "editor");
  const ta = document.createElement("textarea");
  ta.value = initial;
  ta.setAttribute("aria-label", "문장");
  ta.placeholder = "저장할 문장을 입력해 주세요.";
  const err = el("div", "err");
  err.setAttribute("role", "alert");
  const meta = el("div", "meta");
  const count = el("span", "count");
  const upd = () => {
    const n = ta.value.trim().length;
    count.textContent = `${n} / ${MAX_LEN}`;
    count.className = "count" + (n > MAX_LEN ? " over" : "");
  };
  ta.addEventListener("input", () => { upd(); err.className = "err"; });
  const btns = el("div", "btns");
  btns.append(
    btn("pill", "취소", onCancel),
    btn("pill ink", saveLabel, () => {
      const m = validate(ta.value, excludeId);
      if (m) {
        err.innerHTML = svg("alert", 14);
        err.append(el("span", "", m));
        err.className = "err on";
        ta.focus();
        return;
      }
      onSave(ta.value.trim());
    })
  );
  meta.append(count, btns);
  box.append(ta, err, meta);
  upd();
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  return box;
}

// ---------- 화면 그리기 ----------
function emptyIllustration() {
  return '<svg width="132" height="96" viewBox="0 0 132 96" fill="none" aria-hidden="true">' +
    '<rect x="26" y="8" width="80" height="26" rx="9" stroke="#C8C8C8" stroke-width="1.5"/>' +
    '<rect x="18" y="26" width="96" height="30" rx="10" fill="var(--surface)" stroke="#8A8A8A" stroke-width="1.5"/>' +
    '<rect x="10" y="48" width="112" height="38" rx="12" fill="var(--surface)" stroke="var(--text)" stroke-width="1.75"/>' +
    '<path d="M26 63h58M26 73h36M98 60v18M95 60h6M95 78h6" stroke="var(--text)" stroke-width="2" stroke-linecap="round"/></svg>';
}

function render() {
  app.innerHTML = "";

  // 머리
  const head = el("div", "ph");
  const l = el("div", "l");
  const r = el("div", "r");
  const mark = el("span", "mark");
  mark.innerHTML = svg("bookmark", 15);
  const titleBox = el("div");
  titleBox.append(el("h1", "", "내 문장 모음"), el("span", "ver", "v" + VERSION));
  l.append(mark, titleBox);
  if (!loading && !loadFailed) {
    r.append(el("span", "cnt" + (list.length >= WARN_AT ? " hot" : ""), `${list.length} / ${MAX}`));
  }
  const hb = btn("act", "", () => { ui.help = !ui.help; ui.adding = false; ui.editingId = null; render(); });
  hb.innerHTML = svg("help", 16);
  hb.setAttribute("aria-label", "사용 방법");
  hb.title = "사용 방법";
  r.append(hb);
  if (!loading && !loadFailed && !ui.help) {
    const add = btn("add-btn", "", () => { ui.adding = true; ui.editingId = null; render(); });
    add.innerHTML = svg("plus", 13, 2.4);
    add.append("새 문장");
    add.setAttribute("aria-label", "새 문장 직접 추가");
    r.append(add);
  }
  head.append(l, r);
  app.append(head);

  if (ui.help) {
    app.append(helpView(), brandRow(), toastEl);
    return;
  }

  if (loading) {
    const sk = el("div", "plist");
    sk.setAttribute("aria-busy", "true");
    sk.setAttribute("aria-label", "불러오는 중이에요");
    sk.append(el("div", "skel"), el("div", "skel"), el("div", "skel"));
    app.append(sk, footer(true), toastEl);
    return;
  }

  if (loadFailed) {
    const eb = el("div", "errbox");
    eb.innerHTML = svg("alert", 28, 1.75);
    eb.append(el("strong", "", "저장한 문장을 불러오지 못했어요"));
    eb.append(el("span", "", "저장해 둔 문장은 지워지지 않았어요. 잠시 뒤 다시 시도해 주세요."));
    eb.append(btn("pill ink", "다시 시도", () => init(true)));
    app.append(eb, footer(true), toastEl);
    return;
  }

  // 30개가 가득 차서 새 문장을 저장하려면 지울 문장을 골라야 하는 경우
  if (pending && list.length >= MAX) {
    app.append(pickView(), brandRow(), toastEl);
    return;
  }

  // 안내 띠
  if (list.length >= MAX) app.append(banner("가득 찼어요. 새로 저장하면 지울 문장을 고를 수 있어요."));
  else if (list.length >= WARN_AT) app.append(banner(`곧 가득 차요. ${MAX}개까지 저장할 수 있어요.`));

  // 새 문장 입력
  if (ui.adding) {
    const box = editor("", null, "추가", async (text) => {
      if (list.length >= MAX) {
        // 가득 찼으면 자동으로 지우지 않고, 지울 문장을 고르게 해요.
        ui.adding = false;
        pending = text;
        render();
        return;
      }
      const item = { id: uid(), text, savedAt: Date.now() };
      if (await writeList([item, ...list])) {
        ui.adding = false;
        setHighlight(item.id);
        render();
        showToast("ok", "추가했어요", null, 3500);
      }
    }, () => { ui.adding = false; render(); });
    box.style.marginBottom = "8px";
    app.append(box);
  }

  // 검색
  if (list.length >= 6) {
    const sb = el("div", "search");
    sb.innerHTML = svg("search", 14);
    const inp = document.createElement("input");
    inp.type = "search";
    inp.placeholder = "문장 검색";
    inp.value = ui.search;
    inp.setAttribute("aria-label", "문장 검색");
    inp.addEventListener("input", () => { ui.search = inp.value; buildList(); });
    sb.append(inp);
    app.append(sb);
  }

  listWrap = el("div", "plist");
  app.append(listWrap);
  buildList();
  app.append(footer(false));

  if (ui.confirmClear) {
    const cf = el("div", "confirm");
    const dg = el("div", "dialog");
    dg.setAttribute("role", "alertdialog");
    dg.append(el("strong", "", `저장한 문장 ${list.length}개를 모두 지울까요?`), el("p", "", "지우면 되돌릴 수 없어요."));
    const bs = el("div", "btns");
    bs.append(
      btn("pill", "취소", () => { ui.confirmClear = false; render(); }),
      btn("pill ink", "모두 지우기", async () => {
        if (await writeList([])) {
          ui.confirmClear = false;
          render();
          showToast("ok", "모두 지웠어요");
        }
      })
    );
    dg.append(bs);
    cf.append(dg);
    app.append(cf);
  }
  app.append(toastEl);
}

function banner(text) {
  const b = el("div", "banner");
  b.innerHTML = svg("alert", 15);
  b.append(el("span", "", text));
  return b;
}

function footer(hideClear) {
  const f = el("div", "pfoot");
  const lk = el("span", "lk");
  lk.innerHTML = svg("lock", 13);
  lk.append(el("span", "", "이 크롬 안에만 저장되고, 최대 30개예요."));
  f.append(lk);
  if (!hideClear && list.length) f.append(btn("link", "모두 지우기", () => { ui.confirmClear = true; render(); }));
  const frag = document.createDocumentFragment();
  frag.append(f, brandRow());
  return frag;
}

// 하단: 브랜드 이름과 웹사이트·문의 채널
function brandRow() {
  const b = el("div", "brand");
  b.append(el("b", "", BRAND.name));
  const lks = el("div", "lks");
  [[BRAND.siteLabel, BRAND.siteUrl], [BRAND.contactLabel, BRAND.contactUrl]].forEach(([label, url]) => {
    if (!url) return;
    const a = el("a", "", label);
    a.href = url;
    if (!url.startsWith("mailto:")) {
      a.target = "_blank"; // 메일 링크는 새 탭 없이 바로 메일 앱을 열어요
      a.rel = "noopener noreferrer";
    }
    lks.append(a);
  });
  b.append(lks);
  return b;
}

// 30개가 찼을 때: 지울 문장을 사용자가 고르는 화면
function pickView() {
  const oldest = list[list.length - 1];
  if (!pickId || !list.some((x) => x.id === pickId)) pickId = oldest.id;
  const v = el("div", "pick");
  v.append(el("h2", "", "30개가 가득 찼어요"), el("p", "", "새 문장을 저장하려면 지울 문장을 하나 골라 주세요."));
  v.append(el("div", "lab", "저장하려는 새 문장"));
  const nc = el("div", "newcard");
  nc.append(el("span", "t", pending));
  v.append(nc);
  v.append(el("div", "lab", "지울 문장 (가장 오래된 문장부터)"));
  const pl = el("div", "picklist");
  pl.setAttribute("role", "radiogroup");
  list.slice().reverse().forEach((it, i) => {
    const lab = el("label", "opt" + (it.id === pickId ? " sel" : ""));
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "pick";
    r.checked = it.id === pickId;
    r.addEventListener("change", () => {
      pickId = it.id;
      [...pl.children].forEach((c) => c.classList.remove("sel"));
      lab.classList.add("sel");
    });
    const body = el("div");
    body.style.minWidth = "0";
    body.append(el("span", "t", it.text));
    if (i === 0) body.append(el("span", "tag", "가장 오래된 문장"));
    lab.append(r, body);
    pl.append(lab);
  });
  v.append(pl);
  const bs = el("div", "btns");
  bs.append(
    btn("pill", "저장 안 함", async () => {
      pending = null;
      pickId = null;
      chrome.storage.local.remove("pendingSave");
      render();
      showToast("ok", "저장하지 않았어요");
    }),
    btn("pill ink", "선택한 문장 지우고 저장", replaceAndSave)
  );
  v.append(bs);
  return v;
}

async function replaceAndSave() {
  const idx = list.findIndex((x) => x.id === pickId);
  const gone = list[idx];
  if (!gone) return;
  const item = { id: uid(), text: pending, savedAt: Date.now() };
  const next = [item, ...list.filter((x) => x.id !== pickId)];
  try {
    await chrome.storage.local.set({ [KEY]: next });
    await chrome.storage.local.remove("pendingSave");
  } catch (e) {
    showToast("warn", "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.", null, 5000);
    return;
  }
  list = next;
  pending = null;
  pickId = null;
  setHighlight(item.id);
  render();
  const g = gone.text.length > 14 ? gone.text.slice(0, 14) + "…" : gone.text;
  showToast("ok", `저장했어요. “${g}”을(를) 지웠어요.`, { label: "되돌리기", fn: () => undoReplace(item.id, gone, idx) }, 6000);
}

async function undoReplace(newId, gone, idx) {
  const cur = list.filter((x) => x.id !== newId);
  cur.splice(Math.min(idx, cur.length), 0, gone);
  if (await writeList(cur.slice(0, MAX))) {
    render();
    showToast("ok", "되돌렸어요");
  }
}

function helpView() {
  const h = el("div", "help");
  h.append(el("h2", "", "처음 오셨나요? 이렇게 써요"));
  const ol = document.createElement("ol");
  ["웹페이지에서 저장할 문장을 드래그해요.", "우클릭해서 '내 문장 모음에 저장'을 눌러요.", "아이콘을 눌러 이 창을 열고, 카드를 누르면 복사돼요."].forEach((s, i) => {
    const li = document.createElement("li");
    li.append(el("b", "", i + 1), el("span", "", s));
    ol.append(li);
  });
  h.append(ol);
  const s1 = el("div", "sec");
  s1.append(el("strong", "", "저장되면 이렇게 알려 드려요"), el("p", "", "아이콘에 '저장' 표시가 뜨고, 이 창이 저절로 열려요. 새 문장은 맨 위에서 강조돼요."));
  const s2 = el("div", "sec");
  s2.append(el("strong", "", "알아 두세요"));
  s2.append(el("p", "", "문장은 이 크롬 안에만 저장되고 바깥으로 보내지 않아요. 최대 30개, 한 문장은 500자까지예요."));
  s2.append(el("p", "", "우클릭이 안 되는 페이지에서는 '새 문장'으로 직접 추가할 수 있어요."));
  h.append(s1, s2);
  const go = el("div", "go");
  go.append(btn("pill ink", "알겠어요", () => { ui.help = false; render(); }));
  h.append(go);
  return h;
}

function buildList() {
  const q = ui.search.trim().toLowerCase();
  const items = q ? list.filter((it) => it.text.toLowerCase().includes(q)) : list;
  listWrap.innerHTML = "";

  if (!list.length) {
    if (ui.adding) return;
    const em = el("div", "empty");
    em.innerHTML = emptyIllustration();
    em.append(el("strong", "", "저장한 문장이 아직 없어요"));
    em.append(el("span", "sub", "웹페이지에서 문장을 드래그하고 우클릭해서 '내 문장 모음에 저장'을 눌러 보세요."));
    em.append(el("span", "sub", "우클릭이 안 되는 페이지에서는 '새 문장'으로 직접 추가할 수 있어요."));
    em.append(btn("pill ink", "새 문장 추가", () => { ui.adding = true; render(); }));
    listWrap.append(em);
    return;
  }
  if (!items.length) {
    const ne = el("div", "empty");
    ne.append(el("strong", "", "찾는 문장이 없어요"));
    ne.append(btn("pill", "검색어 지우기", () => { ui.search = ""; render(); }));
    listWrap.append(ne);
    return;
  }
  items.forEach((it) => listWrap.append(row(it)));
}

function row(it) {
  const wrap = el("div", "prow");

  if (ui.editingId === it.id) {
    wrap.append(editor(it.text, it.id, "저장", async (text) => {
      const next = list.map((x) => (x.id === it.id ? { id: x.id, text, savedAt: x.savedAt } : x));
      if (await writeList(next)) {
        ui.editingId = null;
        setHighlight(it.id);
        render();
        showToast("ok", "수정했어요");
      }
    }, () => { ui.editingId = null; render(); }));
    return wrap;
  }

  const card = el("button", "card" + (ui.highlightId === it.id ? " hl" : ""));
  card.type = "button";
  card.title = it.text;
  card.append(el("span", "t", it.text));
  if (ui.copiedId === it.id) card.append(el("span", "tag", "복사됨"));
  else if (ui.highlightId === it.id) card.append(el("span", "tag", "방금 저장"));
  card.addEventListener("click", () => copySentence(it));

  const acts = el("div", "acts");
  const ed = btn("act", "", () => { ui.editingId = it.id; ui.adding = false; render(); });
  ed.innerHTML = svg("pencil", 14);
  ed.setAttribute("aria-label", "이 문장 고치기");
  ed.title = "고치기";
  const dl = btn("act", "", async () => {
    const idx = list.findIndex((x) => x.id === it.id);
    if (await writeList(list.filter((x) => x.id !== it.id))) {
      ui.undo = { item: it, idx };
      render();
      showToast("ok", "문장을 지웠어요", { label: "되돌리기", fn: undoDelete }, 6000);
    }
  });
  dl.innerHTML = svg("x", 14);
  dl.setAttribute("aria-label", "이 문장 지우기");
  dl.title = "지우기";
  acts.append(ed, dl);
  wrap.append(card, acts);
  return wrap;
}

async function undoDelete() {
  if (!ui.undo) return;
  const { item, idx } = ui.undo;
  ui.undo = null;
  if (list.some((x) => x.text === item.text)) {
    showToast("warn", "같은 문장이 이미 있어서 되돌리지 않았어요.");
    return;
  }
  const next = list.slice();
  next.splice(Math.min(idx, next.length), 0, item);
  if (await writeList(next.slice(0, MAX))) {
    render();
    showToast("ok", "되돌렸어요");
  }
}

// ---------- 시작 ----------
async function init(retry) {
  loading = true;
  loadFailed = false;
  render();
  try {
    list = await readList();
  } catch (e) {
    loadFailed = true;
  }
  loading = false;

  try {
    chrome.action.setBadgeText({ text: "" }); // 아이콘 위 표시는 팝업을 열면 지워요
  } catch (e) {}

  let notice = null;
  try {
    const d = await chrome.storage.local.get(["seen", "notice", "pendingSave"]);
    notice = d.notice || null;
    pending = d.pendingSave && d.pendingSave.text ? d.pendingSave.text : null;
    if (!d.seen) {
      // 처음 사용 안내는 직접 열었을 때만 보여 줘요 (저장 직후 자동으로 열린 경우는 건너뜀)
      if (!notice && !pending && !retry) ui.help = true;
      chrome.storage.local.set({ seen: true });
    }
    if (notice) chrome.storage.local.remove("notice");

    // 기다리는 사이 자리가 생겼으면(다른 곳에서 지움 등) 그대로 저장해요.
    if (pending && !loadFailed && list.length < MAX) {
      const item = { id: uid(), text: pending, savedAt: Date.now() };
      const next = [item, ...list];
      await chrome.storage.local.set({ [KEY]: next });
      await chrome.storage.local.remove("pendingSave");
      list = next;
      pending = null;
      notice = { kind: "ok", msg: "저장했어요", id: item.id, at: Date.now() };
    }
  } catch (e) {}

  render();
  if (retry && !loadFailed) showToast("ok", "불러왔어요");
  if (notice && !loadFailed) showStoredNotice(notice);
}

// 저장 내용이 바뀌면(우클릭 저장 등) 목록을 다시 그려요.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || loading) return;
  if (changes[KEY]) {
    list = changes[KEY].newValue || [];
    if (!ui.editingId && !ui.adding && !ui.confirmClear) render();
  }
  if (changes.pendingSave) {
    const p = changes.pendingSave.newValue;
    pending = p && p.text ? p.text : null;
    render();
  }
  if (changes.notice && changes.notice.newValue) {
    showStoredNotice(changes.notice.newValue);
    chrome.storage.local.remove("notice");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.confirmClear) { ui.confirmClear = false; render(); }
});

init(false);
