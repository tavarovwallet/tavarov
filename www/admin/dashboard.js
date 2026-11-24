const period = document.getElementById('period');
const statusLine = document.getElementById('status');
const names = ['first_invoice', 'first_payment', 'repeat_payment', 'invoice_live', 'paid_live', 'paid_chain',
  'invoice_test', 'paid_test', 'wallet_created', 'transfer_submitted', 'transfer_test_submitted'];
const merchantList = document.getElementById('merchants');
const siteVisits = document.getElementById('site-visits');
const siteSources = document.getElementById('site-sources');
const siteStatus = document.getElementById('site-status');
const integers = new Intl.NumberFormat('ru');
const dates = new Intl.DateTimeFormat('ru', { dateStyle: 'long' });
const historySummary = document.getElementById('history-summary');
const historyRows = document.getElementById('history-rows');
const historyNavigation = document.getElementById('history-navigation');
const historyPrevious = document.getElementById('history-previous');
const historyNext = document.getElementById('history-next');
const historyPage = document.getElementById('history-page');
const dateTime = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const statusNames = {
  paid: 'Оплачен', pending: 'Ждёт оплаты', expired: 'Истёк',
  refunded: 'Возврат', underpaid: 'Недоплата', wrong_currency: 'Другая валюта'
};
const networkNames = {
  bnb: 'BNB Chain', eth: 'Ethereum', base: 'Base', solana: 'Solana', xlayer: 'X Layer',
  bnbtest: 'BNB Chain', soltest: 'Solana'
};
let page = 1;
let currentRequest;

function renderHistory(history) {
  historyRows.replaceChildren();
  historySummary.textContent = history.total
    ? `Реальные: ${integers.format(history.live)}, оплачено ${integers.format(history.paid_live)}. Тестовые: ${integers.format(history.test)}, оплачено ${integers.format(history.paid_test)}.`
    : 'За этот период счетов нет.';
  for (const invoice of history.entries) {
    const row = document.createElement('tr');
    const invoiceStatus = statusNames[invoice.status] || invoice.status;
    for (const value of [
      dateTime.format(invoice.created_at * 1000), invoice.id,
      networkNames[invoice.network] || invoice.network, invoice.amount + ' ' + invoice.currency,
      invoice.mode === 'test' ? invoiceStatus + ' · тест' : invoiceStatus
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    historyRows.append(row);
  }
  const pages = Math.max(1, Math.ceil(history.total / history.pageSize));
  historyNavigation.hidden = pages === 1;
  historyPrevious.disabled = page <= 1;
  historyNext.disabled = page >= pages;
  historyPage.textContent = page + ' из ' + pages;
}

async function refresh() {
  currentRequest?.abort();
  currentRequest = new AbortController();
  const { signal } = currentRequest;
  statusLine.textContent = 'Загружаю статистику…';
  merchantList.replaceChildren();
  siteSources.replaceChildren();
  siteVisits.textContent = '—';
  siteStatus.textContent = '';
  historyRows.replaceChildren();
  historySummary.textContent = '';
  historyNavigation.hidden = true;
  for (const name of names) document.getElementById(name).textContent = '—';
  try {
    const response = await fetch('/api/admin/stats?days=' + period.value + '&page=' + page, { signal, cache: 'no-store' });
    if (!response.ok) {
      statusLine.textContent = response.status === 403 ? 'Нужен доступ владельца.' : 'Источник данных пока недоступен.';
      return;
    }
    const { start, counts, funnel, merchants, traffic, history } = await response.json();
    if (signal.aborted) return;
    const values = { ...counts, ...funnel };
    for (const name of names) document.getElementById(name).textContent = integers.format(values[name] ?? 0);
    for (const merchant of merchants) {
      const row = document.createElement('li');
      row.textContent = merchant.id + ' · оплат: ' + integers.format(merchant.payments) +
        ' · ' + dates.format(merchant.latest * 1000);
      merchantList.append(row);
    }
    if (merchants.length === 0) {
      const row = document.createElement('li');
      row.textContent = 'Пока нет оплат за этот период.';
      merchantList.append(row);
    }
    renderHistory(history);
    if (traffic) {
      siteVisits.textContent = integers.format(traffic.visits);
      if (traffic.capturedAt) {
        siteStatus.textContent = 'Снимок Cloudflare от ' + dateTime.format(traffic.capturedAt * 1000);
      }
      for (const source of traffic.sources) {
        const row = document.createElement('li');
        row.textContent = (source.host || 'Без указанного источника') + ' · ' + integers.format(source.visits);
        siteSources.append(row);
      }
    } else {
      siteStatus.textContent = 'Визиты и источники доступны в Cloudflare Web Analytics.';
    }
    statusLine.textContent = 'Текущие счётчики с ' + dates.format(start * 1000);
  } catch {
    if (!signal.aborted) statusLine.textContent = 'Не удалось загрузить данные.';
  }
}
period.addEventListener('change', () => { page = 1; refresh(); });
historyPrevious.addEventListener('click', () => { page -= 1; refresh(); });
historyNext.addEventListener('click', () => { page += 1; refresh(); });
refresh();
