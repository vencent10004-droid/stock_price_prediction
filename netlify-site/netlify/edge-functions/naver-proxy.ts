import type { Config } from "@netlify/edge-functions";

// 네이버 증권 API 프록시 — 같은 출처(/api/naver/*)로 서빙되므로 CORS 문제가 없다.
export default async (req: Request) => {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/api\/naver\//, "");
  const target = new URL(rest + url.search, "https://m.stock.naver.com/");
  if (target.hostname !== "m.stock.naver.com") {
    return new Response("bad target", { status: 400 });
  }
  const upstream = await fetch(target.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
};

export const config: Config = {
  path: "/api/naver/*",
};
