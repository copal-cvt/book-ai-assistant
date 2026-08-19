// این فایل روی سرور Cloudflare اجرا می‌شود (نه در مرورگر کاربر)
// بنابراین کلید API اینجا امن باقی می‌ماند و هرگز به کاربر فرستاده نمی‌شود.
//
// این فایل جایگزین پوشه‌ی قدیمی functions/api/generate.js شده است، چون در معماری
// جدید Cloudflare (سال ۲۰۲۶)، پروژه‌های Git-connected به‌صورت «Worker با فایل‌های
// استاتیک» ساخته می‌شوند و پوشه‌ی functions به‌تنهایی شناسایی نمی‌شود.
//
// این Worker دو کار انجام می‌دهد:
//   ۱. اگر درخواست به مسیر /api/generate باشد → پردازش با مدل هوش مصنوعی
//   ۲. برای هر مسیر دیگر (index.html, style.css, app.js, ...) → تحویل فایل استاتیک

const MAX_IMAGE_BYTES = 200 * 1024;

const PROMPTS = {
  translate:
    "متن نوشته‌شده در تصویر زیر که یک صفحه از یک کتاب به زبان انگلیسی است را بخوان و به فارسی روان، دقیق و طبیعی ترجمه کن. فقط متن ترجمه‌شده را برگردان، بدون توضیح اضافه و بدون توصیف تصویر.",

  summarize:
    "متن نوشته‌شده در تصویر زیر که یک صفحه از یک کتاب است را بخوان و به‌صورت خلاصه‌ای روشن و ساختاریافته به زبان فارسی خلاصه کن (حداکثر ۱۵۰ کلمه). نکات کلیدی را با بولت مشخص کن. فقط خلاصه را برگردان، بدون توصیف ظاهری تصویر.",

  qa:
    "متن نوشته‌شده در تصویر زیر که یک صفحه از یک کتاب است را بخوان و دقیقاً ۱۰ سوال مهم به همراه پاسخ کوتاه و دقیق آن‌ها را به زبان فارسی تولید کن. خروجی را به‌صورت شماره‌گذاری‌شده (۱ تا ۱۰) و با فرمت زیر بده:\nسوال: ...\nپاسخ: ...",

  mindmap:
    "متن نوشته‌شده در تصویر زیر که یک صفحه از یک کتاب است را بخوان و یک نقشه ذهنی متنی به زبان فارسی بساز. موضوع اصلی را در بالا بنویس و زیرمفهوم‌ها را با تورفتگی (indentation) و خط تیره به‌صورت درختی زیر آن مرتب کن (حداکثر ۳ سطح عمق). فقط ساختار درختی را برگردان، بدون توضیح اضافه.",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return handleGenerate(request, env);
    }

    // هر درخواست دیگری → تحویل فایل استاتیک (index.html, style.css, app.js, ...)
    return env.ASSETS.fetch(request);
  },
};

async function handleGenerate(request, env) {
  try {
    if (!env.NVIDIA_API_KEY) {
      return jsonError("کلید API روی سرور تنظیم نشده است (NVIDIA_API_KEY را در تنظیمات Cloudflare اضافه کنید).", 500);
    }

    const body = await request.json();
    const { action, image } = body || {};

    if (!action || !PROMPTS[action]) {
      return jsonError("عملیات نامعتبر است.", 400);
    }
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return jsonError("تصویر معتبری از صفحه ارسال نشده است.", 400);
    }

    const approxBytes = Math.ceil((image.length - image.indexOf(",") - 1) * 0.75);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return jsonError("حجم تصویر صفحه بیش از حد مجاز است. لطفاً دوباره تلاش کنید.", 413);
    }

    const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPTS[action] },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 4096,
        stream: false,
        temperature: 0.7,
        top_p: 0.95,
      }),
    });

    if (!nvidiaRes.ok) {
      const errText = await nvidiaRes.text();
      console.error("NVIDIA API error:", nvidiaRes.status, errText);
      return jsonError(`خطا از سرویس هوش مصنوعی (کد ${nvidiaRes.status})`, 502);
    }

    const data = await nvidiaRes.json();
    let resultText = data?.choices?.[0]?.message?.content ?? "";

    // حذف بلاک‌های فکر کردن مدل (در صورت وجود)
    resultText = resultText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    return new Response(JSON.stringify({ result: resultText }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return jsonError("خطای داخلی سرور.", 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
