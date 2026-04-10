const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const GET_CACHE_TTL_MS = 30_000;
const getCache = new Map();

function getCachedValue(path) {
  const cached = getCache.get(path);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    getCache.delete(path);
    return null;
  }

  return cached.value;
}

function setCachedValue(path, value) {
  getCache.set(path, {
    value,
    expiresAt: Date.now() + GET_CACHE_TTL_MS,
  });
}

function invalidateCache(paths = []) {
  paths.forEach((path) => getCache.delete(path));
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  if (method === "GET") {
    const cached = getCachedValue(path);
    if (cached !== null) {
      return cached;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const data = await response.json();
      message = data.detail || data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  const data = await response.json();
  if (method === "GET") {
    setCachedValue(path, data);
  }

  return data;
}

export const api = {
  login: (payload) =>
    request("/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getPatients: () => request("/patients"),
  getPatientSummary: (patientId) => request(`/patients/${patientId}/summary`),
  prefetchPatientSummary: (patientId) => request(`/patients/${patientId}/summary`).catch(() => null),
  searchScds: (query) => request(`/mappings/scds?query=${encodeURIComponent(query)}`),
  checkPrescription: (payload) =>
    request("/prescriptions/check", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  explainDdiAlert: (promptPayload) =>
    request("/prescriptions/explain-ddi", {
      method: "POST",
      body: JSON.stringify({ promptPayload }),
    }),
  submitPrescription: (payload) =>
    request("/prescriptions/submit", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((data) => {
      invalidateCache([
        "/patients",
        `/patients/${payload.patientId}/summary`,
        "/alerts",
      ]);
      return data;
    }),
  getAlerts: () => request("/alerts"),
  searchKnowledgeGraph: (query, entityType = "all") => request(`/knowledge-graph/search?query=${encodeURIComponent(query)}&entity_type=${encodeURIComponent(entityType)}`),
  searchKnowledgeGraphSuggestions: (query, entityType = "all") => request(`/knowledge-graph/suggestions?query=${encodeURIComponent(query)}&entity_type=${encodeURIComponent(entityType)}`),
};

