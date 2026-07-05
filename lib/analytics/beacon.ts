// =============================================================================
// Visitor-analytics beacon. We inject a tiny inline <script> into a deployed
// app's index.html so every page load pings our public collector. The snippet
// is self-contained (no deps), wrapped in try/catch so it can never break the
// host page, and prefers navigator.sendBeacon with an Image() pixel fallback.
// =============================================================================

// Safely embed a server-controlled string inside a single-quoted JS literal.
function jsStr(value: string): string {
  return JSON.stringify(String(value));
}

// Build the inline <script>…</script> HTML string that reports a page view.
export function buildBeaconSnippet(projectId: string, collectBase: string): string {
  const base = String(collectBase).replace(/\/+$/, ''); // trim trailing slash(es)
  return `<script>(function(){try{` +
    `var P=${jsStr(projectId)},B=${jsStr(base)};` +
    `var v=null;try{v=localStorage.getItem('etlaq_vid');if(!v){v=(Date.now().toString(36)+Math.random().toString(36).slice(2,10));localStorage.setItem('etlaq_vid',v);}}catch(e){}` +
    `var u=B+'/api/analytics/collect?p='+encodeURIComponent(P)+'&v='+encodeURIComponent(v||'')+'&path='+encodeURIComponent(location.pathname);` +
    `if(navigator&&navigator.sendBeacon){navigator.sendBeacon(u);}else{(new Image()).src=u;}` +
    `}catch(e){}})();</script>`;
}

// Return a shallow-cloned files map with the beacon injected before </body> of
// any index.html. No-op (returns source unchanged) when collectBase is falsy or
// no index.html is present. Never mutates the input object.
export function injectAnalyticsBeacon(
  source: Record<string, string>,
  projectId: string,
  collectBase: string,
): Record<string, string> {
  if (!collectBase || !projectId) return source;

  const key = Object.keys(source).find((k) => {
    const base = k.split('/').pop() || k;
    return base.toLowerCase() === 'index.html';
  });
  if (!key) return source;

  const snippet = buildBeaconSnippet(projectId, collectBase);
  const html = source[key];
  const closingBody = /<\/body>/i;

  const next = closingBody.test(html)
    ? html.replace(closingBody, `${snippet}$&`)
    : html + snippet;

  return { ...source, [key]: next };
}
