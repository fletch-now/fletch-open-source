// GET /api/v1/docs — Swagger UI over /api/v1/openapi.json, with its assets
// served from this origin (app/api/v1/docs/assets) so no third-party script
// runs on the page. The written reference with examples is at /developers.

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fletch API, Swagger UI</title>
  <link rel="stylesheet" href="/api/v1/docs/assets/css">
  <style>
    body { margin: 0; background: #f6f8f1; }
    .topbar { display: none; }
    .swagger-ui .info { margin: 32px 0; }
    .fletch-bar { font: 14px/1.4 system-ui, sans-serif; padding: 12px 20px; border-bottom: 1px solid #dfe4da; background: #fff; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
    .fletch-bar a { color: #007a05; }
    #docs-status { font: 16px/1.5 system-ui, sans-serif; margin: 32px 20px; }
    #docs-status a { color: #007a05; }
  </style>
</head>
<body>
  <div class="fletch-bar"><strong>Fletch API</strong><a href="/developers">Written reference with examples</a><a href="/api/v1/openapi.json">openapi.json</a><a href="/llms.txt">llms.txt</a><a href="https://github.com/fletch-now/fletch-mcp">MCP server</a></div>
  <p id="docs-status" role="status">Loading API reference...</p>
  <noscript><p>The interactive reference needs JavaScript. <a href="/developers">Read the API guide</a> or <a href="/api/v1/openapi.json">download OpenAPI JSON</a>.</p></noscript>
  <div id="swagger-ui"></div>
  <script>
    function docsUnavailable() {
      document.getElementById("docs-status").innerHTML = 'The interactive reference could not load. <a href="/api/v1/docs">Try again</a> or <a href="/developers">read the API guide</a>.';
    }
    window.addEventListener("error", docsUnavailable, { once: true });
    var loadingDeadline = window.setTimeout(docsUnavailable, 20000);
  </script>
  <script src="/api/v1/docs/assets/bundle"></script>
  <script src="/api/v1/docs/assets/preset"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      docExpansion: "list",
      defaultModelsExpandDepth: 1,
      tryItOutEnabled: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      onComplete: function () {
        window.clearTimeout(loadingDeadline);
        if (window.ui.specSelectors.specJson().get("paths")) {
          document.getElementById("docs-status").hidden = true;
        } else {
          docsUnavailable();
        }
      },
    });
  </script>
</body>
</html>`;

export async function GET(): Promise<Response> {
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
