/**
 * Naatak Vote Rally — Google Apps Script backend
 *
 * Setup (do this once, signed in as the Naatak Workspace account):
 *  1. Create a new Google Sheet (any name, e.g. "Naatak Vote Rally").
 *  2. Add two tabs:
 *       - "clicks"      — columns: A=timestamp
 *       - "subscribers" — columns: A=email, B=firstName, C=signupDate, D=status
 *     Put header rows in row 1.
 *  3. Extensions → Apps Script. Paste this whole file in. Save.
 *  4. Run `installDailyTrigger` once. Authorize when prompted.
 *  5. Deploy → New deployment → type "Web app".
 *       - Execute as: Me (the Naatak account)
 *       - Who has access: Anyone
 *     Copy the /exec URL.
 *  6. Paste that URL into APPS_SCRIPT_URL at the top of app.js.
 *  7. (Optional) Run `sendDailyReminders` manually once to test the email path.
 */

const VOTE_URL = 'https://www.sfgate.com/best/vote/#/gallery/527870149';
const FROM_NAME = 'Naatak Theater';
// Match the front-end: May 5, 2026 00:00 Pacific
const CONTEST_END = new Date('2026-05-05T07:00:00Z');

// ---------- HTTP entry points ----------

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'count') return jsonOut({ count: getCount() });
  if (action === 'unsubscribe') return htmlOut(unsubscribe(e.parameter.email || ''));
  return jsonOut({ error: 'unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'click') return jsonOut({ count: recordClick() });
    if (body.action === 'subscribe') return jsonOut(addSubscriber(body.email, body.firstName));
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) });
  }
}

// ---------- Click counter ----------

function recordClick() {
  const sheet = sheetByName_('clicks');
  sheet.appendRow([new Date()]);
  return Math.max(0, sheet.getLastRow() - 1);
}

function getCount() {
  const sheet = sheetByName_('clicks');
  return Math.max(0, sheet.getLastRow() - 1);
}

// ---------- Subscribers ----------

function addSubscriber(email, firstName) {
  email = String(email || '').trim().toLowerCase();
  firstName = String(firstName || '').trim();
  if (!email || !email.includes('@')) return { error: 'invalid email' };

  const sheet = sheetByName_('subscribers');
  const existing = sheet.getRange('A:A').getValues().flat().map(v => String(v).toLowerCase());
  if (existing.includes(email)) return { ok: true, dedup: true };

  sheet.appendRow([email, firstName, new Date(), 'active']);

  try {
    GmailApp.sendEmail(email,
      "You're in — daily Naatak vote reminders",
      welcomeText_(firstName, email),
      { htmlBody: welcomeHtml_(firstName, email), name: FROM_NAME });
  } catch (err) {
    // Welcome email can fail (quota, bad address). Subscription itself is fine.
    console.warn('welcome email failed', err);
  }

  return { ok: true };
}

function unsubscribe(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return '<h1>Missing email</h1>';
  const sheet = sheetByName_('subscribers');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email) {
      sheet.getRange(i + 1, 4).setValue('unsubscribed');
      return `<h1>You're unsubscribed</h1><p>${escapeHtml_(email)} won't receive any more reminders.</p>`;
    }
  }
  return `<h1>Not on the list</h1><p>${escapeHtml_(email)} isn't subscribed.</p>`;
}

// ---------- Daily reminder ----------

function sendDailyReminders() {
  const now = new Date();
  if (now > CONTEST_END) return;

  const daysLeft = Math.max(1, Math.ceil((CONTEST_END - now) / 86400000));
  const sheet = sheetByName_('subscribers');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const [email, firstName, , status] = data[i];
    if (status !== 'active' || !email) continue;
    try {
      GmailApp.sendEmail(email,
        `${daysLeft} day${daysLeft === 1 ? '' : 's'} left — vote for Naatak Theater`,
        reminderText_(firstName, daysLeft, email),
        { htmlBody: reminderHtml_(firstName, daysLeft, email), name: FROM_NAME });
    } catch (err) {
      console.warn('reminder failed for', email, err);
    }
  }
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminders')
    .timeBased()
    .atHour(9) // 9am in the script's timezone (set File → Project Settings → Time zone to America/Los_Angeles)
    .everyDays(1)
    .create();
}

// ---------- Email templates ----------

function welcomeText_(name, email) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return [
    greeting,
    '',
    "You'll get a short daily reminder to vote for Naatak Theater in SFGate's Best of the Bay until voting closes May 5.",
    '',
    'Vote: ' + VOTE_URL,
    'On SFGate: Entertainment & Leisure → Live Theater → click "Vote" next to Naatak Theater.',
    '',
    'Unsubscribe any time: ' + unsubscribeUrl_(email),
    '',
    '— Naatak Theater',
  ].join('\n');
}

function welcomeHtml_(name, email) {
  const greeting = name ? `Hi ${escapeHtml_(name)},` : 'Hi,';
  return baseHtml_(`
    <p>${greeting}</p>
    <p>You'll get a short daily reminder to vote for <strong>Naatak Theater</strong> in SFGate's Best of the Bay until voting closes <strong>May 5</strong>.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${VOTE_URL}" style="background:#1FA84A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;display:inline-block;">VOTE ON SFGATE</a>
    </p>
    <p style="font-size:13px;color:#6B5E52;">On SFGate: <strong>Entertainment &amp; Leisure</strong> → <strong>Live Theater</strong> → click <strong>Vote</strong> next to <strong>Naatak Theater</strong>.</p>
  `, email);
}

function reminderText_(name, daysLeft, email) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return [
    greeting,
    '',
    `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to vote for Naatak Theater. Takes 30 seconds.`,
    '',
    'Vote: ' + VOTE_URL,
    'Entertainment & Leisure → Live Theater → click "Vote" next to Naatak Theater.',
    '',
    'Unsubscribe: ' + unsubscribeUrl_(email),
    '',
    '— Naatak Theater',
  ].join('\n');
}

function reminderHtml_(name, daysLeft, email) {
  const greeting = name ? `Hi ${escapeHtml_(name)},` : 'Hi,';
  const dayWord = daysLeft === 1 ? 'day' : 'days';
  return baseHtml_(`
    <p>${greeting}</p>
    <p><strong>${daysLeft} ${dayWord} left</strong> to vote for Naatak Theater. Takes about 30 seconds.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${VOTE_URL}" style="background:#1FA84A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;display:inline-block;">VOTE TODAY</a>
    </p>
    <p style="font-size:13px;color:#6B5E52;">Entertainment &amp; Leisure → Live Theater → click <strong>Vote</strong> next to <strong>Naatak Theater</strong>.</p>
  `, email);
}

function baseHtml_(inner, email) {
  return `
  <div style="font-family:Georgia,serif;background:#FFF8EE;padding:24px;color:#1A1A1A;">
    <div style="max-width:520px;margin:0 auto;background:#FFFDF8;border:1px solid #E8CDA3;border-radius:14px;padding:28px;">
      <h2 style="color:#8B1A1A;margin:0 0 12px;font-style:italic;">Naatak Theater</h2>
      ${inner}
      <hr style="border:none;border-top:1px solid #E8CDA3;margin:24px 0 12px;">
      <p style="font-size:11px;color:#6B5E52;text-align:center;margin:0;">
        <a href="${unsubscribeUrl_(email)}" style="color:#6B5E52;">Unsubscribe</a>
      </p>
    </div>
  </div>`;
}

function unsubscribeUrl_(email) {
  return ScriptApp.getService().getUrl() + '?action=unsubscribe&email=' + encodeURIComponent(email);
}

// ---------- Helpers ----------

function sheetByName_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet tab: "${name}"`);
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function htmlOut(html) {
  return HtmlService.createHtmlOutput(`
    <html><head><meta charset="utf-8"><title>Naatak</title>
    <style>body{font-family:Georgia,serif;background:#FFF8EE;color:#1A1A1A;text-align:center;padding:48px 16px;}
    h1{color:#8B1A1A;font-style:italic;}
    a{color:#8B1A1A;}</style></head>
    <body>${html}<p><a href="https://naatak.org">naatak.org</a></p></body></html>
  `);
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
