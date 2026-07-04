const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const ADMIN_TABLES = {
  customers: {
    order: "sort_order.asc.nullslast,name.asc",
    columns: {
      id: "readonly",
      name: "text",
      note: "text",
      sort_order: "integer",
      active: "boolean",
      created_at: "readonly",
      updated_at: "readonly"
    }
  },
  debt_entries: {
    order: "date.desc,created_at.desc",
    columns: {
      id: "readonly",
      customer_id: "uuid",
      date: "date",
      amount: "number",
      status: "debt_status",
      note: "text",
      paid_at: "nullable_date",
      created_at: "readonly",
      updated_at: "readonly"
    }
  },
  payments: {
    order: "date.desc,created_at.desc",
    columns: {
      id: "readonly",
      customer_id: "uuid",
      date: "date",
      amount: "number",
      note: "text",
      status: "payment_status",
      created_at: "readonly",
      updated_at: "readonly"
    }
  }
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet() {
  return json({
    ok: true,
    message: "Customer debts API is ready. Use POST from index.html."
  });
}

export async function onRequestPost({ request, env }) {
  try {
    assertEnv(env);
    const data = await request.json();

    if (data.adminKey !== env.ADMIN_KEY) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    switch (data.action) {
      case "list":
        await reconcileAllCustomerPaymentStatuses(env);
        return json({ ok: true, ...(await listData(env)) });
      case "debug":
        await reconcileAllCustomerPaymentStatuses(env);
        return json({ ok: true, ...(await listData(env)) });
      case "addCustomer":
        return json({ ok: true, customer: await addCustomer(env, data.customer || {}) });
      case "updateCustomer":
        return json({ ok: true, customer: await updateCustomer(env, data.customer || {}) });
      case "addDebt":
      case "addDebtSeparate":
        return json({ ok: true, entry: await addDebt(env, data.customerId, data.date, data.amount, data.note || "") });
      case "markPaid":
        await markPaid(env, data.entryId);
        return json({ ok: true });
      case "markCustomerPaid":
        return json({ ok: true, payment: await addPayment(env, data.customerId, todayText(), data.amount, data.note || "ปิดยอดรวม") });
      case "addPayment":
        return json({ ok: true, payment: await addPayment(env, data.customerId, data.date, data.amount, data.note || "") });
      case "deleteEntry":
        await deleteById(env, "debt_entries", data.entryId, "entry");
        return json({ ok: true });
      case "deletePayment":
        await deleteById(env, "payments", data.paymentId, "payment");
        return json({ ok: true });
      case "deleteCustomerEntries":
        return json({ ok: true, count: await deleteCustomerEntries(env, data.customerId) });
      case "deleteCustomerPaidHistory":
        return json({ ok: true, count: await deleteCustomerPaidHistory(env, data.customerId) });
      case "adminList":
        return json({ ok: true, ...(await adminList(env, data.table)) });
      case "adminUpdate":
        return json({ ok: true, row: await adminUpdate(env, data.table, data.id, data.values || {}) });
      case "adminDelete":
        return json({ ok: true, row: await adminDelete(env, data.table, data.id) });
      case "adminExport":
        return json({ ok: true, tables: await adminExport(env) });
      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) }, 500);
  }
}

function assertEnv(env) {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_KEY"]) {
    if (!env[name]) throw new Error(`missing ${name}`);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json;charset=utf-8"
    }
  });
}

async function supabase(env, table, options = {}) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(result?.message || result?.error || `Supabase ${response.status}`);
  }
  return result;
}

async function listData(env) {
  const [customers, entries, payments] = await Promise.all([
    supabase(env, "customers", { query: { select: "*", order: "sort_order.asc.nullslast,name.asc" } }),
    supabase(env, "debt_entries", { query: { select: "*", order: "date.asc,created_at.asc" } }),
    supabase(env, "payments", { query: { select: "*", order: "date.asc,created_at.asc" } })
  ]);

  return {
    customers: customers.map(mapCustomer),
    entries: entries.map(mapEntry),
    payments: payments.map(mapPayment)
  };
}

async function addCustomer(env, customer) {
  const name = String(customer.name || "").trim();
  if (!name) throw new Error("customer name is required");

  const inserted = await supabase(env, "customers", {
    method: "POST",
    body: {
      name,
      note: String(customer.note || "").trim(),
      sort_order: normalizeSortOrder(customer.sortOrder),
      active: normalizeActive(customer.active)
    }
  });
  return mapCustomer(inserted[0]);
}

async function updateCustomer(env, customer) {
  const id = String(customer.id || "").trim();
  const name = String(customer.name || "").trim();
  if (!id || !name) throw new Error("customer id and name are required");

  const updated = await supabase(env, "customers", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: {
      name,
      note: String(customer.note || "").trim(),
      updated_at: new Date().toISOString()
    }
  });
  if (!updated.length) throw new Error("customer not found");
  return mapCustomer(updated[0]);
}

async function addDebt(env, customerId, date, amount, note) {
  const cleanCustomerId = String(customerId || "").trim();
  const cleanDate = normalizeDate(date || todayText());
  const cleanAmount = Number(amount || 0);

  if (!cleanCustomerId) throw new Error("customer id is required");
  if (!cleanDate) throw new Error("date is required");
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) throw new Error("amount must be greater than zero");

  const inserted = await supabase(env, "debt_entries", {
    method: "POST",
    body: {
      customer_id: cleanCustomerId,
      date: cleanDate,
      amount: cleanAmount,
      status: "open",
      note: String(note || "").trim()
    }
  });
  await reconcileCustomerPaymentStatus(env, cleanCustomerId);
  return mapEntry(inserted[0]);
}

async function addPayment(env, customerId, date, amount, note) {
  const cleanCustomerId = String(customerId || "").trim();
  const cleanDate = normalizeDate(date || todayText());
  const cleanAmount = Number(amount || 0);

  if (!cleanCustomerId) throw new Error("customer id is required");
  if (!cleanDate) throw new Error("date is required");
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) throw new Error("amount must be greater than zero");

  const inserted = await supabase(env, "payments", {
    method: "POST",
    body: {
      customer_id: cleanCustomerId,
      date: cleanDate,
      amount: cleanAmount,
      note: String(note || "").trim(),
      status: "open"
    }
  });
  await reconcileCustomerPaymentStatus(env, cleanCustomerId);
  return mapPayment(inserted[0]);
}

async function markPaid(env, entryId) {
  const id = String(entryId || "").trim();
  if (!id) throw new Error("entry id is required");

  const updated = await supabase(env, "debt_entries", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: {
      status: "paid",
      updated_at: new Date().toISOString(),
      paid_at: todayText()
    }
  });
  if (!updated.length) throw new Error("entry not found");
}

async function deleteById(env, table, idValue, label) {
  const id = String(idValue || "").trim();
  if (!id) throw new Error(`${label} id is required`);

  const deleted = await supabase(env, table, {
    method: "DELETE",
    query: { id: `eq.${id}` }
  });
  if (!deleted.length) throw new Error(`${label} not found`);
}

async function deleteCustomerEntries(env, customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const deletedEntries = await supabase(env, "debt_entries", {
    method: "DELETE",
    query: { customer_id: `eq.${cleanCustomerId}` }
  });
  await supabase(env, "payments", {
    method: "DELETE",
    query: { customer_id: `eq.${cleanCustomerId}` }
  });
  return deletedEntries.length;
}

async function deleteCustomerPaidHistory(env, customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const deletedEntries = await supabase(env, "debt_entries", {
    method: "DELETE",
    query: {
      customer_id: `eq.${cleanCustomerId}`,
      status: "eq.paid"
    }
  });
  const deletedPayments = await supabase(env, "payments", {
    method: "DELETE",
    query: {
      customer_id: `eq.${cleanCustomerId}`,
      status: "eq.close"
    }
  });
  return deletedEntries.length + deletedPayments.length;
}

async function adminList(env, table) {
  const config = getAdminTable(table);
  const rows = await supabase(env, table, {
    query: {
      select: "*",
      order: config.order,
      limit: "500"
    }
  });

  return {
    table,
    columns: Object.entries(config.columns).map(([name, type]) => ({ name, type })),
    rows
  };
}

async function adminUpdate(env, table, idValue, values) {
  const config = getAdminTable(table);
  const id = String(idValue || "").trim();
  if (!id) throw new Error("row id is required");

  const body = {};
  for (const [column, value] of Object.entries(values)) {
    const type = config.columns[column];
    if (!type || type === "readonly") continue;
    body[column] = normalizeAdminValue(value, type, column);
  }

  if (!Object.keys(body).length) throw new Error("no editable values");
  if (config.columns.updated_at) body.updated_at = new Date().toISOString();

  const updated = await supabase(env, table, {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body
  });
  if (!updated.length) throw new Error("row not found");
  return updated[0];
}

async function adminDelete(env, table, idValue) {
  getAdminTable(table);
  const id = String(idValue || "").trim();
  if (!id) throw new Error("row id is required");

  const deleted = await supabase(env, table, {
    method: "DELETE",
    query: { id: `eq.${id}` }
  });
  if (!deleted.length) throw new Error("row not found");
  return deleted[0];
}

async function adminExport(env) {
  const output = {};
  for (const table of ["customers", "debt_entries", "payments"]) {
    const config = getAdminTable(table);
    output[table] = {
      columns: Object.keys(config.columns),
      rows: await supabase(env, table, {
        query: {
          select: "*",
          order: config.order,
          limit: "10000"
        }
      })
    };
  }
  return output;
}

function getAdminTable(table) {
  const cleanTable = String(table || "").trim();
  const config = ADMIN_TABLES[cleanTable];
  if (!config) throw new Error("table is not allowed");
  return config;
}

function normalizeAdminValue(value, type, column) {
  if (type === "text" || type === "uuid") return String(value || "").trim();

  if (type === "integer") {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isInteger(number)) throw new Error(`${column} must be an integer`);
    return number;
  }

  if (type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${column} must be greater than zero`);
    return number;
  }

  if (type === "boolean") {
    return value === true || String(value).toLowerCase() === "true";
  }

  if (type === "date") {
    const date = normalizeDate(value);
    if (!date) throw new Error(`${column} is required`);
    return date;
  }

  if (type === "nullable_date") {
    const date = normalizeDate(value);
    return date || null;
  }

  if (type === "debt_status") {
    if (!["open", "paid"].includes(value)) throw new Error("invalid debt status");
    return value;
  }

  if (type === "payment_status") {
    if (!["open", "close"].includes(value)) throw new Error("invalid payment status");
    return value;
  }

  throw new Error(`${column} is not editable`);
}

async function reconcileAllCustomerPaymentStatuses(env) {
  const [entries, payments] = await Promise.all([
    supabase(env, "debt_entries", { query: { select: "customer_id" } }),
    supabase(env, "payments", { query: { select: "customer_id" } })
  ]);
  const customerIds = new Set([
    ...entries.map(row => row.customer_id).filter(Boolean),
    ...payments.map(row => row.customer_id).filter(Boolean)
  ]);

  for (const customerId of customerIds) {
    await reconcileCustomerPaymentStatus(env, customerId);
  }
}

async function reconcileCustomerPaymentStatus(env, customerId) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) throw new Error("customer id is required");

  const [openEntries, openPayments] = await Promise.all([
    supabase(env, "debt_entries", {
      query: {
        select: "*",
        customer_id: `eq.${cleanCustomerId}`,
        status: "neq.paid",
        order: "date.asc,created_at.asc"
      }
    }),
    supabase(env, "payments", {
      query: {
        select: "*",
        customer_id: `eq.${cleanCustomerId}`,
        status: "neq.close",
        order: "date.asc,created_at.asc"
      }
    })
  ]);

  const openDebtTotal = sumAmounts(openEntries);
  const openPaymentTotal = sumAmounts(openPayments);
  if (openDebtTotal <= 0 || openPaymentTotal <= 0) return false;

  const now = new Date().toISOString();
  const paidAt = todayText();
  let remainingToApply = Math.min(openDebtTotal, openPaymentTotal);

  for (const entry of openEntries) {
    if (remainingToApply <= 0) break;
    const debtAmount = Number(entry.amount || 0);

    if (debtAmount <= remainingToApply) {
      await supabase(env, "debt_entries", {
        method: "PATCH",
        query: { id: `eq.${entry.id}` },
        body: { status: "paid", updated_at: now, paid_at: paidAt }
      });
      remainingToApply -= debtAmount;
      continue;
    }

    const openDebtAmount = debtAmount - remainingToApply;
    const debtSplitNote = buildSplitNote(entry.note || "", debtAmount, "ซื้อ", entry.created_at || entry.updated_at || now);
    await supabase(env, "debt_entries", {
      method: "PATCH",
      query: { id: `eq.${entry.id}` },
      body: { amount: remainingToApply, status: "paid", note: debtSplitNote, updated_at: now, paid_at: paidAt }
    });
    await supabase(env, "debt_entries", {
      method: "POST",
      body: {
        customer_id: cleanCustomerId,
        date: normalizeDate(entry.date || paidAt),
        amount: openDebtAmount,
        status: "open",
        note: debtSplitNote,
        created_at: now,
        updated_at: now
      }
    });
    remainingToApply = 0;
  }

  remainingToApply = Math.min(openDebtTotal, openPaymentTotal);

  for (const payment of openPayments) {
    if (remainingToApply <= 0) break;
    const paymentAmount = Number(payment.amount || 0);

    if (paymentAmount <= remainingToApply) {
      await supabase(env, "payments", {
        method: "PATCH",
        query: { id: `eq.${payment.id}` },
        body: { status: "close", updated_at: now }
      });
      remainingToApply -= paymentAmount;
      continue;
    }

    const creditAmount = paymentAmount - remainingToApply;
    const paymentSplitNote = buildSplitNote(payment.note || "", paymentAmount, "จ่าย", payment.created_at || payment.updated_at || now);
    await supabase(env, "payments", {
      method: "PATCH",
      query: { id: `eq.${payment.id}` },
      body: { amount: remainingToApply, status: "close", note: paymentSplitNote, updated_at: now }
    });
    await supabase(env, "payments", {
      method: "POST",
      body: {
        customer_id: cleanCustomerId,
        date: normalizeDate(payment.date || paidAt),
        amount: creditAmount,
        note: paymentSplitNote,
        created_at: now,
        updated_at: now,
        status: "open"
      }
    });
    remainingToApply = 0;
  }

  return true;
}

function sumAmounts(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function mapCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    sortOrder: normalizeSortOrder(row.sort_order),
    active: normalizeActive(row.active)
  };
}

function mapEntry(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    date: normalizeDate(row.date),
    amount: Number(row.amount || 0),
    status: row.status || "open",
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    paidAt: normalizeDate(row.paid_at)
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    date: normalizeDate(row.date),
    amount: Number(row.amount || 0),
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    status: row.status || "open"
  };
}

function normalizeSortOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeActive(value) {
  if (value === false) return false;
  return String(value).trim().toLowerCase() !== "false";
}

function normalizeDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function buildSplitNote(note, fullAmount, actionLabel, timestamp) {
  const baseNote = String(note || "").trim();
  const splitNote = `ยอดเต็ม ${formatAmount(fullAmount)} ${actionLabel}วันที่ ${formatThaiShortDateTime(timestamp)}`;
  return baseNote ? `${baseNote} | ${splitNote}` : splitNote;
}

function formatAmount(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
}

function formatThaiShortDateTime(value) {
  const source = value ? new Date(value) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.day} ${map.month} ${map.year} ${map.hour}:${map.minute}`;
}

function todayText() {
  const now = new Date();
  const bangkok = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const year = bangkok.getFullYear();
  const month = String(bangkok.getMonth() + 1).padStart(2, "0");
  const day = String(bangkok.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
