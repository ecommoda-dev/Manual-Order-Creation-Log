<div dir="rtl" style="text-align: right;">

# تحويل الأوردر اليدوي لـ COD (`Manual-Order-Creation-Log`)

![version](https://img.shields.io/badge/version-v2.0.0-blue)

**بتعمل إيه:** بتحوّل الـ Draft Order اللي الموظف بيعمله يدوي من Shopify Admin
لأوردر COD حقيقي — clone + `draftOrderComplete` بـ COD gateway ثابت، وبعدها
حذف الـ Draft الأصلي. السبب: الموظف مالوش scope يختار COD وقت التكميل اليدوي،
والتكميل من غيره بيكسر التوافق مع Treasury / COD Payment Center.
**مين بيستخدمها:** بتشتغل لوحدها على ويبهوك · الواجهة للمراقبة والسجل بس
**الإصدار:** Worker `v2.0.0` · الواجهة `v2.0.0`   ← الاتنين مستقلين، طبيعي يختلفوا
(اتساووا هنا لأن التسليم واحد غيّر الاتنين — مش قاعدة)

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Manual-Order-Creation-Log/
الـ Worker : https://manual-order-creation-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: manual-order-creation-worker
```

## نقطة الدخول الحقيقية — مش الواجهة

```
POST /webhook   ← Shopify Webhook Subscription · Topic: DRAFT_ORDERS_CREATE
```

🔴 **الراوت ده قبل بوابة `WORKER_SECRET` عمدًا** — شوبيفاي مابتبعتش
`Authorization`. أي إعادة ترتيب تحط البوابة قبله = كل تسليمة بترجع 401 والأداة
بتقف بصمت. التحقق هنا **بـ `CLIENT_SECRET`** مش `SHOPIFY_WEBHOOK_SECRET`،
لأن الويبهوك مسجَّل بـ GraphQL عن طريق Webhook Control Center
(`ecommoda-constants` §6).

**الواجهة مالهاش أي زرار تنفيذ** — مراقبة وسجل بس. يعني مفيش "خط أساس بزرار
تحديث" بالمعنى المعتاد؛ الإثبات الحقيقي إن الأداة شغّالة هو صفوف D1 الجديدة.

## الـ Endpoints

| `?action=` | بيعمل إيه |
|---|---|
| `health` (أو فاضي) | اسم الأداة والإصدار و`apiVersion` |
| `get_config` | نسخة الـ Worker — الواجهة بتقارنها بـ `MIN_WORKER_VERSION` عندها |
| `diag` | فحص ذاتي بدون كتابة: المتغيّرات وأطوالها · D1 · OAuth · صلاحيات التطبيق · `throttleStatus` · التوقيت المحسوب. **صفر قيمة سر** |
| `get_monitor_stats` | عدّادات النهار (completed/skipped/failed) + **عدّاد مستقل لكل `extra.result`** + آخر عملية |
| `check_employee` · `register_pin` · `verify_employee` · `log_logout` · `get_employees` | Universal D1 Auth |
| `get_logs` · `get_logs_count` · `get_logs_export` | السجل |

## D1

```
tool  : manual_order_creation
type  : completed · skipped · failed · login · logout
```

> الخمسة مسجّلين في `ecommoda-constants` §7 — اتأكد بـ grep قبل أي قيمة جديدة.

**جدول إضافي غير `logs`/`employees` المشتركين:**

```
manual_order_processed
  (draft_order_id PK, event_id, source, status, order_id, order_name,
   created_at, completed_at)
```

الغرض: **حجز ذرّي** (`INSERT OR IGNORE`) قبل معالجة أي draft — بيمنع إعادة
إرسال الويبهوك من إنشاء أوردرين لنفس الـ draft. الفشل بيعمل `releaseClaim`
(حذف الصف) عشان إعادة محاولة شوبيفاي تنجح. **الجدول ده في نفس قاعدة
`ecommoda-dev-logs`** — تاني أداة في الستاك بتعمل كده بعد Webhook Control Center.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — اتأكد من لقطة شاشة Settings → Variables يوم 12-09-2026،
> ومطابق لكل `env.*` في الكود بالظبط (مفيش زيادة ولا نقصان).

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET
Vars     : SHOP_DOMAIN = 6c7e1a-53.myshopify.com   ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي) — مقترح تضييقها لـ index.js + wrangler.toml (§13-ب)
```

🔴 **بعد الربط بـ git، الداشبورد مابقاش مصدر حقيقة للـ vars** — أي تعديل يدوي
على `SHOP_DOMAIN` هناك بيرجع لقيمة `wrangler.toml` عند أول build، والأداة
مابتشتكيش (`shopDomain()` فيها `|| ''`). أي تغيير = commit على `wrangler.toml`.

## CORS

`ALLOWED_ORIGINS` صارمة (`https://ecommoda-dev.github.io` بس) — Option B، لأن
الأداة **مالية**: بتنشئ أوردرات COD حقيقية. مفيش wildcard هنا بأي حال.

## خط الأساس قبل النقل

> من D1 يوم 12-09-2026 (آخر صف كان الساعة 15:10Z — الأداة شغّالة فعليًا وقت النقل).

```
skipped   450   (21-08-2026 → 12-09-2026)
completed 234   (21-08-2026 → 12-09-2026)
failed     11   (21-08-2026 بس — كلها يوم التشغيل الأول)
login       9
logout      0   ← الكود بيكتبها، بس محدش عمل خروج صريح (§7.0 — مش دليل هجر)
```

استعلام إعادة القياس بعد النقل (سطر واحد، D1 Console):

```sql
SELECT type, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'manual_order_creation' GROUP BY type ORDER BY n DESC;
```

**معيار النجاح:** `completed` و`skipped` بيزيدوا بعد النقل، و`failed` مابيقفزش.

🔴 **الاستعلام اللي فوق بيقيس «المحاولات» مش «الكتابة الفعلية».** من `index.js`
v2.0.0 كل صف بياخد `extra.result` (`ecommoda-constants` §12)، فأي قياس حقيقي
لازم يفلتر عليه — `completed` لوحدها بقت تشمل `warning` (أوردر اتعمل بسعر
مختلف أو الـ Draft الأصلي ما اتحذفش):

```sql
SELECT type, json_extract(extra,'$.result') AS result, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'manual_order_creation' GROUP BY type, result ORDER BY n DESC;
```

⚠️ **الصفوف الأقدم من 13-09-2026 `result` بتاعتها `NULL`** — ده متوقع، ومعناه
«مش عارفين» مش «نجاح». أي تقرير بيقارن قبل/بعد لازم يفصلهم.
و⚠️ **`already` ممنوع تتعدّ فشل** (إعادة إرسال الويبهوك — مفيش حاجة كانت مطلوبة).

## فخاخ الأداة دي

- **`CLONE_TAG = '_worker_clone'` مشتركة مع `stylebox-shopify-order-transfer-worker`.**
  التاج ده هو الحاجة الوحيدة اللي بتمنع حلقة لانهائية بين الأداتين. أي تغيير
  هنا **لازم** ينزل هناك في نفس اللحظة — وإلا الحماية بتتكسر بصمت والأداتين
  يفضلوا يولّدوا drafts لبعض.
- **`MANUAL_TAG = 'Manual_Order'` بيفضل على الأوردر النهائي عمدًا** (تمييز
  المصدر، زي `StyleBox`). اللي بيتشال بعد التكميل هو `CLONE_TAG` بس.
- **`COD_GATEWAY_ID` ثابت في الكود عمدًا** — scope الـ `payment_gateways` مش
  متاح للتطبيق، فقراءته برمجيًا مستحيلة. القيمة في `ecommoda-constants` §1.
- **أكواد الخصم مابتظهرش في `appliedDiscount`** — بتتحسب بالطرح وبتتحوّل لخصم
  ثابت على مستوى الأوردر (تفادي استهلاك استخدام إضافي من الكود). التفاصيل
  الكاملة بتتكتب في D1 → `extra.discountInfo` **مش** على الأوردر (قرار v1.1.0).
- **`failed` عندها معنيين في نفس القيمة:** فشل تحويل draft، **و** فشل تحقق
  HMAC. من v2.0.0 الفرق بقى صريح في **`extra.result` + `extra.failureKind`**
  (`'hmac'`) مش مخبّأ في `notes`. القيمة `hmac_failed` مستنية تسجيل في
  `ecommoda-constants` §7 (شوف «معلّقة» فوق).
- 🔴 **`needsManualReview: true` في `extra`** = الأوردر اتعمل فعلاً وبعدين حاجة
  فشلت، والحجز **ما اترفعش** عن قصد — يعني شوبيفاي **مش** هتعيد المحاولة والـ
  draft محتاج مراجعة يدوية. الصف ده الأهم في السجل كله: التكرار أخطر من المراجعة.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (1.0.html) محفوظة في commit: fe27b76
git show fe27b76:1.0.html
```

## بصمة المهارات

> الصيغة والقواعد والمهارات اللي بتدخل الجدول → `ecommoda-skill-versioning`
> Step 4. مهارة مالهاش رقم إصدار مابتدخلش الجدول.

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.1.0 |
| ecommoda-html-builder | v7.1.0 |
| ecommoda-constants | v2.2.0 |
| shopify-graphql-helper | v2.1.0 |
| shopify-webhook-helper | (بلا إصدار — مش في نظام الإصدارات) |

آخر مطابقة: 13-09-2026 · `index.js` v2.0.0 · `index.html` v2.0.0

> ✅ **المطابقة دي اتعملت فعليًا** (مراجعة كاملة 13-09-2026)، مش نسخ أرقام.
> قبلها الجدول كان بيقول نفس الإصدارات دي والكود كان **مخالف لـ ٢٥ بند** فيها —
> وده أسوأ من جدول قديم: بصمة بتكدب بتخلّي أي جرد جاي يعدّي على الأداة.

✅ **المعلّقات اتقفلت كلها في v2.0.0** — كانت مؤجَّلة بوعي عشان النقل يفضل
بايت ببايت، والأنبوب أثبت إنه شغّال فاتقفلت:

- ✅ **`ecommoda-constants` §13 — التوقيت.** بقى محسوب بـ `Intl` في الملفين
  بنفس الدوال بالحرف. **الأداة مش محتاجة أي تدخل يوم 29-10-2026.**
  الجرد بيرجّع فاضي: `grep -rn "CAIRO_OFFSET\|3 \* 3600 \* 1000\|+ 3 \* 60 \* 60" .`
- ✅ **`ecommoda-constants` §5b — `ADMIN_WORKER_URL`.** اتشال **خالص** مش اتحوّل
  لـ constant — الأداة **مابتنادي الأدمن بانل خالص** (نفس سابقة
  `Stylebox-Price-Sync`: constant مش مستخدم = كود ميت، مش احتياط). و`WORKER_URL`
  بقى constant في `§CONFIG` بدل حقل إعدادات.
- ✅ **`extra.result` / `extra.stage`.** كل صف بياخد الاتنين بالمفردات الرسمية
  (§12). الصفوف **الأقدم من 13-09-2026** لسه بلا `result` — والواجهة بتعرضها
  **«—» مش «✓»** عن قصد، لأن إحنا فعليًا مش عارفين إن الفعل تم وقتها.
- ✅ **`?action=diag`** موجود + زرار 🩺 في الإعدادات، ومعاه `?action=get_config`
  وحارس نسخة الـ Worker في الهيدر (`MIN_WORKER_VERSION = 2.0.0`).

🔴 **معلّقة (بند واحد متبقّي):**
- **`failed` لسه ليها معنيين** — فشل تحويل **و** فشل HMAC. القيمة `hmac_failed`
  مستخدمة في `duplicate_order_check` و`stylebox_price_sync`، بس **مش مسجّلة
  لهذه الأداة** في `ecommoda-constants` §7، والقاعدة (Rule 7) إن القيمة تتسجّل
  **قبل** أول استخدام مش بعده. فالفصل اتعمل دلوقتي في `extra.result` +
  `extra.failureKind` بدل ما يكون مخبّأ في `notes`.
  **الخطوة الجاية:** تسجيل `hmac_failed` في §7 (تعديل على المهارة بـ bump وبند
  CHANGELOG مصنّف) **ثم** تحويل السطر في الكود — التسلسل ده مش شكلي: العكس
  بيولّد صفوف يتيمة تحت قيمة مش في الجدول.


## مسائل مفتوحة

- ✅ **سطر البصمة `// skills:` بقى في `index.js`** (اتقفل 13-09-2026 — التطابق
  بايت ببايت مابقاش مطلوب بعد ما الأنبوب أثبت إنه شغّال). النص الأصلي للبند:
- ~~**`index.js` لسه من غير سطر البصمة `// skills:`**~~ — متأجّل عن قصد عشان الملف
  يفضل مطابق بايت ببايت لنسخة كلاودفلير في أول commit. السطر ده مرشّح ليكون
  **commit تشغيل أول build** بعد الربط (§هـ) — وده بيخدم غرضين في نفس الوقت:
  بيشغّل البناء، وبيثبت إن الـ watch paths بتسمح لـ `index.js` ينشر (§13-ب
  الاختبار الإيجابي). البصمة الكاملة موجودة في `CLAUDE.md` ده أصلاً، وهو
  **مصدر الحقيقة الوحيد** لها (esbuild بيشيل التعليقات من الكود المنشور).
- **`draft_cod_complete` — بيانات يتيمة في D1** (`completed` 224 · `skipped` 701)
  من الأداة القديمة `draft-to-live-cod-order-worker` اللي الأداة دي حلّت محلها
  بالكامل. البند مفتوح في `ecommoda-constants` §11 بند 7 وبيستنى تأكيد أحمد
  لتوثيقه كملحوظة تاريخية.
- **Build watch paths لسه `*`** — يعني أي تعديل واجهة بينشر الـ Worker تاني
  بنفس الكود. التضييق لـ `index.js` + `wrangler.toml` مقترح، وقواعده
  والاختبارين الإلزاميين في `ecommoda-tool-migration-playbook` §13-ب.

---

آخر تحديث: 13-09-2026 — 14:30

</div>
