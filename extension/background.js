// 내 문장 모음 - 우클릭 메뉴를 만들고, 고른 문장을 chrome.storage.local에 저장해요.
// 바깥 서버로는 아무것도 보내지 않아요.
//
// 저장 결과는 두 가지로 알려요.
//  1) 아이콘 위 표시(배지)
//  2) 팝업 자동 열기 + 팝업 안 알림 (알림 내용은 storage의 'notice'에 적어 두고 팝업이 읽어 가요)
// 크롬이 팝업 자동 열기를 막아도, 다음에 팝업을 열 때 알림이 보여요.

const MENU_ID = "save-sentence";
const KEY = "sentences";
const MAX = 30;
const MAX_LEN = 500;

// 설치·업데이트될 때 우클릭 메뉴를 한 번 만들어요.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "내 문장 모음에 저장",
      contexts: ["selection"], // 글자를 드래그해서 골랐을 때만 보여요
    });
  });
});

chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));

// 우클릭 메뉴를 눌렀을 때
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  await saveSentence(info.selectionText || "");
});

async function saveSentence(raw) {
  const text = raw.trim();

  if (!text) {
    return fail("빈 문장은 저장하지 않아요.");
  }
  if (text.length > MAX_LEN) {
    return fail(`문장이 너무 길어서 저장하지 못했어요. ${MAX_LEN}자 이하로 나눠서 저장해 주세요.`);
  }

  try {
    const data = await chrome.storage.local.get(KEY);
    const list = Array.isArray(data[KEY]) ? data[KEY] : [];

    const existed = list.find((item) => item.text === text);
    const rest = list.filter((item) => item.text !== text);

    // 30개가 가득 찬 상태에서 새 문장이면, 자동으로 지우지 않고 사용자가 지울 문장을 고르게 해요.
    // 새 문장은 'pendingSave'에 잠시 보관하고, 팝업의 선택 화면에서 결정해요.
    if (!existed && rest.length >= MAX) {
      await chrome.storage.local.set({ pendingSave: { text, at: Date.now() } });
      showBadge("선택", 0); // 팝업을 열 때까지 남아 있어요
      openPopupSafely();
      return;
    }

    const item = { id: existed ? existed.id : newId(), text, savedAt: Date.now() };
    const next = [item, ...rest];

    const notice = existed
      ? { kind: "ok", msg: "이미 저장한 문장이에요. 맨 위로 올렸어요." }
      : { kind: "ok", msg: "저장했어요" };
    notice.id = item.id;
    notice.at = Date.now();

    // 목록과 알림을 한 번에 기록해요.
    await chrome.storage.local.set({ [KEY]: next, notice });
  } catch (e) {
    return fail("저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }

  showBadge("저장", 4000);
  openPopupSafely();
}

// 저장하지 못한 경우: 이유를 알림으로 남기고 아이콘에 '!'를 보여요.
async function fail(msg) {
  try {
    await chrome.storage.local.set({ notice: { kind: "warn", msg, at: Date.now() } });
  } catch (e) {}
  showBadge("!", 0); // 팝업을 열 때까지 남아 있어요
  openPopupSafely();
}

let badgeTimer = null;
function showBadge(text, ms) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#161616" });
  try { chrome.action.setBadgeTextColor({ color: "#FFFFFF" }); } catch (e) {}
  clearTimeout(badgeTimer);
  if (ms) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: "" }), ms);
}

// 팝업 자동 열기는 크롬 버전이나 창 상태에 따라 막힐 수 있어요. 막혀도 괜찮아요.
async function openPopupSafely() {
  try {
    await chrome.action.openPopup();
  } catch (e) {
    // 열지 못하면 아이콘 표시만 보여요.
  }
}

function newId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}
