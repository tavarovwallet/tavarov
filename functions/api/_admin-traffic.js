const query = `
  query OwnerTraffic($account: string, $from: Time, $to: Time) {
    viewer {
      accounts(filter: {accountTag: $account}) {
        totals: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {
          datetime_geq: $from, datetime_lt: $to, requestHost_in: ["tavarov.com", "www.tavarov.com"]
        }) { sum { visits } }
        referrers: rumPageloadEventsAdaptiveGroups(limit: 12, orderBy: [sum_visits_DESC], filter: {
          datetime_geq: $from, datetime_lt: $to, requestHost_in: ["tavarov.com", "www.tavarov.com"]
        }) { dimensions { refererHost } sum { visits } }
      }
    }
  }
`;

export async function fetchSiteTraffic(env, days) {
  if (!env.ADMIN_CF_ACCOUNT || !env.ADMIN_CF_ANALYTICS_TOKEN) return null;
  try {
    const now = Date.now();
    const variables = { account: env.ADMIN_CF_ACCOUNT,
      from: new Date(now - days * 86400000).toISOString(), to: new Date(now).toISOString() };
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.ADMIN_CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const account = data.data?.viewer?.accounts?.[0];
    if (data.errors?.length || !account?.totals || !account?.referrers) return null;
    return { visits: account.totals[0]?.sum.visits ?? 0, sources: account.referrers
      .filter(row => row.sum.visits > 0)
      .map(row => ({ host: row.dimensions.refererHost || '', visits: row.sum.visits })) };
  } catch { return null; }
}

export async function readSiteTraffic(env, days) {
  const live = await fetchSiteTraffic(env, days);
  if (live) return live;
  try {
    const cached = await env.ADMIN_STATS.prepare(
      'SELECT captured_at, data FROM admin_site_traffic WHERE days = ?'
    ).bind(days).first();
    if (cached) return { ...JSON.parse(cached.data), capturedAt: cached.captured_at };
  } catch {
    console.error('Admin traffic snapshot read failed');
  }
  return null;
}
