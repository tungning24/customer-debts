const ADMIN_KEY = "change-this-key";
const CUSTOMERS_SHEET = "Customers";
const ENTRIES_SHEET = "DebtEntries";
const PAYMENTS_SHEET = "Payments";
const CUSTOMER_HEADERS = ["id", "name", "note", "createdAt", "updatedAt", "sortOrder", "active"];
const ENTRY_HEADERS = ["id", "customerId", "date", "amount", "status", "note", "createdAt", "updatedAt", "paidAt"];
const PAYMENT_HEADERS = ["id", "customerId", "date", "amount", "note", "createdAt", "updatedAt", "status"];

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
      reconcileAllCustomerPaymentStatuses();
      return json({
        ok: true,
        customers: listCustomers(),
        entries: listEntries(),
        payments: listPayments()
      });
    }

    if (data.action === "debug") {
      reconcileAllCustomerPaymentStatuses();
      return json({
        ok: true,
        customersRows: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET).getLastRow(),
        entriesRows: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET).getLastRow(),
        paymentsRows: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAYMENTS_SHEET).getLastRow(),
        customers: listCustomers(),
        entries: listEntries(),
        payments: listPayments()
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
      return json({
        ok: true,
        payment: addPayment(data.customerId, todayText(), data.amount, data.note || "ปิดยอดรวม")
      });
    }

    if (data.action === "addPayment") {
      return json({
        ok: true,
        payment: addPayment(data.customerId, data.date, data.amount, data.note || "")
      });
    }

    if (data.action === "deleteEntry") {
      deleteEntry(data.entryId);
      return json({ ok: true });
    }

    if (data.action === "deletePayment") {
      deletePayment(data.paymentId);
      return json({ ok: true });
    }

    if (data.action === "deleteCustomerEntries") {
      const count = deleteCustomerEntries(data.customerId);
      return json({ ok: true, count });
    }

    if (data.action === "deleteCustomerPaidHistory") {
      const count = deleteCustomerPaidHistory(data.customerId);
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
  let payments = ss.getSheetByName(PAYMENTS_SHEET);

  if (!customers) {
    customers = ss.insertSheet(CUSTOMERS_SHEET);
    customers.appendRow(CUSTOMER_HEADERS);
  } else {
    customers.getRange(1, 1, 1, CUSTOMER_HEADERS.length).setValues([CUSTOMER_HEADERS]);
  }

  if (!entries) {
    entries = ss.insertSheet(ENTRIES_SHEET);
    entries.appendRow(ENTRY_HEADERS);
  }

  if (!payments) {
    payments = ss.insertSheet(PAYMENTS_SHEET);
    payments.appendRow(PAYMENT_HEADERS);
  } else {
    payments.getRange(1, 1, 1, PAYMENT_HEADERS.length).setValues([PAYMENT_HEADERS]);
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
      updatedAt: row.updatedAt || "",
      sortOrder: normalizeSortOrder(row.sortOrder),
      active: normalizeActive(row.active)
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
      paidAt: normalizeDate(row.paidAt)
    }));
}

function listPayments() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAYMENTS_SHEET);
  return recordsFromSheet(sheet, PAYMENT_HEADERS)
    .filter(row => row.id && row.customerId)
    .map(row => ({
      id: row.id,
      customerId: row.customerId,
      date: normalizeDate(row.date),
      amount: Number(row.amount || 0),
      note: row.note || "",
      createdAt: row.createdAt || "",
      updatedAt: row.updatedAt || "",
      status: row.status || "open"
    }));
}

function addCustomer(customer) {
  const name = String(customer.name || "").trim();
  if (!name) throw new Error("customer name is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CUSTOMERS_SHEET);
  const now = nowText();
  const sortOrder = normalizeSortOrder(customer.sortOrder) || nextCustomerSortOrder(sheet);
  const output = {
    id: Utilities.getUuid(),
    name,
    note: String(customer.note || "").trim(),
    createdAt: now,
    updatedAt: now,
    sortOrder,
    active: normalizeActive(customer.active)
  };

  sheet.appendRow([
    output.id,
    output.name,
    output.note,
    output.createdAt,
    output.updatedAt,
    output.sortOrder,
    output.active
  ]);
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

function nextCustomerSortOrder(sheet) {
  const customers = recordsFromSheet(sheet, CUSTOMER_HEADERS);
  return customers.reduce((max, customer) => {
    const sortOrder = normalizeSortOrder(customer.sortOrder);
    return sortOrder && sortOrder > max ? sortOrder : max;
  }, 0) + 1;
}

function normalizeSortOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function normalizeActive(value) {
  if (value === false) return false;
  return String(value).trim().toLowerCase() !== "false";
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

  reconcileCustomerPaymentStatus(cleanCustomerId);

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

function addPayment(customerId, date, amount, note) {
  const cleanCustomerId = String(customerId || "").trim();
  const cleanDate = normalizeDate(date || todayText());
  const cleanAmount = Number(amount || 0);

  if (!cleanCustomerId) throw new Error("customer id is required");
  if (!cleanDate) throw new Error("date is required");
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) throw new Error("amount must be greater than zero");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAYMENTS_SHEET);
  const now = nowText();
  const output = {
    id: Utilities.getUuid(),
    customerId: cleanCustomerId,
    date: cleanDate,
    amount: cleanAmount,
    note: String(note || "").trim(),
    createdAt: now,
    updatedAt: now,
    status: "open"
  };

  sheet.appendRow([
    output.id,
    output.customerId,
    output.date,
    output.amount,
    output.note,
    output.createdAt,
    output.updatedAt,
    output.status
  ]);

  reconcileCustomerPaymentStatus(cleanCustomerId);

  return output;
}

function reconcileCustomerPaymentStatus(customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entrySheet = ss.getSheetByName(ENTRIES_SHEET);
  const paymentSheet = ss.getSheetByName(PAYMENTS_SHEET);
  const entryValues = entrySheet.getDataRange().getValues();
  const paymentValues = paymentSheet.getDataRange().getValues();

  let openDebtTotal = 0;
  let openPaymentTotal = 0;

  for (let i = 1; i < entryValues.length; i += 1) {
    const row = entryValues[i];
    if (String(row[1] || "") === cleanCustomerId && String(row[4] || "open") !== "paid") {
      openDebtTotal += Number(row[3] || 0);
    }
  }

  for (let i = 1; i < paymentValues.length; i += 1) {
    const row = paymentValues[i];
    if (String(row[1] || "") === cleanCustomerId && String(row[7] || "open") !== "close") {
      openPaymentTotal += Number(row[3] || 0);
    }
  }

  if (openDebtTotal <= 0 || openPaymentTotal <= 0) return false;

  const now = nowText();
  const paidAt = todayText();
  let remainingToApply = Math.min(openDebtTotal, openPaymentTotal);

  for (let i = 1; i < entryValues.length; i += 1) {
    const row = entryValues[i];
    if (String(row[1] || "") !== cleanCustomerId || String(row[4] || "open") === "paid") {
      continue;
    }

    const sheetRow = i + 1;
    const debtAmount = Number(row[3] || 0);
    if (remainingToApply <= 0) break;

    if (debtAmount <= remainingToApply) {
      entrySheet.getRange(sheetRow, 5).setValue("paid");
      entrySheet.getRange(sheetRow, 8).setValue(now);
      entrySheet.getRange(sheetRow, 9).setValue(paidAt);
      remainingToApply -= debtAmount;
      continue;
    }

    const openDebtAmount = debtAmount - remainingToApply;
    entrySheet.getRange(sheetRow, 4).setValue(remainingToApply);
    entrySheet.getRange(sheetRow, 5).setValue("paid");
    entrySheet.getRange(sheetRow, 8).setValue(now);
    entrySheet.getRange(sheetRow, 9).setValue(paidAt);
    entrySheet.appendRow([
      Utilities.getUuid(),
      cleanCustomerId,
      normalizeDate(row[2] || paidAt),
      openDebtAmount,
      "open",
      row[5] || "",
      now,
      now,
      ""
    ]);
    remainingToApply = 0;
  }

  remainingToApply = Math.min(openDebtTotal, openPaymentTotal);

  for (let i = 1; i < paymentValues.length; i += 1) {
    const row = paymentValues[i];
    if (String(row[1] || "") !== cleanCustomerId || String(row[7] || "open") === "close") {
      continue;
    }

    const sheetRow = i + 1;
    const paymentAmount = Number(row[3] || 0);
    if (remainingToApply <= 0) break;

    if (paymentAmount <= remainingToApply) {
      paymentSheet.getRange(sheetRow, 7).setValue(now);
      paymentSheet.getRange(sheetRow, 8).setValue("close");
      remainingToApply -= paymentAmount;
      continue;
    }

    const creditAmount = paymentAmount - remainingToApply;
    paymentSheet.getRange(sheetRow, 4).setValue(remainingToApply);
    paymentSheet.getRange(sheetRow, 7).setValue(now);
    paymentSheet.getRange(sheetRow, 8).setValue("close");
    paymentSheet.appendRow([
      Utilities.getUuid(),
      cleanCustomerId,
      normalizeDate(row[2] || paidAt),
      creditAmount,
      row[4] || "",
      now,
      now,
      "open"
    ]);
    remainingToApply = 0;
  }

  return true;
}

function reconcileAllCustomerPaymentStatuses() {
  const customerIds = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entryValues = ss.getSheetByName(ENTRIES_SHEET).getDataRange().getValues();
  const paymentValues = ss.getSheetByName(PAYMENTS_SHEET).getDataRange().getValues();

  for (let i = 1; i < entryValues.length; i += 1) {
    const customerId = String(entryValues[i][1] || "").trim();
    if (customerId) customerIds[customerId] = true;
  }

  for (let i = 1; i < paymentValues.length; i += 1) {
    const customerId = String(paymentValues[i][1] || "").trim();
    if (customerId) customerIds[customerId] = true;
  }

  Object.keys(customerIds).forEach(reconcileCustomerPaymentStatus);
}

function deleteEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) throw new Error("entry id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  const row = findRowById(sheet, id);
  if (!row) throw new Error("entry not found");
  sheet.deleteRow(row);
}

function deletePayment(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("payment id is required");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAYMENTS_SHEET);
  const row = findRowById(sheet, id);
  if (!row) throw new Error("payment not found");
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

  const paymentSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAYMENTS_SHEET);
  const paymentValues = paymentSheet.getDataRange().getValues();
  for (let i = paymentValues.length - 1; i >= 1; i -= 1) {
    if (String(paymentValues[i][1] || "") === cleanCustomerId) {
      paymentSheet.deleteRow(i + 1);
    }
  }

  return count;
}

function deleteCustomerPaidHistory(customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entrySheet = ss.getSheetByName(ENTRIES_SHEET);
  const entryValues = entrySheet.getDataRange().getValues();
  let count = 0;

  for (let i = entryValues.length - 1; i >= 1; i -= 1) {
    if (String(entryValues[i][1] || "") === cleanCustomerId && String(entryValues[i][4] || "open") === "paid") {
      entrySheet.deleteRow(i + 1);
      count += 1;
    }
  }

  const paymentSheet = ss.getSheetByName(PAYMENTS_SHEET);
  const paymentValues = paymentSheet.getDataRange().getValues();
  for (let i = paymentValues.length - 1; i >= 1; i -= 1) {
    if (String(paymentValues[i][1] || "") === cleanCustomerId && String(paymentValues[i][7] || "open") === "close") {
      paymentSheet.deleteRow(i + 1);
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
