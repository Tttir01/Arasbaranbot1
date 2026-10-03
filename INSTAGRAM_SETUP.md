# Instagram Publishing Setup

این پروژه می‌تواند خبرهای دارای تصویر یا ویدئوی عمومی را پس از ارسال به Telegram به Instagram Professional نیز منتشر کند.

## GitHub Secrets

در Settings → Secrets and variables → Actions این Secrets را اضافه کنید:

- `INSTAGRAM_ENABLED` = `true`
- `INSTAGRAM_USER_ID` = شناسه عددی Instagram Professional
- `INSTAGRAM_ACCESS_TOKEN` = توکن معتبر Meta/Instagram Graph API
- `META_GRAPH_VERSION` = نسخه Graph API مورد استفاده؛ اگر تنظیم نشود، `v23.0` استفاده می‌شود.

## شرایط حساب

حساب Instagram باید Professional (Business یا Creator) باشد و دسترسی API لازم را داشته باشد. تصویر یا ویدئویی که Instagram از URL دریافت می‌کند باید از اینترنت عمومی قابل دسترسی باشد.

## رفتار ربات

1. خبر دریافت و بازنویسی می‌شود.
2. خبر به Telegram ارسال می‌شود.
3. سابقه Telegram ذخیره می‌شود تا خطای Instagram باعث ارسال تکراری Telegram نشود.
4. اگر Instagram فعال باشد و خبر تصویر یا ویدئوی عمومی داشته باشد، انتشار Instagram انجام می‌شود.
5. خطای Instagram مانع ادامه کار خبرهای بعدی نمی‌شود.

## توجه

توکن را داخل کد، README یا فایل Workflow قرار ندهید؛ فقط در GitHub Secrets ذخیره کنید.
