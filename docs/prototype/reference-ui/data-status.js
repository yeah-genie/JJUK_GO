/* Read the same deployed metadata as the route engine; never treats collection as live signal proof. */
(function (root) {
  'use strict';
  async function read(fetcher = root.fetch.bind(root)) {
    const historicalUrl = new URL('seoul/signal-plans.json', document.baseURI).href;
    const configUrl = new URL('/api/signal-live?config=1', document.baseURI).href;
    const get = async url => {
      const response = await fetcher(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!response.ok) throw new Error('Metadata unavailable');
      return response.json();
    };
    // config=1 returns before Redis/upstream processing in api/signal-live.js.
    const [history, live] = await Promise.allSettled([get(historicalUrl), get(configUrl)]);
    const h = history.status === 'fulfilled' ? history.value : null;
    const dates = [...new Set((Array.isArray(h?.source_dates) ? h.source_dates : [])
      .filter(d => typeof d === 'string' && /^\d{8}$/.test(d)))].sort();
    const c = live.status === 'fulfilled' ? live.value : null;
    const crosswalks = Array.isArray(c?.crosswalks) ? c.crosswalks.length : 0;
    return {
      historical: {
        available: !!h && dates.length > 0,
        source: typeof h?.source === 'string' ? h.source : '',
        firstDate: dates[0] || null,
        lastDate: dates.at(-1) || null,
        days: dates.length,
        // Candidate pattern intersections, not verified live or usable-direction coverage.
        candidateIntersections: Number.isInteger(h?.signal_count) && h.signal_count >= 0 ? h.signal_count : 0,
        mode: 'historical'
      },
      live: {
        configurationRead: !!c,
        status: !c ? 'unknown' : c.mock ? 'mock' : !c.enabled ? 'disabled' : crosswalks ? 'eligible' : 'unverified',
        verifiedCrosswalks: c && !c.mock ? crosswalks : 0,
        // Eligibility is not freshness. Each signal still needs the existing server/gate verdict.
        eligible: !!c?.enabled && !c.mock && crosswalks > 0
      }
    };
  }
  root.JJUKGODataStatus = Object.freeze({ read });
})(window);
