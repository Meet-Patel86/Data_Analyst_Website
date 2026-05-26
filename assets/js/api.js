(function () {
  const config = window.DataStudioConfig || { apiBaseUrl: '', endpoints: {} };

  function endpoint(name) {
    return `${config.apiBaseUrl || ''}${config.endpoints[name] || ''}`;
  }

  async function request(name, options = {}) {
    const url = endpoint(name);
    if (!url) throw new Error(`Missing API endpoint: ${name}`);

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const message = body && body.error ? body.error : `Request failed with ${response.status}`;
      throw new Error(message);
    }

    return body;
  }

  window.DataStudioAPI = {
    health: () => request('health'),
    me: () => request('me'),
    logout: () => fetch('/auth/logout', { method: 'POST' }),
    submitContact: payload => request('contact', { method: 'POST', body: JSON.stringify(payload) }),
    listContacts: () => request('contacts'),
    listDatasets: () => request('datasets'),
    adminStats: () => request('adminStats'),
    analyzeDataset: payload => request('analyzeDataset', { method: 'POST', body: JSON.stringify(payload) })
  };
})();




