// ══════════════════════════════════════════════════════════════════════
// draft-to-live-cod-manual-order-creation-worker  —  v2.0.1
// ══════════════════════════════════════════════════════════════════════
// skills: worker-builder v3.7.0 · constants v3.1.0 · shopify-graphql-helper v2.1.0 · shopify-webhook-helper — 24-09-2026
// ══════════════════════════════════════════════════════════════════════
// v2.0.1 (24-09-2026) — الحارس الديناميكي لقيم اللوج (الطبقة ٥، worker-builder
//   Step 7-ج) + استبدال check-log-values.mjs بالنسخة المصلَّحة (v3.1 — بتمسك
//   object shorthand `{ tool, type }` اللي كانت بتعدّي في صمت). §LOG-REG:
//   LOG_REGISTRY مبني من log-values.json، الحارس جوّه writeLog (الأنكور
//   الوحيد في الأداة دي)، مفيش رفض كتابة على قيمة غير مسجّلة —
//   extra._unregistered + UPSERT صامت في log_value_alerts بعد الكتابة.
//   مراجعة أولى (Step ②) طلّعت exit 0 نضيف: كل نداءات writeLog في الأداة
//   دي بتستخدم مفتاح type صريح (LOG_TYPES.X) بدون shorthand ولا قيم
//   ديناميكية — فمفيش قيمة جديدة اتسجّلت في log-values.json.
// ──────────────────────────────────────────────────────────────────────
// v2.0.0 (13-09-2026) — مراجعة شاملة مقابل ecommoda-worker-builder v3.1.0
//   و ecommoda-constants v2.2.0. البنود (التفاصيل في CHANGELOG الريبو):
//   🔴 أمن    : حارس WORKER_SECRET الغايب — قبله السر الناقص كان بينتج
//               السلسلة "Bearer undefined" فأي طلب بالهيدر ده **بيعدّي**.
//   🔴 أمن    : الويبهوك بيتحقق من Topic و Shop Domain — قبله أي topic
//               موقّع بـ CLIENT_SECRET كان بيدخل المعالجة كـ draft.
//   🔴 بيانات : الحجز **مابيترفعش** بعد ما الأوردر يتعمل فعلاً (نقطة اللا
//               رجعة) — قبله فشل D1 في الخطوة الأخيرة كان بيرفع الحجز،
//               وإعادة محاولة شوبيفاي بتعمل أوردر COD تاني حقيقي.
//   🔴 بيانات : الـ clone بيتحذف لو التكميل فشل — قبله كان يتيتّم في الأدمن.
//   🔴 صمت    : shopifyGQL بقت نسخة العقد الكاملة (Step 5A ①) — قبلها
//               `return res.json()` كانت بتخلّي 401/429/5xx تعدّي كأنها رد
//               سليم، فترجع رسالة كاذبة "Draft order not found".
//   🟠 صمت    : extra.result بأربع/خمس الحالات (constants §12) — priceMismatch
//               و tagsRemove/delete الفاشلين بقوا `warning` مش `completed` صامت.
//   🟠 صمت    : فشل D1 بيرجع `logged:false` — اتشال كل .catch(() => {}).
//   🟠 صمت    : توقيت القاهرة بـ Intl (constants §13) — قبله setUTCHours(-3)
//               ثابت، وكان بيغلط بساعة من 29-10-2026 بلا أي رسالة.
//   🟠 صمت    : ?action=diag و ?action=get_config (Step 5A ⑨).
//   🟠 صمت    : فلاتر السجل قوايم + dateFrom/dateTo + ترتيب server-side،
//               و get_logs_export بيرجّع cap/total/truncated (Standards #30).
// ──────────────────────────────────────────────────────────────────────
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
//   SHOP_DOMAIN     (plain)     6c7e1a-53.myshopify.com — من [vars] في wrangler.toml
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
const VERSION      = '2.0.1';
const API_VERSION  = '2026-01';

// ─── §CONSTANTS::logValues ───
// 🔴 قيم `type` المسجّلة لهذه الأداة في `ecommoda-constants` §7 (Rule 7):
//    completed · failed · skipped · login · logout — **وبس**.
//    أي قيمة جديدة تتسجّل هناك **قبل** أول writeLog، مش بعده. عشان كده
//    فشل الـ HMAC لسه بيتسجّل `failed` (مش `hmac_failed` زي
//    duplicate_order_check و stylebox_price_sync) — الفرق بقى صريح في
//    `extra.result` + `extra.stage` بدل ما يبقى مخبّأ في notes.
const LOG_TYPES = Object.freeze({
  COMPLETED: 'completed',
  FAILED:    'failed',
  SKIPPED:   'skipped',
  LOGIN:     'login',
  LOGOUT:    'logout',
});

// ─── §CONSTANTS::result ───
// مفردات `extra.result` — مقفولة، من `ecommoda-constants` §12.
// success  : الفعل تم واتأكد
// warning  : الأساسي تم وحاجة تكميلية ما اتأكدتش أو فشلت
// error    : حاولنا وفشلنا — النداء وصل لشوبيفاي واترفض
// rejected : اتوقف قبل أي محاولة (HMAC · payload باظ · تاج الـ clone)
// already  : الحالة المستهدفة موجودة أصلاً — مفيش حاجة كانت مطلوبة
const RESULT = Object.freeze({
  SUCCESS: 'success', WARNING: 'warning', ERROR: 'error',
  REJECTED: 'rejected', ALREADY: 'already',
});
// `extra.stage` — قيمتان (constants §12)
const STAGE = Object.freeze({ LOOKUP: 'lookup', WRITE: 'write' });

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json اللي جنبها — بتتحدّث معاه في نفس
// الـ commit (worker-builder Step 7-ج). الأداة دي بتكتب تحت tool واحد بس
// (manual_order_creation) — مفيش أفعال بتتكتب تحت tool مشترك زي
// metafields_change، فمفيش مدخل تاني في الأوبجكت ده.
const LOG_REGISTRY = {
  manual_order_creation: new Set(['login', 'logout', 'completed', 'failed', 'skipped']),
};

const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

// UPSERT على (source_tool, tool, type) — صف واحد لكل قيمة، hits بيعدّ.
// الحدث الكامل مش بيضيع: الصف الأصلي موجود في logs وعليه _unregistered،
// والجدول ده فهرس مش سجل تاني — عشان كده dedupe مش صف لكل حدث.
const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

// فشل التنبيه ممنوع يأثر على أي حاجة — try/catch صامت. بتجمّع التكرار
// جوّه نفس الدفعة في صف واحد (hits) قبل ما تكتب.
async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

// سقف تصدير السجل — بيرجع للواجهة كـ `cap` (Standards #30)
const LOG_EXPORT_MAX = 2000;

// Topic الويبهوك الوحيد المقبول (صيغة REST في الهيدر — shopify-webhook-helper)
const WEBHOOK_TOPIC = 'draft_orders/create';

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

// ─── §HELPERS::time ───
// 🔴 توقيت القاهرة **يتحسب، مايتكتبش ثابت** (`ecommoda-constants` §13).
//    النسخة دي **نفسها بالحرف** في `index.html` — نسختين مختلفتين = الشاشة
//    والسجل بيقولوا وقتين مختلفين لنفس الصف.
//    الإزاحة الثابتة القديمة (`setUTCHours(-3, …)`) كانت هتغلط بساعة من
//    **29-10-2026** بلا أي رسالة: عدّاد «النهار» كان هيبدأ الساعة ١ بدل ١٢.
const CAIRO_TZ = 'Africa/Cairo';
const _cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function cairoParts(d) {
  const o = {};
  for (const p of _cairoFmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';        // حارس: بعض المحركات بترجّع 24
  return o;
}
function cairoOffsetMinutes(d) {             // ١٨٠ صيفًا · ١٢٠ شتاءً
  const p = cairoParts(d);
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day,
                              +p.hour, +p.minute, +p.second) - d.getTime()) / 60000);
}
function cairoDate() { const p = cairoParts(new Date()); return `${p.year}-${p.month}-${p.day}`; }

// حدود يوم تقويمي بالقاهرة → UTC — الإزاحة تتقاس عند **ظهر** اليوم
// (أي تحويل توقيت بيحصل فجرًا، فالظهر بيدّي إزاحة اليوم الصحيحة)
function cairoDayBoundsUTC(dateStr) {
  const offMin = cairoOffsetMinutes(new Date(`${dateStr}T12:00:00.000Z`));
  return {
    start: new Date(Date.parse(`${dateStr}T00:00:00.000Z`) - offMin * 60000).toISOString(),
    end:   new Date(Date.parse(`${dateStr}T23:59:59.999Z`) - offMin * 60000).toISOString(),
  };
}

// ─── §HELPERS::assertEnv ───
// متغير ناقص لازم يوقف العملية **برسالة باسمه**. SHOP_DOMAIN الناقص بيرجّع
// `"error code: 1003" is not valid JSON` — رسالة مالهاش أي علاقة بالسبب.
const ENV_REQUIRED = { shopify: ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'] };

function assertEnv(env, ...groups) {
  const missing = [];
  for (const g of groups) {
    for (const key of (ENV_REQUIRED[g] || [])) {
      const v = env[key];
      if (typeof v !== 'string' || !v.trim()) missing.push(key);
    }
  }
  if (missing.length) {
    throw new Error(`متغيّرات ناقصة على الـ Worker: ${missing.join(', ')} — ضيفها في الداشبورد ثم Promote`);
  }
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

// ─── §HELPERS::safeLog ───
// 🔴 فشل D1 لازم **يبان** (Step 5A ⑦). `writeLog(...).catch(() => {})` بتبلع
//    الفشل بالكامل: العملية حصلت والسجل فاضي، والواجهة مش عارفة.
//    الدالة دي بترجّع `{ logged, logError }` عشان الرد يحملها للواجهة.
async function safeLog(db, entry) {
  try { await writeLog(db, entry); return { logged: true, logError: null }; }
  catch (e) { return { logged: false, logError: String(e?.message || e).slice(0, 300) }; }
}


// ══════════════════════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify — EcomModa D1 Pattern v1.3.0
// ⚠️ كتلة الفلاتر (`buildLogFilterSQL` · `logParamsFrom` · `orderByClause`)
//    امتداد رسمي للكتلة دي موثّق في
//    `ecommoda-worker-builder/references/shared-functions.md` — مش تعديل محلي.
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
  // ─── §LOG-REG::guard (worker-builder Step 7-ج) ───
  // 🔴 مفيش رفض كتابة أبدًا — قيمة (tool,type) مش مسجّلة بتتكتب عادي +
  //    extra._unregistered، والتنبيه بيتبعت بعد الكتابة، مش قبلها ولا بدلها.
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

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
    extra ? JSON.stringify(extra) : null
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);  // بعد الكتابة، مش قبلها
}

/**
 * بنّاء شرط الفلترة الوحيد للتلات دوال تحت — مصدر واحد فمفيش endpoint
 * بيفلتر بشكل مختلف عن اللي جنبه (وده بالظبط اللي بيخلي التصدير ينزّل
 * غير المعروض). القوايم والقيمة المفردة الاتنين مقبولين (توافق رجعي).
 */
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). أي قيمة بره القايمة بترجع للافتراضي بدون خطأ.
// ⚠️ المفاتيح لازم تطابق `data-sort-key` في الواجهة **حرفيًا** — مفتاح مش في
//    القايمة بيرجع للافتراضي في صمت، فالعمود يبان إنه اترتّب وهو مااترتّبش.
const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', employee: 'employee',
  orderName: 'order_name', type: 'type',
  result: `json_extract(extra, '$.result')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات،
  //    والصف الواحد ممكن يظهر في صفحتين **أو مايظهرش خالص**.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

/**
 * صفحة واحدة من السجل — فلترة وترتيب وصفحات كلها server-side.
 * ⚠️ مش للتصدير — استخدم getLogsExport().
 */
async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

/** العدد الكلي المطابق للفلتر — بيتنادى بالتوازي مع getLogs و getLogsExport */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * كل السجل المطابق حتى LOG_EXPORT_MAX — للتصدير فقط.
 * ⚠️ الدالة دي **بتقص في السكوت** بطبيعتها، فالـ endpoint لازم يرجّع
 * `cap` و`total` و`truncated` كمان (Standards #30).
 * ⚠️ التصدير والعدّ **بيتجاهلوا الترتيب عن قصد** — مصدر باراميترات مختلف
 * بين النداءات = تصدير مش مطابق للشاشة.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/**
 * بيقرا فلاتر السجل من الـ query string — CSV للقوايم
 * (employees=ahmed,sara · types=completed,failed).
 * الاسم المفرد لسه مقبول للتوافق الرجعي.
 */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ══════════════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════════════

async function getAccessToken(env) {
  let res, text;
  try {
    res = await fetch(`https://${shopDomain(env)}/admin/oauth/access_token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
      }),
    });
    text = await res.text();
  } catch (e) {
    throw new Error(`OAuth: فشل الاتصال بشوبيفاي — ${e.message}`);
  }
  if (!res.ok) {
    throw new Error(`OAuth: شوبيفاي ردّت HTTP ${res.status} — ${text.slice(0, 180)}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`OAuth: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }
  if (!data.access_token) {
    throw new Error(`OAuth: مفيش access_token في الرد — راجع CLIENT_ID/CLIENT_SECRET`);
  }
  return data.access_token;
}

// آخر حالة رصيد مقروءة من شوبيفاي — بتتعرض في ?action=diag (Step 5A ⑪ ④)
let lastThrottleStatus = null;

// ─── §SHOPIFY::shopifyGQL ───
// 🔴 نسخة العقد الكاملة (`ecommoda-worker-builder` Step 5A ① ·
//    `shopify-graphql-helper` Step 1) — تُنسخ كما هي.
//    النسخة القديمة كانت `return res.json()` وبس: يعني 401 أو 429 أو 5xx من
//    شوبيفاي كانوا بيعدّوا **كأنهم رد سليم**، فـ `data?.draftOrder` بترجع
//    `undefined` والأداة تقول «Draft order not found» — رسالة كاذبة على
//    draft موجود. ده نفس العطل اللي خلّى أداة المرتجعات تسجّل ٤ أيام نجاح
//    على استرجاع مخزون ما حصلش.
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify') {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(
        `https://${shopDomain(env)}/admin/api/${API_VERSION}/graphql.json`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
          body:    JSON.stringify({ query, variables }),
        }
      );
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);

    // ④ التكلفة مرئية — الاقتراب من سقف النقط مابيبانش غير بانفجار دفعة كاملة
    lastThrottleStatus = data.extensions?.cost?.throttleStatus || lastThrottleStatus;
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

/**
 * فحص الميوتيشن — التلات فحوصات (Step 5A ②).
 * الفحص التالت هو اللي بيتنسى: `userErrors: []` معناها «مفيش اعتراض»،
 * مش «اتنفّذت».
 */
function assertMutation(data, path, payloadKey, opName) {
  const result = data?.data?.[path];
  const errs   = result?.userErrors || [];
  if (errs.length) {
    throw new Error(`${opName}: ${errs.map(e => `${(e.field || []).join('.')} ${e.message}`).join(' | ')}`);
  }
  if (payloadKey && !result?.[payloadKey]) {
    throw new Error(`${opName}: شوبيفاي ما أكدتش العملية (${payloadKey} فاضي)`);
  }
  return result;
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
/**
 * إلغاء الحجز عند الفشل — يسمح لإعادة محاولة Shopify بالنجاح.
 *
 * 🔴 **ممنوع ينادى بعد ما `draftOrderComplete` تنجح.** الأوردر وقتها بقى
 *    موجود فعلاً على شوبيفاي، ورفع الحجز بيخلّي إعادة محاولة شوبيفاي تعمل
 *    **أوردر COD تاني حقيقي** لنفس الـ draft. قبل v2.0.0 الدالة دي كانت
 *    بتتنادى في `catch` مهما كان مكان الفشل، فأي فشل D1 في الخطوة الأخيرة
 *    (`finishClaim`) كان بابًا مفتوحًا للتكرار.
 *    الحارس `orderCreated` في `processDraft` هو اللي بيقفل ده.
 */
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
 *
 * عقد النتيجة (`ecommoda-constants` §12 · worker-builder Step 5A ④):
 *   success  → الأوردر اتعمل واتأكد، والـ draft الأصلي اتحذف، والتاج اتشال
 *   warning  → الأوردر اتعمل **لكن** حاجة تكميلية فشلت (سعر مختلف ·
 *              tagsRemove · حذف الـ draft الأصلي · فشل كتابة السجل)
 *   error    → وصلنا لشوبيفاي/D1 وفشلنا — الحجز اترفع وشوبيفاي هتعيد المحاولة
 *   already  → الـ draft محجوز/متعالج خلاص (إعادة إرسال الويبهوك)
 *   rejected → اتوقف قبل أي محاولة (تاج الـ clone)
 *
 * ⚠️ `warning` **ممنوع تتحسب نجاح** — الأوردر موجود بس فيه حاجة محتاجة
 *    مراجعة يدوية، والرسالة بتقول إيه بالظبط.
 *
 * @returns {object} { ok, status, reason?, order?, logged }
 */
async function processDraft(env, rawDraftId, { source, eventId = null }) {
  const draftGid = toGid(rawDraftId, 'DraftOrder');

  // 🔴 كل تحقق ممكن يتعمل — يتعمل قبل أول فعل لا رجعة فيه (Step 5A ⑩ ①).
  //    متغيّر ناقص لازم يوقف العملية **قبل** الحجز، مش بعد إنشاء الأوردر.
  try {
    assertEnv(env, 'shopify');
  } catch (e) {
    const lg = await safeLog(env.DB, {
      tool: TOOL_NAME, type: LOG_TYPES.FAILED,
      orderId: draftGid,
      notes:   String(e.message).slice(0, 500),
      extra:   { source, eventId, result: RESULT.ERROR, stage: STAGE.LOOKUP },
    });
    return { ok: false, status: RESULT.ERROR, error: e.message, draftOrderId: draftGid, ...lg };
  }

  // 1) الحجز الذرّي — يمنع المعالجة المزدوجة من إعادة إرسال الويبهوك
  const claimed = await claimDraft(env.DB, draftGid, eventId, source);
  if (!claimed) {
    // 🔴 `already` مش فشل ومش تحذير — عدّاد مستقل ولون محايد (constants §12).
    //    دي أكتر نتيجة متكررة في الأدوات اللي بتستقبل ويبهوك بإعادة إرسال.
    const lg = await safeLog(env.DB, {
      tool: TOOL_NAME, type: LOG_TYPES.SKIPPED,
      orderId: draftGid,
      notes:   'الـ draft ده اتعالج خلاص قبل كده (إعادة إرسال الويبهوك) — مفيش حاجة مطلوبة',
      extra:   { source, eventId, result: RESULT.ALREADY, stage: STAGE.LOOKUP },
    });
    return { ok: true, status: RESULT.ALREADY, skipped: true, reason: 'already_processed',
             draftOrderId: draftGid, ...lg };
  }

  // 🔴 حارس نقطة اللا رجعة — أول ما الأوردر يتعمل بيبقى true، والحجز
  //    **مايترفعش** بعد كده مهما حصل. ده اللي بيمنع أوردرين لنفس الـ draft.
  let orderCreated = false;
  let clonedDraftId = null;

  try {
    // 2) توكن
    const token = await getAccessToken(env);

    // 3) قراءة الـ Draft الأصلي
    const draftRes = await shopifyGQL(env, token, DRAFT_ORDER_QUERY, { id: draftGid }, 'readDraft');
    const draft = draftRes.data?.draftOrder;
    if (!draft) throw new Error('Draft order not found: ' + draftGid);

    // 4) حارس الحلقة اللانهائية — drafts من stylebox-shopify-order-transfer-worker
    if (normalizeTags(draft.tags).includes(CLONE_TAG)) {
      await finishClaim(env.DB, draftGid, 'skipped', null, null);
      const lg = await safeLog(env.DB, {
        tool: TOOL_NAME, type: LOG_TYPES.SKIPPED,
        orderId: draftGid, orderName: draft.name,
        notes:   `draft من Worker تاني (${CLONE_TAG}) — اتجاهل عمدًا لمنع الحلقة اللانهائية`,
        extra:   { source, eventId, result: RESULT.REJECTED, stage: STAGE.LOOKUP },
      });
      return { ok: true, status: RESULT.REJECTED, skipped: true, reason: 'worker_clone',
               draftOrderId: draftGid, ...lg };
    }

    // 5) إنشاء الـ Draft المستنسخ (+ CLONE_TAG + MANUAL_TAG)
    const { input, discountInfo } = buildDraftInput(draft);
    const createRes = await shopifyGQL(env, token, DRAFT_ORDER_CREATE_MUTATION, { input }, 'draftOrderCreate');
    const created   = assertMutation(createRes, 'draftOrderCreate', 'draftOrder', 'draftOrderCreate');
    const newDraft  = created.draftOrder;
    clonedDraftId   = newDraft.id;

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
    //    ⚠️ لو فشل هنا، الـ clone اللي اتعمل في (5) لازم يتحذف — وإلا بيفضل
    //    draft يتيم بتاج `_worker_clone` في الأدمن للأبد.
    let order;
    try {
      const completeRes = await shopifyGQL(env, token, DRAFT_ORDER_COMPLETE_MUTATION, {
        id:               newDraft.id,
        paymentPending:   true,
        paymentGatewayId: COD_GATEWAY_ID,
      }, 'draftOrderComplete');
      const completed = assertMutation(completeRes, 'draftOrderComplete', 'draftOrder', 'draftOrderComplete');
      order = completed.draftOrder?.order;
      if (!order?.id) throw new Error('draftOrderComplete: شوبيفاي ما رجّعتش أوردر');
    } catch (e) {
      await deleteDraft(env, token, newDraft.id).catch(() => {});
      throw e;
    }

    // ✅ من هنا الأوردر موجود فعلاً على شوبيفاي — لا رجعة.
    orderCreated = true;

    const warnings = [];

    // 7) tagsRemove — يشيل CLONE_TAG من الأوردر الحقيقي (MANUAL_TAG يفضل)
    //    فعل **تكميلي**: فشله warning مش error (Step 5A ⑩ ②).
    let tagsRemoveWarning = null;
    try {
      const tagsRes = await shopifyGQL(env, token, TAGS_REMOVE_MUTATION, {
        id:   order.id,
        tags: [CLONE_TAG],
      }, 'tagsRemove');
      assertMutation(tagsRes, 'tagsRemove', 'node', 'tagsRemove');
    } catch (e) {
      tagsRemoveWarning = String(e.message || e).slice(0, 300);
      warnings.push(`الأوردر اتعمل، لكن شيل تاج ${CLONE_TAG} منه فشل (${tagsRemoveWarning}) — شيله يدويًا من الأوردر`);
    }

    // 8) حذف الـ Draft الأصلي — فعل تكميلي برضه
    let deleteWarning = null;
    try {
      await deleteDraft(env, token, draftGid);
    } catch (e) {
      deleteWarning = String(e.message || e).slice(0, 300);
      warnings.push(`الأوردر اتعمل، لكن حذف الـ Draft الأصلي ${draft.name} فشل (${deleteWarning}) — امسحه يدويًا وإلا الموظف هيفتكره لسه محتاج تحويل`);
    }

    // 8b) حارس السعر = تحذير برضه — الأوردر موجود بسعر مختلف عن اللي الموظف شافه
    if (priceMismatch) {
      warnings.push(`⚠️ إجمالي الأوردر (${priceMismatch.cloneTotal}) مختلف عن الـ Draft الأصلي (${priceMismatch.originalTotal}) بفرق ${priceMismatch.diff} — راجع الأوردر`);
    }

    const status = warnings.length ? RESULT.WARNING : RESULT.SUCCESS;

    // 9) إنهاء الحجز + اللوج
    //    ⚠️ `finishClaim` في try/catch: فشلها مايرفعش الحجز ومايبوّظ الرد —
    //    الأوردر اتعمل فعلاً، والصف اللي في الجدول لسه بيمنع التكرار.
    try {
      await finishClaim(env.DB, draftGid, status === RESULT.SUCCESS ? 'completed' : 'completed_with_warnings',
                        order.legacyResourceId || order.id, order.name);
    } catch (e) {
      warnings.push(`تحديث صف الحجز في D1 فشل (${String(e.message || e).slice(0, 160)})`);
    }

    const lg = await safeLog(env.DB, {
      tool: TOOL_NAME, type: LOG_TYPES.COMPLETED,
      orderId:   order.legacyResourceId || order.id,
      orderName: order.name,
      notes:     `draft ${draft.name} → order ${order.name}` +
                 (discountInfo.converted ? ` | discount ${discountInfo.codeDiscount} converted` : '') +
                 (warnings.length ? ` | ⚠️ ${warnings.join(' ⁄ ')}` : ''),
      valueBefore: Number.isFinite(origTotal)  ? String(origTotal)  : null,
      valueAfter:  Number.isFinite(cloneTotal) ? String(cloneTotal) : null,
      extra: {
        source, eventId,
        result: status, stage: STAGE.WRITE,
        originalDraftId:   draftGid,
        originalDraftName: draft.name,
        clonedDraftId:     newDraft.id,
        financialStatus:   order.displayFinancialStatus,
        lineItemCount:     draft.lineItems?.nodes?.length ?? 0,
        discountInfo,
        priceMismatch,
        tagsRemoveWarning,
        deleteWarning,
        warnings,
      },
    });

    return {
      ok: true,
      status,
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
      warnings,
      ...lg,
    };

  } catch (err) {
    // 🔴 الحجز بيترفع **بس** لو الأوردر ما اتعملش — عشان إعادة محاولة شوبيفاي
    //    تنجح. لو الأوردر اتعمل خلاص، رفع الحجز = أوردر COD تاني حقيقي.
    if (!orderCreated) {
      await releaseClaim(env.DB, draftGid);
    } else {
      await finishClaim(env.DB, draftGid, 'completed_unconfirmed', null, null).catch(() => {});
    }

    const lg = await safeLog(env.DB, {
      tool: TOOL_NAME, type: LOG_TYPES.FAILED,
      orderId: draftGid,
      notes:   String(err.message || err).slice(0, 500),
      extra:   {
        source, eventId,
        result: RESULT.ERROR,
        stage:  orderCreated ? STAGE.WRITE : STAGE.LOOKUP,
        orderCreated,
        clonedDraftId,
        // ⚠️ الحالة الخطيرة: الأوردر اتعمل والباقي فشل — الحجز **ما اترفعش**
        //    عن قصد، فشوبيفاي مش هتعيد المحاولة والـ draft محتاج مراجعة يدوية.
        needsManualReview: orderCreated,
      },
    });
    return { ok: false, status: RESULT.ERROR, error: String(err.message || err),
             draftOrderId: draftGid, orderCreated, ...lg };
  }
}

// ─── §CONVERT::deleteDraft ───
/** حذف draft — بيستخدمه مسار النجاح (الأصلي) ومسار الفشل (الـ clone اليتيم) */
async function deleteDraft(env, token, draftGid) {
  const res = await shopifyGQL(env, token, DRAFT_ORDER_DELETE_MUTATION, {
    input: { id: draftGid },
  }, 'draftOrderDelete');
  return assertMutation(res, 'draftOrderDelete', 'deletedId', 'draftOrderDelete');
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
      const shopHdr   = request.headers.get('X-Shopify-Shop-Domain');

      const secret = env.CLIENT_SECRET;
      const valid  = await verifyShopifyHmac(secret, rawBody, hmacHdr);

      if (!valid) {
        // ⚠️ `failed` لأن `hmac_failed` مش مسجّلة لهذه الأداة في constants §7
        //    (Rule 7 — القيمة تتسجّل قبل الاستخدام مش بعده). الفرق عن فشل
        //    التحويل صريح في `extra.result`/`extra.stage`، مش مخبّأ في notes.
        ctx.waitUntil(safeLog(env.DB, {
          tool: TOOL_NAME, type: LOG_TYPES.FAILED,
          notes: 'فشل تحقق HMAC — مفتاح توقيع غلط أو جسم الطلب متلاعب فيه',
          extra: {
            source: 'webhook', eventId, topic,
            result: RESULT.ERROR, stage: STAGE.LOOKUP,
            failureKind:       'hmac',
            hmacHeaderPresent: !!hmacHdr,
            bodyBytes:         rawBody.length,
            secretPresent:     !!env.CLIENT_SECRET,
            envKeys:           Object.keys(env),   // أسماء الـ bindings — مش قيمها
          },
        }));
        return new Response('Invalid signature', { status: 401 });
      }

      // 🔴 التوقيع صحيح **مش** معناه إن ده الويبهوك المتوقّع. التطبيق بيوقّع
      //    كل ويبهوكاته بنفس الـ CLIENT_SECRET، فأي topic تاني (ORDERS_CREATE
      //    مثلاً) كان بيعدّي هنا و`payload.id` يتفسّر كـ DraftOrder ID.
      if (topic && topic !== WEBHOOK_TOPIC) {
        ctx.waitUntil(safeLog(env.DB, {
          tool: TOOL_NAME, type: LOG_TYPES.SKIPPED,
          notes: `topic غير متوقّع: ${topic} — المتوقّع ${WEBHOOK_TOPIC}. الأداة دي بتعالج إنشاء Draft Orders بس`,
          extra: { source: 'webhook', eventId, topic, result: RESULT.REJECTED, stage: STAGE.LOOKUP },
        }));
        return json({ ok: true, skipped: true, reason: 'unexpected_topic' }, 200, request);
      }

      // 🔴 ونفس المنطق على المتجر — ويبهوك من متجر تاني مالوش أي شغل هنا.
      const expectedShop = shopDomain(env);
      if (shopHdr && expectedShop && shopHdr !== expectedShop) {
        ctx.waitUntil(safeLog(env.DB, {
          tool: TOOL_NAME, type: LOG_TYPES.SKIPPED,
          notes: `متجر غير متوقّع: ${shopHdr} — المتوقّع ${expectedShop}`,
          extra: { source: 'webhook', eventId, topic, shopHdr,
                   result: RESULT.REJECTED, stage: STAGE.LOOKUP },
        }));
        return json({ ok: true, skipped: true, reason: 'unexpected_shop' }, 200, request);
      }

      let payload;
      try { payload = JSON.parse(rawBody); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400, request); }

      const draftId = payload.admin_graphql_api_id || payload.id;
      if (!draftId) return json({ ok: false, error: 'No draft id in payload' }, 400, request);

      // فلترة مبكرة من الـ payload نفسه — توفير استدعاء كامل لـ Shopify
      if (normalizeTags(payload.tags).includes(CLONE_TAG)) {
        ctx.waitUntil(safeLog(env.DB, {
          tool: TOOL_NAME, type: LOG_TYPES.SKIPPED,
          orderId: toGid(draftId, 'DraftOrder'),
          orderName: payload.name || null,
          notes: `draft من Worker تاني (${CLONE_TAG} في الـ payload) — اتجاهل عمدًا لمنع الحلقة اللانهائية`,
          extra: { source: 'webhook', eventId, topic, result: RESULT.REJECTED, stage: STAGE.LOOKUP },
        }));
        return json({ ok: true, skipped: true, reason: 'worker_clone' }, 200, request);
      }

      // 200 فوري + معالجة في الخلفية
      ctx.waitUntil(processDraft(env, draftId, { source: 'webhook', eventId }));
      return json({ ok: true, accepted: true }, 200, request);
    }

    // ─── §AUTH — كل ما بعده يتطلب WORKER_SECRET ───────────────────────
    // 🔴 حارس السر الغايب — **قبل** فحص الـ auth بالظبط (Step 8).
    //    من غيره القالب بينتج السلسلة الحرفية "Bearer undefined"، يعني أي
    //    طلب معاه الهيدر ده **بيعدّي**. والحالة مش نظرية: سر اتضاف من غير
    //    Promote · سر اتمسح بالغلط · Worker شبح باسم مختلف — كلهم بيدّوا
    //    `env.WORKER_SECRET === undefined`. على Worker بينشئ أوردرات COD
    //    حقيقية، ده معناه الحماية **مرفوعة** مش «كل حاجة 401».
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim()) {
      return json({
        ok: false,
        error: 'WORKER_SECRET غير مضبوط على الـ Worker — ضيفه في الداشبورد ثم Promote',
        step: 'env',
      }, 500, request);
    }

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

        const lg = await safeLog(env.DB, {
          tool: TOOL_NAME, type: LOG_TYPES.LOGIN, employee: username,
          notes: `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName, ...lg }, 200, request);
      }

      // ── log_logout — GET ──
      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        let lg = { logged: true, logError: null };
        if (username) {
          lg = await safeLog(env.DB, {
            tool: TOOL_NAME, type: LOG_TYPES.LOGOUT, employee: username,
            notes: `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true, ...lg }, 200, request);
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
        // 🔴 حدود «النهار» بتوقيت القاهرة **محسوبة** بـ Intl (constants §13).
        //    القديم كان `setUTCHours(-3, 0, 0, 0)` — إزاحة ثابتة كانت بتغلط
        //    بساعة من 29-10-2026 فعدّاد النهار يبدأ الساعة ١ بدل ١٢.
        const { start: todayStart } = cairoDayBoundsUTC(cairoDate());

        const counts = await env.DB.prepare(`
          SELECT type, COUNT(*) as c FROM logs
          WHERE tool = ? AND timestamp >= ? AND type IN ('completed','skipped','failed')
          GROUP BY type
        `).bind(TOOL_NAME, todayStart).all();

        // عدّاد مستقل للنتايج — `already` ممنوع تتحسب فشل، و`warning` ممنوع
        // تتحسب نجاح (constants §12).
        const resultCounts = await env.DB.prepare(`
          SELECT json_extract(extra,'$.result') AS r, COUNT(*) AS c FROM logs
          WHERE tool = ? AND timestamp >= ? AND type IN ('completed','skipped','failed')
          GROUP BY r
        `).bind(TOOL_NAME, todayStart).all();

        const lastEntry = await env.DB.prepare(`
          SELECT timestamp, type, order_name, order_id, notes, extra FROM logs
          WHERE tool = ? AND type IN ('completed','skipped','failed')
          ORDER BY timestamp DESC LIMIT 1
        `).bind(TOOL_NAME).first();

        const statMap = { completed: 0, skipped: 0, failed: 0 };
        for (const row of counts.results || []) statMap[row.type] = row.c;

        const resultMap = { success: 0, warning: 0, error: 0, rejected: 0, already: 0, unknown: 0 };
        for (const row of resultCounts.results || []) {
          const k = row.r && Object.prototype.hasOwnProperty.call(resultMap, row.r) ? row.r : 'unknown';
          resultMap[k] += row.c;
        }

        return json({
          ok: true,
          today: statMap,
          todayResults: resultMap,
          cairoDate: cairoDate(),
          lastEntry: lastEntry || null,
        }, 200, request);
      }

      // ─── §DIAG — فحص ذاتي بدون أي كتابة (Step 5A ⑨) ────────────────
      // ⚠️ ممنوع يعرض قيمة أي سر — الأسماء والأطوال بس.
      if (action === 'diag') {
        const checks = [];
        const push = (ok, label, detail) => checks.push({ ok, label, detail: String(detail ?? '') });

        // ① المتغيّرات والأسرار — الأطوال بتكشف المسافة المخفية في القيمة
        for (const key of ['SHOP_DOMAIN', 'WORKER_SECRET', 'CLIENT_ID', 'CLIENT_SECRET']) {
          const v = env[key];
          const present = typeof v === 'string' && v.trim().length > 0;
          const trimmedDiff = typeof v === 'string' && v !== v.trim();
          push(present && !trimmedDiff, `env.${key}`,
               present ? `موجود · الطول ${v.length}${trimmedDiff ? ' · ⚠️ فيه مسافة زيادة في أول/آخر القيمة' : ''}`
                       : 'غايب — ضيفه في الداشبورد ثم Promote');
        }
        push(!!env.DB, 'binding DB', env.DB ? 'موجود' : 'غايب — راجع [[d1_databases]] في wrangler.toml');

        // ② D1 — قراءة فقط
        try {
          const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
          push(true, 'D1 · logs', `${r?.n ?? 0} صف لهذه الأداة`);
        } catch (e) { push(false, 'D1 · logs', String(e.message || e)); }

        try {
          const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM manual_order_processed').first();
          push(true, 'D1 · manual_order_processed', `${r?.n ?? 0} صف حجز`);
        } catch (e) { push(false, 'D1 · manual_order_processed', String(e.message || e)); }

        // ③ OAuth + صلاحيات التطبيق
        let token = null;
        try { token = await getAccessToken(env); push(true, 'Shopify OAuth', 'توكن اتجاب بنجاح'); }
        catch (e) { push(false, 'Shopify OAuth', String(e.message || e)); }

        if (token) {
          try {
            const d = await shopifyGQL(env, token,
              `query { currentAppInstallation { accessScopes { handle } } }`, {}, 'diagScopes');
            const scopes = (d.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
            const needed = ['write_draft_orders', 'write_orders', 'read_orders'];
            const missing = needed.filter(s => !scopes.includes(s));
            push(missing.length === 0, 'صلاحيات التطبيق',
                 missing.length ? `ناقصة: ${missing.join(', ')} · الموجود: ${scopes.join(', ')}`
                                : `كل الصلاحيات المطلوبة موجودة (${scopes.length} scope)`);
            // ℹ️ معلومة — لا نجاح ولا فشل
            checks.push({ ok: true, label: 'ℹ️ payment_gateways scope',
              detail: scopes.includes('read_payment_gateways')
                ? 'موجود — لكن COD_GATEWAY_ID لسه ثابت في الكود عن قصد'
                : 'غير متاح للتطبيق — وعشان كده COD_GATEWAY_ID ثابت في الكود (constants §1)' });
          } catch (e) { push(false, 'صلاحيات التطبيق', String(e.message || e)); }
        }

        // ④ تكلفة الاستعلام — الاقتراب من السقف مابيبانش غير بانفجار دفعة
        push(true, 'throttleStatus', lastThrottleStatus
          ? `available ${lastThrottleStatus.currentlyAvailable}/${lastThrottleStatus.maximumAvailable} · restore ${lastThrottleStatus.restoreRate}/s`
          : 'لسه مفيش استعلام في هذا الـ isolate');

        // ⑤ التوقيت المحسوب — يثبت إن مفيش إزاحة ثابتة
        const nowOff = cairoOffsetMinutes(new Date());
        push(true, 'توقيت القاهرة (محسوب)',
             `${cairoDate()} · الإزاحة الحالية ${nowOff} دقيقة (${nowOff / 60} ساعة) — محسوبة بـ Intl مش ثابتة`);

        push(true, 'Origin', request.headers.get('Origin') || '(مفيش)');
        push(true, 'الويبهوك', `POST /webhook · Topic المقبول: ${WEBHOOK_TOPIC} · التوقيع بـ CLIENT_SECRET`);

        return json({
          ok: checks.every(c => c.ok), tool: TOOL_NAME, version: VERSION, checks,
        }, 200, request);
      }

      // ── get_config — الواجهة بتقارن نسختها بالحد الأدنى عندها ──
      if (action === 'get_config') {
        return json({
          ok: true, tool: TOOL_NAME, version: VERSION,
          apiVersion: API_VERSION,
          logExportMax: LOG_EXPORT_MAX,
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
      // التلاتة بيقروا الفلاتر من **مصدر واحد** (`logParamsFrom`) — فمفيش
      // endpoint بيفلتر بشكل مختلف عن اللي جنبه، وده اللي كان بيخلي
      // التصدير ينزّل غير المعروض.
      if (request.method === 'GET' && action === 'get_logs') {
        const p = logParamsFrom(url, TOOL_NAME);
        // 🔴 parseInt('abc') → NaN · Math.min(NaN,100) → NaN → بيوصل لـ D1 كـ
        //    bind ويرجّع خطأ غامض. الحراسة إلزامية، مش تجميل.
        const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
        const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
        const limit  = Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

        const sortBy  = url.searchParams.get('sortBy');
        const sortDir = url.searchParams.get('sortDir');
        const entries = await getLogs(env.DB, { ...p, limit, offset, sortBy, sortDir });
        return json({ ok: true, entries }, 200, request);
      }

      if (request.method === 'GET' && action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, logParamsFrom(url, TOOL_NAME));
        return json({ ok: true, total }, 200, request);
      }

      if (request.method === 'GET' && action === 'get_logs_export') {
        // 🔴 الصفوف **والحقيقة** مع بعض (Standards #30) — التصدير بيقص عند
        //    السقف في السكوت، فالواجهة لازم تعرف إن الملف اتقص.
        const p = logParamsFrom(url, TOOL_NAME);
        const [entries, total] = await Promise.all([
          getLogsExport(env.DB, p),
          getLogsCount(env.DB, p),     // العدّ الحقيقي بنفس الفلاتر بالظبط
        ]);
        return json({ ok: true, entries, cap: LOG_EXPORT_MAX, total,
                      truncated: total > LOG_EXPORT_MAX }, 200, request);
      }

      return json({ ok: false, error: 'Not found' }, 404, request);

    } catch (err) {
      await safeLog(env.DB, {
        tool: TOOL_NAME, type: LOG_TYPES.FAILED,
        notes: 'handler: ' + String(err.message || err).slice(0, 480),
        extra: { source: 'handler', action, result: RESULT.ERROR, stage: STAGE.LOOKUP },
      });
      return json({ ok: false, error: String(err.message || err) }, 500, request);
    }
  },
};
