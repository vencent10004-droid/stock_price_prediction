/**
 * KOSPI 100 히트맵 전용 CORS 프록시 (Cloudflare Workers, 무료)
 *
 * 배포 방법 (약 5분, 신용카드 불필요):
 *   1. https://dash.cloudflare.com 가입/로그인
 *   2. Workers & Pages → Create → Create Worker → 이름 지정(예: kospi-proxy) → Deploy
 *   3. Edit code 버튼 → 이 파일 내용 전체를 붙여넣고 → Deploy
 *   4. 발급된 주소 확인 (예: https://kospi-proxy.내계정.workers.dev)
 *   5. docs/app.js 상단의 MY_PROXY 값을 아래처럼 수정하고 커밋:
 *        const MY_PROXY = "https://kospi-proxy.내계정.workers.dev/?url=";
 *
 * 네이버 증권 API만 통과시키므로 외부에서 악용될 수 없습니다.
 */
const ALLOWED_HOSTS = ["m.stock.naver.com", "api.stock.naver.com"];

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("missing url", { status: 400 });

    let t;
    try { t = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
    if (!ALLOWED_HOSTS.includes(t.hostname)) {
      return new Response("host not allowed", { status: 403 });
    }

    const upstream = await fetch(t.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  },
};
