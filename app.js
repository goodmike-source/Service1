"use strict";

const STORAGE_KEY = "delivery-to-service-centers-v1";
const PRIORITY = { normal: 0, urgent: 1, critical: 2 };
const PRIORITY_NAME = { normal: "Обычный", urgent: "Срочно", critical: "Критично" };
const $ = (id) => document.getElementById(id);
const ui = {
  requestForm: $("requestForm"), ticket: $("ticket"), item: $("item"), centerSelect: $("centerSelect"),
  priority: $("priority"), due: $("due"), note: $("note"), centerPreview: $("centerPreview"),
  queueList: $("queueList"), centersList: $("centersList"), centerDialog: $("centerDialog"),
  centerForm: $("centerForm"), centerName: $("centerName"), centerAddress: $("centerAddress"),
  centerPhone: $("centerPhone"), centerMap: $("centerMap"), search: $("search"), printSheet: $("printSheet")
};

let state = { version: 1, centers: [], requests: [] };
let editingRequestId = null;
let editingCenterId = null;
let filter = "active";
let toastTimer;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function clean(value, limit) { return String(value ?? "").trim().slice(0, limit); }
function localISODate(date = new Date()) {
  const n = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${n(date.getMonth() + 1)}-${n(date.getDate())}`;
}
function prettyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}
function stamp() { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date()); }
function centerById(id) { return state.centers.find((center) => center.id === id); }
function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 4200);
}
function validYandexLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(www\.)?yandex\.(ru|com|by)$/.test(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}
function mapUrl(center) {
  if (center.map && validYandexLink(center.map)) return center.map;
  const url = new URL("https://yandex.ru/maps/");
  url.searchParams.set("text", center.address);
  return url.href;
}
function mapAnchor(center, text, className = "text-action") {
  const link = element("a", className, text);
  link.href = mapUrl(center);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function validateBackup(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.centers) || !Array.isArray(data.requests) || data.centers.length > 500 || data.requests.length > 10000) throw Error("Формат копии не подходит для этого сайта.");
  const centerIds = new Set();
  const centers = data.centers.map((raw) => {
    if (!raw || typeof raw.id !== "string" || !raw.id || raw.id.length > 100 || centerIds.has(raw.id)) throw Error("В копии некорректные данные сервисных центров.");
    const center = { id: clean(raw.id, 100), name: clean(raw.name, 120), address: clean(raw.address, 300), phone: clean(raw.phone, 60), map: clean(raw.map, 700) };
    if (!center.name || !center.address || !center.phone || (center.map && !validYandexLink(center.map))) throw Error("В копии некорректный адрес или телефон СЦ.");
    centerIds.add(center.id);
    return center;
  });
  const requestIds = new Set();
  const requests = data.requests.map((raw) => {
    if (!raw || typeof raw.id !== "string" || !raw.id || raw.id.length > 100 || requestIds.has(raw.id) || !centerIds.has(raw.centerId)) throw Error("В копии некорректные связи заявок с СЦ.");
    const request = {
      id: clean(raw.id, 100), centerId: raw.centerId, ticket: clean(raw.ticket, 80), item: clean(raw.item, 160),
      priority: raw.priority, due: clean(raw.due, 10), note: clean(raw.note, 800),
      status: raw.status, inTrip: raw.inTrip === true, createdAt: clean(raw.createdAt, 40)
    };
    if (!request.ticket || !request.item || !Object.hasOwn(PRIORITY, request.priority) || !["active", "done"].includes(request.status) || (request.due && !/^\d{4}-\d{2}-\d{2}$/.test(request.due))) throw Error("В копии некорректные поля заявки.");
    requestIds.add(request.id);
    return request;
  });
  return { version: 1, centers, requests };
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = validateBackup(JSON.parse(raw));
  } catch (error) {
    $("storageStatus").textContent = "Проверьте сохранение";
    toast(`Не удалось прочитать локальные данные: ${error.message}`);
  }
}
function commit(change, successMessage = "Сохранено") {
  const next = structuredClone(state);
  change(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
    $("storageStatus").textContent = "Сохраняется локально";
    render();
    if (successMessage) toast(successMessage);
    return true;
  } catch {
    $("storageStatus").textContent = "Ошибка сохранения";
    toast("Не удалось сохранить данные в браузере. Проверьте разрешения и свободное место.");
    return false;
  }
}
function sortedGroups(requests) {
  const groups = new Map();
  for (const request of requests) {
    const center = centerById(request.centerId);
    if (!center) continue;
    if (!groups.has(center.id)) groups.set(center.id, { center, requests: [], priority: 0, due: "9999-12-31", createdAt: request.createdAt });
    const group = groups.get(center.id);
    group.requests.push(request);
    group.priority = Math.max(group.priority, PRIORITY[request.priority]);
    if (request.due && request.due < group.due) group.due = request.due;
    if (request.createdAt < group.createdAt) group.createdAt = request.createdAt;
  }
  for (const group of groups.values()) group.requests.sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") || a.createdAt.localeCompare(b.createdAt));
  return [...groups.values()].sort((a, b) => b.priority - a.priority || a.due.localeCompare(b.due) || a.createdAt.localeCompare(b.createdAt) || a.center.name.localeCompare(b.center.name, "ru"));
}
function reportGroups() { return sortedGroups(state.requests.filter((r) => r.status === "active" && r.inTrip)); }
function priorityKind(group) { return ["normal", "urgent", "critical"][group.priority]; }
function renderStats() {
  const active = state.requests.filter((r) => r.status === "active");
  $("activeCount").textContent = active.length;
  $("tripCount").textContent = active.filter((r) => r.inTrip).length;
  $("stopCount").textContent = reportGroups().length;
  $("centersTabCount").textContent = state.centers.length;
  $("excelButton").disabled = $("printButton").disabled = !active.some((r) => r.inTrip);
}
function renderCenterSelect() {
  const selection = ui.centerSelect.value;
  ui.centerSelect.replaceChildren(new Option("Выберите адрес", ""));
  for (const center of [...state.centers].sort((a, b) => a.name.localeCompare(b.name, "ru"))) ui.centerSelect.add(new Option(center.name, center.id));
  if (state.centers.some((center) => center.id === selection)) ui.centerSelect.value = selection;
  renderPreview();
}
function renderPreview() {
  const center = centerById(ui.centerSelect.value);
  ui.centerPreview.hidden = !center;
  if (!center) return;
  $("previewName").textContent = center.name;
  $("previewAddress").textContent = center.address;
  $("previewPhone").textContent = center.phone;
  $("previewMapLink").href = mapUrl(center);
}
function emptyState(title, note, addButton = false) {
  const box = element("div", "empty-state");
  const body = element("div");
  body.append(element("div", "empty-illustration", "◎"), element("strong", "", title), element("p", "", note));
  if (addButton) {
    const button = element("button", "button button-outline", "+ Добавить сервисный центр");
    button.type = "button";
    button.addEventListener("click", () => openCenterDialog());
    body.append(button);
  }
  box.append(body);
  return box;
}
function textButton(text, callback, className = "text-action") {
  const button = element("button", className, text);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}
function renderQueue() {
  const query = ui.search.value.trim().toLocaleLowerCase("ru");
  const matching = state.requests.filter((request) => {
    if (request.status !== filter) return false;
    const center = centerById(request.centerId);
    return !query || [request.ticket, request.item, request.note, center?.name, center?.address, center?.phone].some((value) => String(value || "").toLocaleLowerCase("ru").includes(query));
  });
  const groups = sortedGroups(matching);
  ui.queueList.replaceChildren();
  if (!groups.length) {
    let title = "Пока нет заявок";
    let message = "Добавьте сервисный центр и первую доставку — она появится здесь.";
    if (filter === "done") { title = "Выполненных заявок нет"; message = "Завершённые доставки будут храниться здесь."; }
    if (query) { title = "Ничего не найдено"; message = "Попробуйте другое обращение, инструмент или адрес."; }
    ui.queueList.append(emptyState(title, message, !query && filter === "active" && !state.centers.length));
  }
  groups.forEach((group, index) => {
    const kind = filter === "done" ? "done" : priorityKind(group);
    const card = element("article", `stop-card priority-${kind}`);
    const top = element("div", "stop-main");
    const content = element("div", "stop-content");
    const first = element("div", "stop-first-line");
    first.append(element("span", "stop-name", group.center.name));
    first.append(element("span", `badge badge-${kind}`, filter === "done" ? "Выполнено" : PRIORITY_NAME[kind]));
    const meta = element("div", "stop-meta");
    const phone = element("a", "", group.center.phone);
    phone.href = `tel:${group.center.phone.replace(/[^+\d]/g, "")}`;
    meta.append(phone, element("span", "", `${group.requests.length} ${plural(group.requests.length, "инструмент", "инструмента", "инструментов")}`));
    if (group.due !== "9999-12-31") meta.append(element("span", "", `До ${prettyDate(group.due)}`));
    const actions = element("div", "stop-actions");
    actions.append(mapAnchor(group.center, "Открыть на карте ↗"));
    if (filter === "active") {
      const selected = group.requests.every((r) => r.inTrip);
      actions.append(textButton(selected ? "Убрать из листа водителя" : "Включить все в лист", () => commit((next) => {
        for (const r of next.requests) if (r.centerId === group.center.id && r.status === "active") r.inTrip = !selected;
      }, selected ? "Остановка убрана из листа" : "Остановка добавлена в лист")));
    }
    content.append(first, element("p", "stop-address", group.center.address), meta, actions);
    top.append(element("span", "stop-number", String(index + 1).padStart(2, "0")), content);
    card.append(top);
    const list = element("div", "ticket-list");
    group.requests.forEach((request) => {
      const row = element("div", "ticket-row");
      if (filter === "active") {
        const checkbox = element("input", "ticket-select");
        checkbox.type = "checkbox";
        checkbox.checked = request.inTrip;
        checkbox.setAttribute("aria-label", `В лист водителя: обращение ${request.ticket}, ${request.item}`);
        checkbox.addEventListener("change", () => commit((next) => { next.requests.find((r) => r.id === request.id).inTrip = checkbox.checked; }, checkbox.checked ? "Добавлено в лист водителя" : "Убрано из листа водителя"));
        row.append(checkbox);
      } else row.append(element("span"));
      const detail = element("div", "ticket-content");
      detail.append(element("div", "ticket-title", request.item), element("div", "ticket-sub", `Обращение № ${request.ticket}${request.due ? ` · до ${prettyDate(request.due)}` : ""}`));
      if (request.note) detail.append(element("div", "ticket-comment", request.note));
      row.append(detail);
      const rowActions = element("div", "ticket-actions");
      if (filter === "active") {
        rowActions.append(textButton("Изменить", () => editRequest(request.id)));
        rowActions.append(textButton("Готово", () => commit((next) => { const r = next.requests.find((x) => x.id === request.id); r.status = "done"; r.inTrip = false; }, "Доставка отмечена выполненной")));
      } else rowActions.append(textButton("Вернуть", () => commit((next) => { const r = next.requests.find((x) => x.id === request.id); r.status = "active"; r.inTrip = true; }, "Заявка снова активна")));
      rowActions.append(textButton("Удалить", () => deleteRequest(request), "remove"));
      row.append(rowActions);
      list.append(row);
    });
    card.append(list);
    ui.queueList.append(card);
  });
  $("queueCaption").textContent = filter === "active" ? "Отмеченные заявки попадут в печать и Excel." : "Выполненные заявки не входят в лист водителя.";
}
function plural(count, one, few, many) {
  if (count % 10 === 1 && count % 100 !== 11) return one;
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return few;
  return many;
}
function renderCenters() {
  ui.centersList.replaceChildren();
  if (!state.centers.length) { ui.centersList.append(emptyState("Справочник пока пуст", "Добавьте название, адрес и телефон первого СЦ.", true)); return; }
  for (const center of [...state.centers].sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
    const card = element("article", "center-card");
    const top = element("div", "center-card-top");
    top.append(element("h3", "", center.name), element("span", "center-icon", "↗"));
    card.append(top, element("p", "", center.address), element("p", "", center.phone));
    const actions = element("div", "center-card-actions");
    actions.append(mapAnchor(center, "На карте ↗"), textButton("Изменить", () => openCenterDialog(center.id)), textButton("Удалить", () => deleteCenter(center), "text-action danger"));
    card.append(actions);
    const count = state.requests.filter((r) => r.centerId === center.id).length;
    card.append(element("div", "center-usage", count ? `${count} ${plural(count, "заявка", "заявки", "заявок")} в истории` : "Нет заявок"));
    ui.centersList.append(card);
  }
}
function renderPrint() {
  ui.printSheet.replaceChildren();
  const groups = reportGroups();
  const head = element("div", "print-header");
  const title = element("div");
  title.append(element("h1", "", "Лист водителя"), element("p", "", `Доставка инструментов в СЦ · сформировано ${stamp()}`));
  head.append(title, element("aside", "", `${groups.length} ${plural(groups.length, "остановка", "остановки", "остановок")} · ${groups.reduce((sum, g) => sum + g.requests.length, 0)} ${plural(groups.reduce((sum, g) => sum + g.requests.length, 0), "заявка", "заявки", "заявок")}`));
  ui.printSheet.append(head);
  groups.forEach((group, index) => {
    const card = element("article", "print-stop");
    const bar = element("div", "print-stop-head");
    bar.append(element("span", "print-stop-number", String(index + 1)), element("span", "print-stop-name", group.center.name), element("span", "print-priority", PRIORITY_NAME[priorityKind(group)]));
    const body = element("div", "print-stop-body");
    body.append(element("div", "print-address", group.center.address), element("div", "print-phone", `Телефон СЦ: ${group.center.phone}`));
    if (group.due !== "9999-12-31") body.append(element("div", "print-meta", `Ближайший срок: ${prettyDate(group.due)}`));
    const table = element("table", "print-table");
    const header = element("tr");
    for (const column of ["Обращение", "Инструмент", "Комментарий / срок"]) header.append(element("th", "", column));
    const thead = element("thead"); thead.append(header); table.append(thead);
    const tbody = element("tbody");
    for (const request of group.requests) {
      const tr = element("tr");
      for (const value of [request.ticket, request.item, `${request.note || "—"}${request.due ? `\nДо ${prettyDate(request.due)}` : ""}`]) tr.append(element("td", "", value));
      tbody.append(tr);
    }
    table.append(tbody); body.append(table); card.append(bar, body); ui.printSheet.append(card);
  });
  if (groups.length) {
    const end = element("div", "print-end");
    end.append(element("span", "", "Инструменты переданы водителю"), element("span", "print-sign", "Подпись: "));
    ui.printSheet.append(end);
  }
}
function render() { renderStats(); renderCenterSelect(); renderQueue(); renderCenters(); renderPrint(); }

function resetRequest() {
  editingRequestId = null;
  ui.requestForm.reset();
  $("formHeading").textContent = "Новая доставка";
  $("submitRequest").firstChild.textContent = "Добавить в маршрут ";
  $("cancelEdit").hidden = true;
  renderPreview();
}
function editRequest(id) {
  const request = state.requests.find((r) => r.id === id);
  if (!request) return;
  editingRequestId = id;
  ui.ticket.value = request.ticket;
  ui.item.value = request.item;
  ui.centerSelect.value = request.centerId;
  ui.priority.value = request.priority;
  ui.due.value = request.due;
  ui.note.value = request.note;
  $("formHeading").textContent = "Изменить доставку";
  $("submitRequest").firstChild.textContent = "Сохранить изменения ";
  $("cancelEdit").hidden = false;
  renderPreview();
  ui.requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  ui.ticket.focus({ preventScroll: true });
}
function deleteRequest(request) {
  if (!confirm(`Удалить обращение № ${request.ticket} (${request.item})?`)) return;
  if (commit((next) => { next.requests = next.requests.filter((r) => r.id !== request.id); }, "Заявка удалена") && editingRequestId === request.id) resetRequest();
}
function openCenterDialog(id = null) {
  editingCenterId = id;
  ui.centerForm.reset();
  const center = id ? centerById(id) : null;
  if (center) {
    ui.centerName.value = center.name;
    ui.centerAddress.value = center.address;
    ui.centerPhone.value = center.phone;
    ui.centerMap.value = center.map;
  }
  $("centerDialogHeading").textContent = center ? "Изменить сервисный центр" : "Добавить сервисный центр";
  $("saveCenterButton").textContent = center ? "Сохранить изменения" : "Сохранить СЦ";
  ui.centerDialog.showModal();
  ui.centerName.focus();
}
function deleteCenter(center) {
  if (state.requests.some((r) => r.centerId === center.id)) { toast("У СЦ есть заявки. Удалите их из истории или измените адрес СЦ."); return; }
  if (!confirm(`Удалить адрес «${center.name}»?`)) return;
  if (commit((next) => { next.centers = next.centers.filter((c) => c.id !== center.id); }, "Адрес СЦ удалён") && ui.centerSelect.value === center.id) ui.centerSelect.value = "";
}
function switchTab(tab) {
  const route = tab === "route";
  $("routeView").hidden = !route;
  $("centersView").hidden = route;
  for (const [button, active] of [[$("routeTab"), route], [$("centersTab"), !route]]) {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}
function xmlText(value) {
  return String(value ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}
function excelColumn(index) { let result = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
function makeWorksheet(groups) {
  const rows = [
    ["ЛИСТ ВОДИТЕЛЯ · ДОСТАВКА В СЦ"],
    [`Сформировано ${stamp()} · остановок: ${groups.length} · заявок: ${groups.reduce((n, g) => n + g.requests.length, 0)}`],
    [],
    ["№ точки", "Приоритет", "Сервисный центр", "Адрес", "Телефон СЦ", "Обращение", "Инструмент", "Комментарий", "Доставить до"]
  ];
  groups.forEach((group, index) => group.requests.forEach((request) => rows.push([
    String(index + 1), PRIORITY_NAME[request.priority], group.center.name, group.center.address, group.center.phone,
    request.ticket, request.item, request.note, prettyDate(request.due)
  ])));
  const sheetRows = rows.map((values, index) => {
    const cells = values.map((value, col) => `<c r="${excelColumn(col)}${index + 1}" s="${index === 0 ? 1 : index === 3 ? 2 : 0}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`).join("");
    return `<row r="${index + 1}"${index === 0 ? ' ht="30" customHeight="1"' : index === 3 ? ' ht="28" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const widths = [11, 15, 25, 42, 19, 18, 30, 46, 17].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:I${rows.length}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths}</cols><sheetData>${sheetRows}</sheetData><mergeCells count="2"><mergeCell ref="A1:I1"/><mergeCell ref="A2:I2"/></mergeCells><autoFilter ref="A4:I${rows.length}"/><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
function workbookFiles(groups) {
  return {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Лист водителя" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF18375B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": makeWorksheet(groups)
  };
}
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function zipFiles(files) {
  const encoder = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  function u16(view, index, number) { view.setUint16(index, number, true); }
  function u32(view, index, number) { view.setUint32(index, number >>> 0, true); }
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const body = encoder.encode(content);
    const checksum = crc32(body);
    const file = new Uint8Array(30 + name.length + body.length);
    const view = new DataView(file.buffer);
    u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); u16(view, 8, 0);
    u32(view, 14, checksum); u32(view, 18, body.length); u32(view, 22, body.length); u16(view, 26, name.length);
    file.set(name, 30); file.set(body, 30 + name.length); local.push(file);
    const directory = new Uint8Array(46 + name.length);
    const dir = new DataView(directory.buffer);
    u32(dir, 0, 0x02014b50); u16(dir, 4, 20); u16(dir, 6, 20); u16(dir, 8, 0x0800);
    u32(dir, 16, checksum); u32(dir, 20, body.length); u32(dir, 24, body.length); u16(dir, 28, name.length); u32(dir, 42, offset);
    directory.set(name, 46); central.push(directory); offset += file.length;
  }
  const centralLength = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50); u16(e, 8, central.length); u16(e, 10, central.length); u32(e, 12, centralLength); u32(e, 16, offset);
  return new Blob([...local, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

ui.requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const ticket = clean(ui.ticket.value, 80), item = clean(ui.item.value, 160), centerId = ui.centerSelect.value;
  if (!ticket) { ui.ticket.focus(); toast("Укажите номер обращения."); return; }
  if (!item) { ui.item.focus(); toast("Укажите инструмент."); return; }
  if (!centerById(centerId)) { ui.centerSelect.focus(); toast("Выберите или добавьте сервисный центр."); return; }
  const values = { ticket, item, centerId, priority: ui.priority.value, due: ui.due.value, note: clean(ui.note.value, 800) };
  const edited = Boolean(editingRequestId);
  if (commit((next) => {
    if (editingRequestId) Object.assign(next.requests.find((r) => r.id === editingRequestId), values);
    else next.requests.push({ id: uid(), ...values, status: "active", inTrip: true, createdAt: new Date().toISOString() });
  }, edited ? "Изменения сохранены" : "Заявка добавлена в лист водителя")) resetRequest();
});
ui.centerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = { name: clean(ui.centerName.value, 120), address: clean(ui.centerAddress.value, 300), phone: clean(ui.centerPhone.value, 60), map: clean(ui.centerMap.value, 700) };
  for (const [key, input, label] of [["name", ui.centerName, "название"], ["address", ui.centerAddress, "адрес"], ["phone", ui.centerPhone, "телефон"]]) {
    if (!values[key]) { input.focus(); toast(`Укажите ${label} СЦ.`); return; }
  }
  if (values.map && !validYandexLink(values.map)) { ui.centerMap.focus(); toast("Вставьте ссылку на точку с сайта yandex.ru/maps или оставьте поле пустым."); return; }
  if (state.centers.some((c) => c.id !== editingCenterId && c.address.toLocaleLowerCase("ru") === values.address.toLocaleLowerCase("ru"))) { ui.centerAddress.focus(); toast("Этот адрес уже есть в справочнике. Измените существующий СЦ."); return; }
  const oldId = editingCenterId;
  const id = oldId || uid();
  if (commit((next) => {
    if (oldId) Object.assign(next.centers.find((c) => c.id === oldId), values);
    else next.centers.push({ id, ...values });
  }, oldId ? "Данные СЦ обновлены" : "Сервисный центр сохранён")) {
    ui.centerDialog.close();
    if (!oldId && !$("routeView").hidden) ui.centerSelect.value = id;
    renderPreview();
  }
});
$("checkCenterMap").addEventListener("click", () => {
  const address = clean(ui.centerAddress.value, 300), map = clean(ui.centerMap.value, 700);
  if (map && !validYandexLink(map)) { toast("Проверьте ссылку на Яндекс Карты."); ui.centerMap.focus(); return; }
  if (!map && !address) { toast("Сначала введите адрес или ссылку на точку."); ui.centerAddress.focus(); return; }
  window.open(mapUrl({ address, map }), "_blank", "noopener,noreferrer");
});
$("closeCenterDialog").addEventListener("click", () => ui.centerDialog.close());
$("newCenterInline").addEventListener("click", () => openCenterDialog());
$("addCenterButton").addEventListener("click", () => openCenterDialog());
$("cancelEdit").addEventListener("click", resetRequest);
ui.centerSelect.addEventListener("change", renderPreview);
ui.search.addEventListener("input", renderQueue);
$("routeTab").addEventListener("click", () => switchTab("route"));
$("centersTab").addEventListener("click", () => switchTab("centers"));
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((b) => { b.classList.toggle("is-selected", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  renderQueue();
}));
$("printButton").addEventListener("click", () => { renderPrint(); window.print(); });
window.addEventListener("beforeprint", renderPrint);
$("excelButton").addEventListener("click", () => {
  const groups = reportGroups();
  if (!groups.length) { toast("Отметьте хотя бы одну заявку для листа водителя."); return; }
  try { downloadBlob(zipFiles(workbookFiles(groups)), `Лист-водителя-${localISODate()}.xlsx`); toast("Файл Excel готов."); }
  catch { toast("Не удалось подготовить файл Excel."); }
});
$("backupButton").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json;charset=utf-8" }), `Доставка-СЦ-копия-${localISODate()}.json`);
  toast("Резервная копия сохранена.");
});
$("restoreButton").addEventListener("click", () => $("restoreFile").click());
$("restoreFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast("Файл слишком большой для резервной копии."); return; }
  try {
    const imported = validateBackup(JSON.parse(await file.text()));
    if (!confirm(`Загрузить копию? Текущие данные в этом браузере будут заменены. В копии: ${imported.centers.length} СЦ и ${imported.requests.length} заявок.`)) return;
    if (commit((next) => { next.centers = imported.centers; next.requests = imported.requests; }, "Копия загружена")) resetRequest();
  } catch (error) { toast(`Не удалось загрузить копию: ${error.message}`); }
});

$("todayLabel").textContent = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
load();
render();
