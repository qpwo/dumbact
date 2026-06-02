/** HTTP client helpers for the multi-file TSX service queue demo. */
export function listJobs() {
  return json("/api/jobs");
}

export function createJob(title) {
  return json("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export function advanceRemoteJob(id) {
  return json("/api/jobs/" + encodeURIComponent(id) + "/advance", { method: "POST" });
}

function json(url, options) {
  return fetch(url, options).then(requireOk).then(response => response.json());
}

function requireOk(response) {
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + response.url);
  return response;
}
