# Netlify 실시간 배포본

**https://krx-heatmap.netlify.app** (siteId d4e19452-536d-4112-be8b-0c765378f134)

docs/ 와 동일한 앱 + 같은 출처 엣지 프록시(/api/naver/*)로 CORS 없이 항상 실시간.
이 폴더의 app.js와 edge function 외 나머지 파일은 docs/ 를 그대로 복사해서 배포.
재배포: docs 파일 + 이 폴더 파일을 한 디렉토리에 모아 Netlify MCP deploy-site 실행.
