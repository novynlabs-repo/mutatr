import http from "node:http";

const args = process.argv.slice(2);
const host = argValue(args, "--host") ?? argValue(args, "--hostname") ?? "127.0.0.1";
const port = Number(argValue(args, "--port") ?? argValue(args, "-p") ?? 4179);

const ROUTES = {
  "/": { title: "Home", color: "#d04a4a" },
  "/login": { title: "Login", color: "#376fca" },
  "/pricing": { title: "Pricing", color: "#2e9863" },
  "/dashboard": { title: "Dashboard", color: "#aa7a2f" },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const route = ROUTES[url.pathname] ?? { title: "Not Found", color: "#7a2f57" };

  let ctaHtml = "";
  let socialProofHtml = "";
  let socialProofVariant = "a";
  let noCcHtml = "";
  let noCcVariant = "a";
  let subheadlineHtml = `<p>Live non-mock route: ${escapeHtml(url.pathname)}</p>`;
  let shVariant = "a";
  let headlineHtml = `<h1>${escapeHtml(route.title)}</h1>`;
  let hlVariant = "a";
  const setCookies = [];

  if (url.pathname === "/") {
    const { variant: hlVariantVal, setCookie: hlCookie } = url.searchParams.get("hl") === "b"
      ? { variant: "b", setCookie: `headline-variant=b; Path=/; Max-Age=2592000` }
      : getVariant(req, "headline-variant");
    if (hlCookie) setCookies.push(hlCookie);
    headlineHtml = hlVariantVal === "b"
      ? `<h1 data-testid='headline-variant-b' style='font-size:42px;margin:0;line-height:1.2'>Ship Features<br>with Confidence</h1>`
      : `<h1>Home</h1>`;
    hlVariant = hlVariantVal;
    const { name: variant, setCookie } = getHeroCtaVariant(req, url);
    if (setCookie) setCookies.push(setCookie);
    if (variant === "treatment") {
      ctaHtml = `<a href='/pricing' data-testid='hero-cta-primary' onclick="window.analytics?.track('cta_click',{variant:'treatment',destination:'/pricing'})" style='display:inline-block;margin-top:16px;padding:12px 24px;background:#fff;color:#d04a4a;border-radius:8px;text-decoration:none;font-weight:600'>See Pricing</a><br><a href='/login' data-testid='hero-cta-secondary' onclick="window.analytics?.track('cta_click',{variant:'treatment',destination:'/login'})" style='display:inline-block;margin-top:12px;color:rgba(255,255,255,0.85);text-decoration:none;font-size:15px'>or sign up free &#8594;</a>`;
    } else {
      ctaHtml = `<a href='/login' data-testid='hero-cta-primary' onclick="window.analytics?.track('cta_click',{variant:'control',destination:'/login'})" style='display:inline-block;margin-top:16px;padding:12px 24px;background:#fff;color:#d04a4a;border-radius:8px;text-decoration:none;font-weight:600'>Start Free</a>`;
    }
    const { variant: spVariant, setCookie: spCookie } = url.searchParams.get("sp") === "b"
      ? { variant: "b", setCookie: `social-proof=b; Path=/; Max-Age=2592000` }
      : getVariant(req, "social-proof");
    if (spCookie) setCookies.push(spCookie);
    socialProofHtml = spVariant === "b" ? "<p data-testid='social-proof-badge' style='margin-top:12px;font-size:14px;opacity:0.85'>Trusted by 2,400+ developers</p>" : "";
    socialProofVariant = spVariant;
    const { variant: noCcVariantVal, setCookie: noCcCookie } = url.searchParams.get("cc") === "b"
      ? { variant: "b", setCookie: `no-cc-copy=b; Path=/; Max-Age=2592000` }
      : getVariant(req, "no-cc-copy");
    if (noCcCookie) setCookies.push(noCcCookie);
    noCcHtml = noCcVariantVal === "b" ? "<p data-testid='no-cc-copy' style='margin-top:8px;font-size:13px;opacity:0.7'>No credit card required · Free plan available</p>" : "";
    noCcVariant = noCcVariantVal;
    const { variant: shVariantVal, setCookie: shCookie } = url.searchParams.get("sh") === "b"
      ? { variant: "b", setCookie: `subheadline-variant=b; Path=/; Max-Age=2592000` }
      : getVariant(req, "subheadline-variant");
    if (shCookie) setCookies.push(shCookie);
    subheadlineHtml = shVariantVal === "b"
      ? `<p data-testid='subheadline' style='margin-top:8px;font-size:18px;opacity:0.9'>Run more experiments. Ship with confidence.</p>`
      : `<p data-testid='subheadline'>Live non-mock route: ${escapeHtml(url.pathname)}</p>`;
    shVariant = shVariantVal;
  }

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(route.title)}</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
      }
      body {
        display: grid;
        place-items: center;
        background: ${route.color};
        color: #ffffff;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      .card {
        text-align: center;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 16px;
        padding: 24px;
        min-width: 420px;
      }
      h1 { margin: 0; font-size: 48px; }
      p { margin: 8px 0 0; font-size: 20px; }
    </style>
  </head>
  <body>
    <section class="card">
      ${headlineHtml}
      ${subheadlineHtml}
      ${ctaHtml}
      ${noCcHtml}
      ${socialProofHtml}
    </section>
    <script>window.analytics?.track('social_proof_impression',{variant:'${socialProofVariant}'});window.analytics?.track('no_cc_copy_impression',{variant:'${noCcVariant}'});window.analytics?.track('subheadline_impression',{variant:'${shVariant}'});window.analytics?.track('headline_impression',{variant:'${hlVariant}'})</script>
  </body>
</html>`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("set-cookie", setCookies);
  res.statusCode = ROUTES[url.pathname] ? 200 : 404;
  res.end(html);
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`live fixture server listening at http://${host}:${port}`);
});

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index >= 0 && index < argv.length - 1) {
    return argv[index + 1];
  }
  return undefined;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getHeroCtaVariant(req, url) {
  if (url.searchParams.get("v") === "cta") {
    return { name: "treatment", setCookie: "hero-cta-variant=treatment; Path=/; Max-Age=2592000" };
  }
  const cookieHeader = req.headers["cookie"] ?? "";
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("hero-cta-variant="));
  if (match) {
    const value = match.slice("hero-cta-variant=".length);
    return { name: value === "treatment" ? "treatment" : "control", setCookie: null };
  }
  return { name: "control", setCookie: null };
}

function getVariant(req, cookieName) {
  const cookieHeader = req.headers["cookie"] ?? "";
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${cookieName}=`));
  if (match) {
    const value = match.slice(cookieName.length + 1);
    return { variant: value === "b" ? "b" : "a", setCookie: null };
  }
  const variant = Math.random() < 0.5 ? "a" : "b";
  return { variant, setCookie: `${cookieName}=${variant}; Path=/; Max-Age=2592000` };
}
