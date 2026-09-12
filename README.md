# Manual-Order-Creation-Log

تحويل الـ Draft Order اليدوي (اللي الموظف بيعمله من Shopify Admin) لأوردر
**COD حقيقي** — clone + `draftOrderComplete` بـ COD gateway ثابت، وبعدها حذف
الـ Draft الأصلي.

**ليه موجودة:** الموظف مالوش صلاحية (scope) يختار COD gateway وقت التكميل
اليدوي، والتكميل من غيره بيكسر التوافق مع باقي أدوات الـ COD في الستاك
(Treasury · COD Payment Center). الأداة بتكمّل الأوردر برمجيًا بـ
`paymentGatewayId` ثابت، فيخرج متوافق من غير أي خطوة يدوية.

## الروابط

| | |
|---|---|
| الواجهة (مراقبة وسجل) | https://ecommoda-dev.github.io/Manual-Order-Creation-Log/ |
| الـ Worker | https://draft-to-live-cod-manual-order-creation-worker.ecommoda-dev.workers.dev |

## نقطة الدخول الحقيقية

```
POST /webhook   ← Shopify Webhook Subscription · Topic: DRAFT_ORDERS_CREATE
```

الأداة بتشتغل **لوحدها** على الويبهوك — الواجهة للمراقبة والسجل بس، مافيهاش
أي زرار تنفيذ.

## الملفات

| الملف | إيه ده |
|---|---|
| `index.js` | كود الـ Worker — بينشر أوتوماتيك على `main` عبر Workers Builds |
| `wrangler.toml` | اسم الـ Worker + D1 binding + الـ vars |
| `index.html` | الواجهة — بتتنشر عبر GitHub Pages |
| `Index.html` | صفحة تحويل لـ `index.html` (للـ bookmarks القديمة) — صفر منطق |
| `CLAUDE.md` | قواعد الأداة · فخاخها · خط الأساس · بصمة المهارات |

> ⚠️ **الريبو ده هو المصدر الوحيد للكود بعد الربط.** أي لصق في داشبورد
> Cloudflare بيتمسح عند أول push جاي.

التفاصيل التشغيلية كلها في [`CLAUDE.md`](./CLAUDE.md).
