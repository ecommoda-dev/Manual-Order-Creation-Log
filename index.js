// ══════════════════════════════════════════════════════════════════════
// draft-to-live-cod-manual-order-creation-worker  —  v1.1.0
// ══════════════════════════════════════════════════════════════════════
// v1.1.0 (21-08-2026) — ملاحظة تحويل الخصم لم تعد تُكتب على الأوردر.
//   السبب الموثّق: `DraftOrder.appliedDiscount` مخصّص للخصومات اليدوية
//   فقط ("The custom order-level discount applied") — أكواد الخصم تعيش
//   في `discountCodes` / `platformDiscounts`، فبتظهر دايماً كفرق "غير
//   مُفسَّر" في الحساب بالطرح، فبتتولّد الملاحظة مع كل كود خصم. ده سلوك
//   Shopify موثّق ومستقل عن نسخة الـ API (الحقول دي موجودة من 2024-07،
//   ومفيش أي changelog بيغيّر السلوك ده في 2026-04/07/10).
//   التفاصيل الكاملة محفوظة في D1 → extra.discountInfo (شامل noteText).
// ══════════════════════════════════════════════════════════════════════
// يحوّل Draft Order (المعمول يدوياً من موظف في Shopify Admin) إلى أوردر
// حقيقي قابل للتعديل، عبر draftOrderCreate (clone) + draftOrderComplete
// بـ COD gateway، ثم حذف الـ Draft الأصلي — بديل كامل لـ
// draft-to-live-cod-order-worker (الاعتماد على Admin-UI webhook).
//
// ⚠️ الهدف الحقيقي من هذه الأداة (مؤكد من صاحب الأداة، 20-08-2026):
// الموظف لما يعمل Draft Order يدوي من الأدمن، مفيش عنده صلاحية (scope)
// يختار الـ COD payment gateway وقت التكميل اليدوي — فالتكميل اليدوي
// بيكسر التوافق مع باقي أدوات الـ COD في الستاك. الحل: الأداة دي بتعمل
// clone للـ Draft وتكمّله برمجياً بـ paymentGatewayId ثابت (اللي التطبيق
// يقدر يمرره حتى من غير الـ scope)، فيبقى الأوردر متوافق مع Treasury/COD
// Payment Center من غير أي خطوة يدوية إضافية.
//
// المصدر الوحيد: POST /webhook — GraphQL-registered Shopify Webhook
// Subscription (Webhook Control Center)، Topic: DRAFT_ORDERS_CREATE.
// ⚠️ ليس Admin-UI webhook — التوقيع هنا بـ CLIENT_SECRET، مش
// SHOPIFY_WEBHOOK_SECRET (راجع shopify-webhook-helper skill).
//
// ⚠️ تنسيق التاجات مع stylebox-shopify-order-transfer-worker (إلزامي):
// CLONE_TAG = '_worker_clone' مشتركة بين الأداتين لمنع الحلقة اللانهائية.
// أي تغيير هنا لازم يترافق بنفس التغيير هناك في نفس اللحظة — وإلا الحماية
// تتكسر بصمت. لا تُحوَّل لـ env var/KV إلا بقرار صريح (نوقشت وتم تفضيل
// const ثابتة — راجع محادثة 20-08-2026).
//
// المتغيرات المطلوبة (Cloudflare Dashboard → Settings → Variables):
//   SHOP_DOMAIN     (plain)     6c7e1a-53.myshopify.com
//   WORKER_SECRET   (encrypted) فريد لهذه الأداة — لبوابة الـ HTML/log فقط
//   CLIENT_ID       (encrypted) Shopify OAuth
//   CLIENT_SECRET   (encrypted) Shopify OAuth — وهو نفسه مفتاح توقيع الويبهوك
//                                (لأنه مسجَّل عبر webhookSubscriptionCreate
//                                 من خلال Webhook Control Center، مش Admin-UI)
//
// ملاحظات معمارية:
//   • أداة هجين: مسار /webhook بلا Universal D1 Auth (HMAC بدل Bearer) +
//     باقي المسارات (HTML مراقبة/سجل) بـ Universal D1 Auth كامل.
//   • مسار الويبهوك يرد 200 فوراً ويعالج في ctx.waitUntil() لتفادي مهلة
//     Shopify (5 ثوانٍ).
//   • 401 لفشل الـ HMAC فقط؛ أي فشل آخر يرد 200 + صف في اللوج.
//   • CORS: Option B (strict) — أداة مالية بتنشئ أوردرات COD حقيقية.
// ══════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════════════
const TOOL_NAME    = 'manual_order_creation';
// ⚠️ طلب المستخدم الحرفي كان "Manual_Order_Creation" — تم توحيدها لـ
// snake_case صغير هنا عشان تطابق باقي قيم tool في d1-schema.md (كلها
// lowercase). لو تفضّل القيمة الأصلية بالحروف الكبيرة، استخدم
// ecommoda-tool-rename skill بعد النشر لتفادي orphan records.
const VERSION      = '1.1.0';
const API_VERSION  = '2026-01';

// COD gateway — hardcoded عمداً: scope الـ payment_gateways غير متاح للتطبيق
const COD_GATEWAY_ID = 'gid://shopify/PaymentGateway/125688283458';

// التاج الذي يمنع الحلقة اللانهائية مع stylebox-shopify-order-transfer-worker
// ⚠️ مشترك بين الأداتين — لا تُغيَّر هنا وحدها أبداً
const CLONE_TAG = '_worker_clone';

// التاج الجديد — يفضل على الأوردر النهائي لتمييز مصدره (زي 'StyleBox' عند
// stylebox-shopify-order-transfer-worker)
const MANUAL_TAG = 'Manual_Order';


// ══════════════════════════════════════════════════════════════════════
// §CORS — Option B (strict): أداة مالية تنشئ أوردرات COD حقيقية
// ══════════════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];
function getCORS(request) {
  const origin  = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Event-Id, X-Shopify-Webhook-Id',
    'Vary': 'Origin',
  };
}


// ══════════════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════════════
function json(body, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(body), { status, headers });
}

function shopDomain(env) {
  return (env.SHOP_DOMAIN || '').replace(/\/$/, '');
}

function toGid(id, type) {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/${type}/${s}`;
}

/** مقارنة ثابتة الزمن — تمنع timing attacks على HMAC */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * تحقق HMAC لويبهوك Shopify — مسجَّل عبر GraphQL API (Webhook Control Center)
 * فالمفتاح CLIENT_SECRET، مش SHOPIFY_WEBHOOK_SECRET (راجع الهيدر أعلى الملف).
 * ⚠️ rawBody لازم يكون ناتج request.text() قبل أي JSON.parse.
 */
async function verifyShopifyHmac(secret, rawBody, headerHmac) {
  if (!secret || !headerHmac) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return safeEqual(digest, headerHmac);
}

/** تحويل tags من الويبهوك (نص مفصول بفواصل) أو GraphQL (مصفوفة) إلى مصفوفة */
function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}


// ══════════════════════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify — EcomModa D1 Pattern v1.3.0
// ══════════════════════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return { exists: true, hasPin: !!row.pin, isActive: !!row.is_active };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

async function getLogs(db, {
  tool = null, employee = null, type = null, search = null, limit = 100, offset = 0,
} = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type)     { sql += ' AND type = ?';     b.push(type); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  b.push(Math.min(limit, 100), offset);
  return (await db.prepare(sql).bind(...b).all()).results;
}

async function getLogsCount(db, { tool = null, employee = null, search = null } = {}) {
  let sql = "SELECT COUNT(*) as total FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

async function getLogsExport(db, { tool = null, employee = null, search = null } = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY timestamp DESC LIMIT 2000';
  return (await db.prepare(sql).bind(...b).all()).results;
}


// ══════════════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════════════

async function getAccessToken(env) {
  const res = await fetch(`https://${shopDomain(env)}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const res = await fetch(
    `https://${shopDomain(env)}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return res.json();
}

// ─── §SHOPIFY::queries ───

const DRAFT_ORDER_QUERY = `
  query GetDraftOrder($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      tags
      note2
      email
      phone
      poNumber
      taxExempt
      discountCodes
      acceptAutomaticDiscounts
      allowDiscountCodesInCheckout
      totalDiscountsSet   { shopMoney { amount currencyCode } }
      subtotalPriceSet    { shopMoney { amount currencyCode } }
      totalPriceSet       { shopMoney { amount currencyCode } }
      customer { id }
      customAttributes { key value }
      appliedDiscount {
        title description value valueType
        amountSet { shopMoney { amount currencyCode } }
      }
      shippingAddress {
        address1 address2 city company
        provinceCode countryCodeV2 zip
        firstName lastName phone
      }
      billingAddress {
        address1 address2 city company
        provinceCode countryCodeV2 zip
        firstName lastName phone
      }
      shippingLine {
        title
        originalPriceSet { shopMoney { amount currencyCode } }
      }
      lineItems(first: 250) {
        nodes {
          title
          quantity
          requiresShipping
          sku
          taxable
          variant { id }
          weight { unit value }
          priceOverride { amount currencyCode }
          originalUnitPriceWithCurrency { amount currencyCode }
          customAttributes { key value }
          appliedDiscount {
            title description value valueType
            amountSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`;

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet    { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_COMPLETE_MUTATION = `
  mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean, $paymentGatewayId: ID) {
    draftOrderComplete(id: $id, paymentPending: $paymentPending, paymentGatewayId: $paymentGatewayId) {
      draftOrder {
        id
        order {
          id
          name
          legacyResourceId
          displayFinancialStatus
        }
      }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_DELETE_MUTATION = `
  mutation DraftOrderDelete($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) {
      deletedId
      userErrors { field message }
    }
  }
`;

// ─── §SHOPIFY::tagsRemove ───
// يشيل CLONE_TAG من الأوردر الحقيقي النهائي بعد التكميل — وظيفته
// (منع الحلقة اللانهائية على الـ Draft) خلصت، ووجوده على الأوردر
// الحقيقي مالوش أي فايدة وممكن يلخبط تقارير مستقبلية بالتاج.
// MANUAL_TAG يفضل عليه — مقصود، بيميّز مصدر الأوردر (زي 'StyleBox').
const TAGS_REMOVE_MUTATION = `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;


// ══════════════════════════════════════════════════════════════════════
// §CONVERT — منطق الأداة الأساسي: تحويل Draft يدوي → أوردر COD حقيقي
// ══════════════════════════════════════════════════════════════════════

// ─── §CONVERT::claimDraft ───
/**
 * حجز ذرّي للـ draft قبل المعالجة (Idempotency).
 * INSERT OR IGNORE يضمن أن استدعاءين متزامنين (إعادة إرسال الويبهوك) لن
 * يمرّا معاً.
 * @returns true لو نجح الحجز (أول مرة) — false لو سبق حجزه/معالجته
 */
async function claimDraft(db, draftGid, eventId, source) {
  const res = await db.prepare(`
    INSERT OR IGNORE INTO manual_order_processed
      (draft_order_id, event_id, source, status, created_at)
    VALUES (?, ?, ?, 'processing', ?)
  `).bind(draftGid, eventId ?? null, source, new Date().toISOString()).run();

  return (res.meta?.changes ?? 0) > 0;
}

// ─── §CONVERT::finishClaim ───
async function finishClaim(db, draftGid, status, orderId, orderName) {
  await db.prepare(`
    UPDATE manual_order_processed
       SET status = ?, order_id = ?, order_name = ?, completed_at = ?
     WHERE draft_order_id = ?
  `).bind(status, orderId ?? null, orderName ?? null, new Date().toISOString(), draftGid).run();
}

// ─── §CONVERT::releaseClaim ───
/** إلغاء الحجز عند الفشل — يسمح لإعادة محاولة Shopify بالنجاح */
async function releaseClaim(db, draftGid) {
  await db.prepare('DELETE FROM manual_order_processed WHERE draft_order_id = ?')
    .bind(draftGid).run().catch(() => {});
}

// ─── §CONVERT::buildDraftInput ───
/**
 * يبني DraftOrderInput من الـ Draft الأصلي مع الحفاظ على:
 * السعر المعدّل (priceOverride) · خصم الأوردر · خصم الصنف ·
 * الملاحظات · الـ customAttributes · بيانات الشحن.
 * التاجات: كل تاجات الـ Draft الأصلي + CLONE_TAG (منع الحلقة) +
 * MANUAL_TAG (تمييز المصدر) — الاتنين يُضافا على الـ clone.
 */
function buildDraftInput(draft) {
  const input = { useCustomerDefaultAddress: false };

  if (draft.customer?.id) {
    input.purchasingEntity = { customerId: draft.customer.id };
  }

  input.lineItems = (draft.lineItems?.nodes || []).map((item) => {
    const li = {
      quantity:         item.quantity,
      requiresShipping: item.requiresShipping ?? true,
    };

    if (item.variant?.id) {
      li.variantId = item.variant.id;
      if (item.priceOverride?.amount != null) {
        li.priceOverride = {
          amount:       String(item.priceOverride.amount),
          currencyCode: item.priceOverride.currencyCode,
        };
      }
    } else {
      li.title   = item.title;
      li.taxable = item.taxable ?? true;
      if (item.sku) li.sku = item.sku;
      if (item.weight) {
        li.weight = { unit: item.weight.unit, value: item.weight.value };
      }
      if (item.originalUnitPriceWithCurrency?.amount != null) {
        li.originalUnitPriceWithCurrency = {
          amount:       String(item.originalUnitPriceWithCurrency.amount),
          currencyCode: item.originalUnitPriceWithCurrency.currencyCode,
        };
      }
    }

    if (item.customAttributes?.length) {
      li.customAttributes = item.customAttributes.map(a => ({ key: a.key, value: a.value }));
    }

    if (item.appliedDiscount) {
      li.appliedDiscount = {
        title:       item.appliedDiscount.title || 'Discount',
        description: item.appliedDiscount.description || undefined,
        value:       item.appliedDiscount.value,
        valueType:   item.appliedDiscount.valueType,
      };
    }

    return li;
  });

  // ── الخصومات — أكواد الخصم لا تظهر في appliedDiscount لكنها تخفض
  // subtotalPrice فعلياً. تحويلها لخصم ثابت على مستوى الأوردر بدل
  // إعادة تطبيق الكود (تفادي استهلاك استخدام إضافي أو فشل حد الاستخدام).
  const money = (m) => {
    const v = parseFloat(m?.shopMoney?.amount ?? m?.amount ?? 'NaN');
    return Number.isFinite(v) ? v : 0;
  };

  const codes           = Array.isArray(draft.discountCodes) ? draft.discountCodes : [];
  const totalDiscounts  = money(draft.totalDiscountsSet);
  const orderDiscAmount = money(draft.appliedDiscount?.amountSet);
  const lineDiscTotal   = (draft.lineItems?.nodes || [])
    .reduce((sum, it) => sum + money(it.appliedDiscount?.amountSet), 0);

  const unexplained = totalDiscounts - orderDiscAmount - lineDiscTotal;
  const codeDiscount = unexplained > 0.005 ? unexplained : 0;

  let discountNote = null;

  if (codeDiscount > 0) {
    const mergedAmount = +(orderDiscAmount + codeDiscount).toFixed(2);
    const codesLabel   = codes.length ? codes.join(', ') : 'automatic';

    input.appliedDiscount = {
      title:       draft.appliedDiscount?.title || 'Discount',
      description: `Converted from: ${codesLabel}`,
      value:       mergedAmount,
      valueType:   'FIXED_AMOUNT',
    };

    discountNote =
      `[worker] Discount ${codesLabel} (-${codeDiscount.toFixed(2)}) ` +
      `converted to a fixed order discount of ${mergedAmount.toFixed(2)} ` +
      `to avoid consuming a code use. Original: ${draft.name}`;

  } else if (draft.appliedDiscount) {
    input.appliedDiscount = {
      title:       draft.appliedDiscount.title || 'Discount',
      description: draft.appliedDiscount.description || undefined,
      value:       draft.appliedDiscount.value,
      valueType:   draft.appliedDiscount.valueType,
    };
  }

  input.acceptAutomaticDiscounts     = false;
  input.allowDiscountCodesInCheckout = false;

  // ── العناوين ──
  const addr = (a) => {
    if (!a) return null;
    const out = {};
    if (a.address1)      out.address1     = a.address1;
    if (a.address2)      out.address2     = a.address2;
    if (a.city)          out.city         = a.city;
    if (a.company)       out.company      = a.company;
    if (a.provinceCode)  out.provinceCode = a.provinceCode;
    if (a.countryCodeV2) out.countryCode  = a.countryCodeV2;
    if (a.zip)           out.zip          = a.zip;
    if (a.firstName)     out.firstName    = a.firstName;
    if (a.lastName)      out.lastName     = a.lastName;
    if (a.phone)         out.phone        = a.phone;
    return Object.keys(out).length ? out : null;
  };

  const ship = addr(draft.shippingAddress);
  const bill = addr(draft.billingAddress);
  if (ship) input.shippingAddress = ship;
  if (bill) input.billingAddress  = bill;

  // ── سطر الشحن ──
  if (draft.shippingLine) {
    const shipMoney = draft.shippingLine.originalPriceSet?.shopMoney;
    input.shippingLine = { title: draft.shippingLine.title || 'Shipping' };
    if (shipMoney?.amount != null) {
      input.shippingLine.priceWithCurrency = {
        amount:       String(shipMoney.amount),
        currencyCode: shipMoney.currencyCode,
      };
    }
  }

  // ── ملاحظات ──
  // ⚠️ v1.1.0 — ملاحظة تحويل الخصم لم تعد تُكتب على الأوردر (قرار المالك،
  // 21-08-2026). السبب: التفاصيل الكاملة محفوظة أصلاً في D1 داخل
  // extra.discountInfo (بما فيها النص الكامل في noteText)، وحقل note على
  // الأوردر مساحة مشتركة مع أدوات أخرى تكتب فيها تنبيهات تشغيلية
  // (مثل Duplicate Order Checker) — إبقاؤه نظيفاً يحافظ على وضوحها.
  // ملاحظة العميل الأصلية (note2) وحدها هي التي تُنقل للـ clone.
  if (draft.note2) input.note = draft.note2;

  if (draft.email)    input.email     = draft.email;
  if (draft.phone)    input.phone     = draft.phone;
  if (draft.poNumber) input.poNumber  = draft.poNumber;
  if (draft.taxExempt != null) input.taxExempt = draft.taxExempt;
  if (draft.customAttributes?.length) {
    input.customAttributes = draft.customAttributes.map(a => ({ key: a.key, value: a.value }));
  }

  // ── التاجز: تاجات الأصل + CLONE_TAG (منع الحلقة) + MANUAL_TAG (المصدر) ──
  const originalTags = normalizeTags(draft.tags);
  const tagSet = new Set(originalTags);
  tagSet.add(CLONE_TAG);
  tagSet.add(MANUAL_TAG);
  input.tags = [...tagSet];

  return {
    input,
    discountInfo: {
      codes,
      totalDiscounts,
      orderDiscAmount,
      lineDiscTotal,
      codeDiscount: +codeDiscount.toFixed(2),
      converted: codeDiscount > 0,
      // v1.1.0 — النص الكامل الذي كان يُكتب على الأوردر قبل الإصدار ده.
      // محفوظ هنا فقط (D1 → extra.discountInfo.noteText) وليس على الأوردر.
      noteText: discountNote,
    },
  };
}

// ─── §CONVERT::processDraft ───
/**
 * المعالجة الكاملة لـ draft واحد.
 * @returns {object} نتيجة موحّدة { ok, skipped?, reason?, order? }
 */
async function processDraft(env, rawDraftId, { source, eventId = null }) {
  const draftGid = toGid(rawDraftId, 'DraftOrder');

  // 1) الحجز الذرّي — يمنع المعالجة المزدوجة من إعادة إرسال الويبهوك
  const claimed = await claimDraft(env.DB, draftGid, eventId, source);
  if (!claimed) {
    await writeLog(env.DB, {
      tool: TOOL_NAME, type: 'skipped',
      orderId: draftGid,
      notes:   'duplicate — draft already claimed/processed',
      extra:   { source, eventId },
    }).catch(() => {});
    return { ok: true, skipped: true, reason: 'already_processed', draftOrderId: draftGid };
  }

  try {
    // 2) توكن
    const token = await getAccessToken(env);
    if (!token) throw new Error('OAuth failed — no access_token');

    // 3) قراءة الـ Draft الأصلي
    const draftRes = await shopifyGQL(env, token, DRAFT_ORDER_QUERY, { id: draftGid });
    if (draftRes.errors) {
      throw new Error('GraphQL error (read draft): ' + JSON.stringify(draftRes.errors));
    }
    const draft = draftRes.data?.draftOrder;
    if (!draft) throw new Error('Draft order not found: ' + draftGid);

    // 4) حارس الحلقة اللانهائية — drafts من stylebox-shopify-order-transfer-worker
    if (normalizeTags(draft.tags).includes(CLONE_TAG)) {
      await finishClaim(env.DB, draftGid, 'skipped', null, null);
      await writeLog(env.DB, {
        tool: TOOL_NAME, type: 'skipped',
        orderId: draftGid, orderName: draft.name,
        notes:   `worker clone (${CLONE_TAG}) — skipped`,
        extra:   { source, eventId },
      }).catch(() => {});
      return { ok: true, skipped: true, reason: 'worker_clone', draftOrderId: draftGid };
    }

    // 5) إنشاء الـ Draft المستنسخ (+ CLONE_TAG + MANUAL_TAG)
    const { input, discountInfo } = buildDraftInput(draft);
    const createRes = await shopifyGQL(env, token, DRAFT_ORDER_CREATE_MUTATION, { input });
    if (createRes.errors) {
      throw new Error('GraphQL error (create draft): ' + JSON.stringify(createRes.errors));
    }
    const createErrs = createRes.data?.draftOrderCreate?.userErrors || [];
    if (createErrs.length) {
      throw new Error('draftOrderCreate userErrors: ' + JSON.stringify(createErrs));
    }
    const newDraft = createRes.data?.draftOrderCreate?.draftOrder;
    if (!newDraft?.id) throw new Error('draftOrderCreate returned no draft');

    // 5b) حارس السعر — يقارن إجمالي الـ clone بالأصلي
    const origTotal  = parseFloat(draft.totalPriceSet?.shopMoney?.amount ?? 'NaN');
    const cloneTotal = parseFloat(newDraft.totalPriceSet?.shopMoney?.amount ?? 'NaN');
    let priceMismatch = null;
    if (Number.isFinite(origTotal) && Number.isFinite(cloneTotal)) {
      const diff = +(cloneTotal - origTotal).toFixed(2);
      if (Math.abs(diff) > 0.01) {
        priceMismatch = { originalTotal: origTotal, cloneTotal, diff };
      }
    }

    // 6) إكمال الـ Draft بـ COD
    const completeRes = await shopifyGQL(env, token, DRAFT_ORDER_COMPLETE_MUTATION, {
      id:               newDraft.id,
      paymentPending:   true,
      paymentGatewayId: COD_GATEWAY_ID,
    });
    if (completeRes.errors) {
      throw new Error('GraphQL error (complete draft): ' + JSON.stringify(completeRes.errors));
    }
    const completeErrs = completeRes.data?.draftOrderComplete?.userErrors || [];
    if (completeErrs.length) {
      throw new Error('draftOrderComplete userErrors: ' + JSON.stringify(completeErrs));
    }
    const order = completeRes.data?.draftOrderComplete?.draftOrder?.order;
    if (!order?.id) throw new Error('draftOrderComplete returned no order');

    // 7) tagsRemove — يشيل CLONE_TAG من الأوردر الحقيقي (MANUAL_TAG يفضل)
    let tagsRemoveWarning = null;
    try {
      const tagsRes = await shopifyGQL(env, token, TAGS_REMOVE_MUTATION, {
        id:   order.id,
        tags: [CLONE_TAG],
      });
      const tagsErrs = tagsRes.data?.tagsRemove?.userErrors || [];
      if (tagsErrs.length || tagsRes.errors) {
        tagsRemoveWarning = JSON.stringify(tagsErrs.length ? tagsErrs : tagsRes.errors);
      }
    } catch (e) {
      tagsRemoveWarning = e.message;
    }

    // 8) حذف الـ Draft الأصلي
    let deleteWarning = null;
    try {
      const delRes  = await shopifyGQL(env, token, DRAFT_ORDER_DELETE_MUTATION, {
        input: { id: draftGid },
      });
      const delErrs = delRes.data?.draftOrderDelete?.userErrors || [];
      if (delErrs.length || delRes.errors) {
        deleteWarning = JSON.stringify(delErrs.length ? delErrs : delRes.errors);
      }
    } catch (e) {
      deleteWarning = e.message;
    }

    // 9) إنهاء الحجز + اللوج
    await finishClaim(env.DB, draftGid, 'completed', order.legacyResourceId || order.id, order.name);
    await writeLog(env.DB, {
      tool: TOOL_NAME, type: 'completed',
      orderId:   order.legacyResourceId || order.id,
      orderName: order.name,
      notes:     `draft ${draft.name} → order ${order.name}` +
                 (discountInfo.converted ? ` | discount ${discountInfo.codeDiscount} converted` : '') +
                 (priceMismatch ? ` | ⚠️ PRICE MISMATCH ${priceMismatch.diff}` : '') +
                 (tagsRemoveWarning ? ' | tagsRemove failed' : '') +
                 (deleteWarning ? ' | original draft NOT deleted' : ''),
      valueBefore: Number.isFinite(origTotal)  ? String(origTotal)  : null,
      valueAfter:  Number.isFinite(cloneTotal) ? String(cloneTotal) : null,
      extra: {
        source, eventId,
        originalDraftId:   draftGid,
        originalDraftName: draft.name,
        clonedDraftId:     newDraft.id,
        financialStatus:   order.displayFinancialStatus,
        lineItemCount:     draft.lineItems?.nodes?.length ?? 0,
        discountInfo,
        priceMismatch,
        tagsRemoveWarning,
        deleteWarning,
      },
    }).catch(() => {});

    return {
      ok: true,
      draftOrderId: draftGid,
      order: {
        id:              order.legacyResourceId || order.id,
        name:            order.name,
        financialStatus: order.displayFinancialStatus,
      },
      discountInfo,
      priceMismatch,
      tagsRemoveWarning,
      deleteWarning,
    };

  } catch (err) {
    // فشل → أطلق الحجز حتى تنجح إعادة محاولة Shopify
    await releaseClaim(env.DB, draftGid);
    await writeLog(env.DB, {
      tool: TOOL_NAME, type: 'failed',
      orderId: draftGid,
      notes:   String(err.message || err).slice(0, 500),
      extra:   { source, eventId },
    }).catch(() => {});
    return { ok: false, error: String(err.message || err), draftOrderId: draftGid };
  }
}


// ══════════════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {

    // ── OPTIONS preflight — دائماً أولاً ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, '') || '/';
    const action = url.searchParams.get('action') || '';

    // ─── §WEBHOOK — قبل بوابة WORKER_SECRET، غير قابل للتفاوض ─────────
    // مسجَّل عبر Webhook Control Center (GraphQL API) — التوقيع بـ
    // CLIENT_SECRET، مش SHOPIFY_WEBHOOK_SECRET.
    // ────────────────────────────────────────────────────────────────
    if (path === '/webhook') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method not allowed' }, 405, request);
      }

      // ⚠️ raw body قبل أي JSON.parse — الـ HMAC محسوب على البايتات الخام
      const rawBody   = await request.text();
      const hmacHdr   = request.headers.get('X-Shopify-Hmac-Sha256');
      const webhookId = request.headers.get('X-Shopify-Webhook-Id');
      const eventId   = request.headers.get('X-Shopify-Event-Id') || webhookId;
      const topic     = request.headers.get('X-Shopify-Topic');

      const secret = env.CLIENT_SECRET;
      const valid  = await verifyShopifyHmac(secret, rawBody, hmacHdr);

      if (!valid) {
        ctx.waitUntil(writeLog(env.DB, {
          tool: TOOL_NAME, type: 'failed',
          notes: 'HMAC verification FAILED — wrong signing secret or tampered body',
          extra: {
            source: 'webhook', eventId, topic,
            hmacHeaderPresent: !!hmacHdr,
            bodyBytes:         rawBody.length,
            secretPresent:     !!env.CLIENT_SECRET,
            envKeys:           Object.keys(env),
          },
        }).catch(() => {}));
        return new Response('Invalid signature', { status: 401 });
      }

      let payload;
      try { payload = JSON.parse(rawBody); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400, request); }

      const draftId = payload.admin_graphql_api_id || payload.id;
      if (!draftId) return json({ ok: false, error: 'No draft id in payload' }, 400, request);

      // فلترة مبكرة من الـ payload نفسه — توفير استدعاء كامل لـ Shopify
      if (normalizeTags(payload.tags).includes(CLONE_TAG)) {
        ctx.waitUntil(writeLog(env.DB, {
          tool: TOOL_NAME, type: 'skipped',
          orderId: toGid(draftId, 'DraftOrder'),
          orderName: payload.name || null,
          notes: `worker clone (payload tags) — skipped`,
          extra: { source: 'webhook', eventId, topic },
        }).catch(() => {}));
        return json({ ok: true, skipped: true, reason: 'worker_clone' }, 200, request);
      }

      // 200 فوري + معالجة في الخلفية
      ctx.waitUntil(processDraft(env, draftId, { source: 'webhook', eventId }));
      return json({ ok: true, accepted: true }, 200, request);
    }

    // ─── §AUTH — كل ما بعده يتطلب WORKER_SECRET ───────────────────────
    const auth = request.headers.get('Authorization') || '';
    if (auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ ok: false, error: 'Unauthorized' }, 401, request);
    }

    try {

      // ── check_employee — GET ──
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      // ── register_pin — POST ──
      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      // ── verify_employee — POST ──
      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        await writeLog(env.DB, {
          tool: TOOL_NAME, type: 'login', employee: username,
          notes: `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName }, 200, request);
      }

      // ── log_logout — GET ──
      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool: TOOL_NAME, type: 'logout', employee: username,
            notes: `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200, request);
      }

      // ── get_employees — GET ──
      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }

      // ─── §MONITOR ───────────────────────────────────────────────────
      // إحصائيات سريعة لتاب المراقبة — مبنية من نفس جدول logs، بلا حاجة
      // لجدول/endpoint منفصل.
      if (action === 'get_monitor_stats') {
        const todayStart = new Date();
        todayStart.setUTCHours(-3, 0, 0, 0); // منتصف ليل القاهرة (UTC+3) بتوقيت UTC
        const todayIso = todayStart.toISOString();

        const counts = await env.DB.prepare(`
          SELECT type, COUNT(*) as c FROM logs
          WHERE tool = ? AND timestamp >= ? AND type IN ('completed','skipped','failed')
          GROUP BY type
        `).bind(TOOL_NAME, todayIso).all();

        const lastEntry = await env.DB.prepare(`
          SELECT timestamp, type, order_name, notes FROM logs
          WHERE tool = ? AND type IN ('completed','skipped','failed')
          ORDER BY timestamp DESC LIMIT 1
        `).bind(TOOL_NAME).first();

        const statMap = { completed: 0, skipped: 0, failed: 0 };
        for (const row of counts.results || []) statMap[row.type] = row.c;

        return json({
          ok: true,
          today: statMap,
          lastEntry: lastEntry || null,
        }, 200, request);
      }

      // ── health ──
      if (action === 'health' || action === '') {
        return json({
          ok: true, tool: TOOL_NAME, version: VERSION,
          apiVersion: API_VERSION,
          entryPoints: ['POST /webhook'],
        }, 200, request);
      }

      // ─── §LOG-ENDPOINTS ───────────────────────────────────────────
      if (request.method === 'GET' && action === 'get_logs') {
        const employee = url.searchParams.get('employee') || null;
        const type     = url.searchParams.get('type')     || null;
        const search   = url.searchParams.get('search')   || null;
        const limit    = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 100);
        const offset   = Math.max(parseInt(url.searchParams.get('offset') || '0'),    0);
        const entries  = await getLogs(env.DB, { tool: TOOL_NAME, employee, type, search, limit, offset });
        return json({ ok: true, entries }, 200, request);
      }

      if (request.method === 'GET' && action === 'get_logs_count') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const total    = await getLogsCount(env.DB, { tool: TOOL_NAME, employee, search });
        return json({ ok: true, total }, 200, request);
      }

      if (request.method === 'GET' && action === 'get_logs_export') {
        const employee = url.searchParams.get('employee') || null;
        const search   = url.searchParams.get('search')   || null;
        const entries  = await getLogsExport(env.DB, { tool: TOOL_NAME, employee, search });
        return json({ ok: true, entries }, 200, request);
      }

      return json({ ok: false, error: 'Not found' }, 404, request);

    } catch (err) {
      await writeLog(env.DB, {
        tool: TOOL_NAME, type: 'failed',
        notes: 'handler: ' + String(err.message || err).slice(0, 480),
      }).catch(() => {});
      return json({ ok: false, error: String(err.message || err) }, 500, request);
    }
  },
};
