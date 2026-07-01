const ADMIN_KEY = "change-this-key";
const CUSTOMERS_SHEET = "Customers";
const ENTRIES_SHEET = "DebtEntries";
const CUSTOMER_HEADERS = ["id", "name", "note", "createdAt", "updatedAt"];
const ENTRY_HEADERS = ["id", "customerId", "date", "amount", "status", "note", "createdAt", "updatedAt", "paidAt"];

function doGet() {
  return json({
    ok: true,
    message: "Customer debt web app is ready. Use POST from index.html."
  });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    if (data.adminKey !== ADMIN_KEY) {
      return json({ ok: false, error: "unauthorized" });
    }

    setupSheets();

    if (data.action === "list") {
      return json({
        ok: true,
        customers: listCustomers(),
        entries: listEntries()
      });
    }

    if (data.action === "debug") {
      return json({
        ok: true,
        customersRows: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET).getLastRow(),
        entriesRows: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET).getLastRow(),
        customers: listCustomers(),
        entries: listEntries()
      });
    }

    if (data.action === "addCustomer") {
      return json({ ok: true, customer: addCustomer(data.customer || {}) });
    }

    if (data.action === "updateCustomer") {
      return json({ ok: true, customer: updateCustomer(data.customer || {}) });
    }

    if (data.action === "addDebt" || data.action === "addDebtSeparate") {
      return json({
        ok: true,
        entry: addDebt(data.customerId, data.date, data.amount, data.note || "")
      });
    }

    if (data.action === "markPaid") {
      markPaid(data.entryId);
      return json({ ok: true });
    }

    if (data.action === "markCustomerPaid") {
      markCustomerPaid(data.customerId);
      return json({ ok: true });
    }

    if (data.action === "deleteEntry") {
      deleteEntry(data.entryId);
      return json({ ok: true });
    }

    if (data.action === "deleteCustomerEntries") {
      const count = deleteCustomerEntries(data.customerId);
      return json({ ok: true, count });
    }

    return json({ ok: false, error: "unknown action" });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let customers = ss.getSheetByName(CUSTOMERS_SHEET);
  let entries = ss.getSheetByName(ENTRIES_SHEET);

  if (!customers) {
    customers = ss.insertSheet(CUSTOMERS_SHEET);
    customers.appendRow(CUSTOMER_HEADERS);
  }

  if (!entries) {
    entries = ss.insertSheet(ENTRIES_SHEET);
    entries.appendRow(ENTRY_HEADERS);
  }
}

function listCustomers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET);
  return recordsFromSheet(sheet, CUSTOMER_HEADERS)
    .filter(row => row.id && row.name)
    .map(row => ({
      id: row.id,
      name: row.name,
      note: row.note || "",
      createdAt: row.createdAt || "",
      updatedAt: row.updatedAt || ""
    }));
}

function listEntries() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  return recordsFromSheet(sheet, ENTRY_HEADERS)
    .filter(row => row.id && row.customerId)
    .map(row => ({
      id: row.id,
      customerId: row.customerId,
      date: normalizeDate(row.date),
      amount: Number(row.amount || 0),
      status: row.status || "open",
      note: row.note || "",
      createdAt: row.createdAt || "",
      updatedAt: row.updatedAt || "",
      paidAt: row.paidAt || ""
    }));
}

function addCustomer(customer) {
  const name = String(customer.name || "").trim();
  if (!name) throw new Error("customer name is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET);
  const now = nowText();
  const output = {
    id: Utilities.getUuid(),
    name,
    note: String(customer.note || "").trim(),
    createdAt: now,
    updatedAt: now
  };

  sheet.appendRow([output.id, output.name, output.note, output.createdAt, output.updatedAt]);
  return output;
}

function updateCustomer(customer) {
  const id = String(customer.id || "").trim();
  const name = String(customer.name || "").trim();
  if (!id || !name) throw new Error("customer id and name are required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET);
  const row = findRowById(sheet, id);
  if (!row) throw new Error("customer not found");

  const now = nowText();
  sheet.getRange(row, 2).setValue(name);
  sheet.getRange(row, 3).setValue(String(customer.note || "").trim());
  sheet.getRange(row, 5).setValue(now);

  return {
    id,
    name,
    note: String(customer.note || "").trim(),
    updatedAt: now
  };
}

function addDebt(customerId, date, amount, note) {
  const cleanCustomerId = String(customerId || "").trim();
  const cleanDate = normalizeDate(date || todayText());
  const cleanAmount = Number(amount || 0);

  if (!cleanCustomerId) throw new Error("customer id is required");
  if (!cleanDate) throw new Error("date is required");
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) throw new Error("amount must be greater than zero");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const now = nowText();
  const output = {
    id: Utilities.getUuid(),
    customerId: cleanCustomerId,
    date: cleanDate,
    amount: cleanAmount,
    status: "open",
    note: String(note || "").trim(),
    createdAt: now,
    updatedAt: now,
    paidAt: ""
  };

  sheet.appendRow([
    output.id,
    output.customerId,
    output.date,
    output.amount,
    output.status,
    output.note,
    output.createdAt,
    output.updatedAt,
    output.paidAt
  ]);

  return output;
}

function markPaid(entryId) {
  const id = String(entryId || "").trim();
  if (!id) throw new Error("entry id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const row = findRowById(sheet, id);
  if (!row) throw new Error("entry not found");

  const now = nowText();
  sheet.getRange(row, 5).setValue("paid");
  sheet.getRange(row, 8).setValue(now);
  sheet.getRange(row, 9).setValue(todayText());
}

function markCustomerPaid(customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const values = sheet.getDataRange().getValues();
  const now = nowText();
  const paidAt = todayText();
  let count = 0;

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const rowCustomerId = String(row[1] || "");
    const status = String(row[4] || "open");

    if (rowCustomerId === cleanCustomerId && status !== "paid") {
      const sheetRow = i + 1;
      sheet.getRange(sheetRow, 5).setValue("paid");
      sheet.getRange(sheetRow, 8).setValue(now);
      sheet.getRange(sheetRow, 9).setValue(paidAt);
      count += 1;
    }
  }

  return count;
}

function deleteEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) throw new Error("entry id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const row = findRowById(sheet, id);
  if (!row) throw new Error("entry not found");
  sheet.deleteRow(row);
}

function deleteCustomerEntries(customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const values = sheet.getDataRange().getValues();
  let count = 0;

  for (let i = values.length - 1; i >= 1; i -= 1) {
    if (String(values[i][1] || "") === cleanCustomerId) {
      sheet.deleteRow(i + 1);
      count += 1;
    }
  }

  return count;
}

function recordsFromSheet(sheet, defaultHeaders) {
  if (!sheet || sheet.getLastRow() < 1) return [];
  const values = sheet.getDataRange().getValues();
  const firstRow = values[0].map(header => String(header || "").trim());
  const hasHeaders = defaultHeaders.every(header => firstRow.includes(header));
  if (hasHeaders && values.length < 2) return [];
  const headers = hasHeaders ? firstRow : defaultHeaders;
  const dataRows = hasHeaders ? values.slice(1) : values;

  return dataRows.map(row => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index];
    });
    return record;
  });
}

function findRowById(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][0] || "") === id) return i + 1;
  }
  return 0;
}

function normalizeDate(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value).slice(0, 10);
}

function todayText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function nowText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
