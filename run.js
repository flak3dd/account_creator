const { chromium } = require('playwright');
const readline = require('readline/promises');

/** Prompt the operator on the terminal for the SMS verification code. */
async function promptForSmsCode({ phoneNumber, inboxUrl } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n============================================================');
  console.log('SMS verification required to finish account creation.');
  if (phoneNumber) console.log(`Number used: ${phoneNumber}`);
  if (inboxUrl)    console.log(`Inbox URL:   ${inboxUrl}`);
  console.log('Check the SMS inbox for the code and enter it below.');
  console.log('============================================================');
  try {
    while (true) {
      const answer = (await rl.question('Enter the SMS code: ')).trim();
      if (answer) return answer;
      console.log('Code cannot be empty, please try again.');
    }
  } finally {
    rl.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let tempPhoneNumber = '';
  let smsInboxUrl = '';

  /** Fetch AU phone number from sms24.me */
  async function fetchSmsNumber() {
    console.log('Fetching AU phone number from sms24.me...');
    await page.goto('https://sms24.me/en/countries/au', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a.callout', { timeout: 15000 });

    const firstCard = page.locator('a.callout').first();
    const phone = await firstCard.locator('.fw-bold.text-primary').innerText();
    const href = await firstCard.getAttribute('href') ?? '';
    
    tempPhoneNumber = phone.trim();
    smsInboxUrl = href.startsWith('http') ? href : `https://sms24.me${href}`;
    console.log(`Using AU number: ${tempPhoneNumber}`);
    console.log(`Inbox URL: ${smsInboxUrl}`);
  }

  /** Advance from Step 1 to Step 2 */
  async function clickNextStep1() {
    const nextBtn = page.locator('button#next-step');
    await page.waitForFunction(() => {
      const btn = document.querySelector('button#next-step');
      return btn && !btn.disabled && !btn.classList.contains('disabled');
    }, { timeout: 5000 }).catch(() => {
      console.log('Next button still appears disabled – attempting click anyway');
    });

    await nextBtn.click({ force: true });
    await page.waitForSelector('#registration-phone', { timeout: 10000 });
    console.log('Step 2 loaded – phone field visible');
  }

  /** Handle Step 2: Country selection and phone entry */
  async function enterPhoneNumber() {
    console.log('Navigating to Ignition Join page...');
    await page.goto('https://www.ignitioncasino.eu/?overlay=join', { waitUntil: 'domcontentloaded' });

    // Handle Cookie Banner if present
    const cookieBtn = page.getByRole('button', { name: 'ACCEPT ALL' });
    if (await cookieBtn.count() > 0) {
      await cookieBtn.click();
      console.log('Cookies accepted');
    }

    await page.waitForSelector('#registration-firstName', { timeout: 15000 });
    console.log('Re-filling Step 1 info...');

    const details = { first: 'James', last: 'Anderson', dob: '06-15-1990' };
    await page.locator('#registration-firstName').fill(details.first);
    await page.locator('#registration-lastName').fill(details.last);
    await page.locator('#registration-dateOfBirth').fill(details.dob);

    // Background fields
    await page.locator('[id$="-firstName"]').nth(1).fill(details.first, { force: true });
    await page.locator('[id$="-lastName"]').nth(1).fill(details.last, { force: true });
    await page.locator('[id$="-dateOfBirth"]').nth(1).fill(details.dob, { force: true });
    
    await page.waitForTimeout(800);
    await clickNextStep1();

    console.log('Changing country to Australia...');
    await page.locator('.custom-link').filter({ hasText: 'Modify' }).and(page.locator(':visible')).first().click();
    await page.waitForTimeout(500);

    await page.locator('#country-dropdown').first().click();
    await page.waitForTimeout(500);

    await page.locator('ul.custom-droplist li[listitem="listitem"]')
      .filter({ hasText: 'Australia' })
      .first()
      .click();
    console.log('Country set to Australia (+61)');

    const localNumber = tempPhoneNumber.replace(/^\+?61/, '').replace(/^0/, '');
    console.log(`Entering local number: ${localNumber}`);
    await page.locator('#registration-phone').first().fill(localNumber);

    // T&C Checkbox
    const tocLabel = page.locator('bx-registration-overlay label[for="registration-termsandconditions"]');
    const tocInput = page.locator('bx-registration-overlay #registration-termsandconditions');
    if (!(await tocInput.isChecked().catch(() => false))) {
      await tocLabel.click();
    }

    // Background T&C
    const bgToc = page.locator('[id$="-termsandconditions"]').nth(1);
    if (await bgToc.count() > 0) {
      await bgToc.check({ force: true });
    }

    await page.locator('button#next-step').click({ force: true });
    await page.waitForSelector('#registration-email', { timeout: 15000 });
    console.log('Step 3 loaded');
  }

  /** Finalize registration */
  async function fillStep3AndSubmit() {
    const email = `james.anderson.${Date.now()}@gmail.com`;
    const pass = 'SecurePass@2024!';
    const zip = '2000'; // AU Sydney ZIP

    await page.locator('#registration-email').fill(email);
    await page.locator('#registration-password').fill(pass);
    await page.locator('#registration-postalCode').fill(zip);

    // Background fields
    await page.locator('[id$="-email"]').nth(1).fill(email, { force: true });
    await page.locator('[id$="-password"]').nth(1).fill(pass, { force: true });
    await page.locator('[id$="-postalCode"]').nth(1).fill(zip, { force: true });

    await page.locator('button#registration-submit').click({ force: true });
    console.log('Form submitted. Waiting for SMS verification step...');

    await handleSmsVerification();
  }

  /** Wait for the SMS verification screen, prompt the operator for the code,
   *  fill it in, and submit. Falls back gracefully if the flow skips SMS. */
  async function handleSmsVerification() {
    const codeInputSelector = [
      '#verification-code',
      '#registration-verification-code',
      '#sms-code',
      '#smsCode',
      '[name="verificationCode"]',
      '[name="smsCode"]',
      '[id*="verification" i][id*="code" i]',
      '[id*="sms" i][id*="code" i]',
      'input[autocomplete="one-time-code"]',
    ].join(', ');

    const successSelector = '[class*="success"], [class*="welcome"], [class*="confirmation"], #lobby';

    let codeInput;
    try {
      codeInput = await Promise.race([
        page.waitForSelector(codeInputSelector, { timeout: 30000 }).then(el => ({ kind: 'code', el })),
        page.waitForSelector(successSelector,   { timeout: 30000 }).then(el => ({ kind: 'done', el })),
      ]);
    } catch (e) {
      console.log('No SMS verification prompt detected within 30s – capturing state.');
      await page.screenshot({ path: 'post_submit_state.png' });
      return;
    }

    if (codeInput.kind === 'done') {
      console.log('✓ Account created successfully (no SMS step shown).');
      return;
    }

    const code = await promptForSmsCode({ phoneNumber: tempPhoneNumber, inboxUrl: smsInboxUrl });
    console.log(`Submitting SMS code: ${code}`);

    await codeInput.el.fill(code);

    const submitCandidates = page.locator(
      'button#verify-sms, button#verification-submit, button[type="submit"]:has-text("Verify"), button:has-text("Verify"), button:has-text("Submit")'
    );
    if (await submitCandidates.count() > 0) {
      await submitCandidates.first().click({ force: true }).catch(() => {});
    } else {
      await codeInput.el.press('Enter').catch(() => {});
    }

    try {
      await page.waitForSelector(successSelector, { timeout: 20000 });
      console.log('✓ Account verified and created successfully!');
    } catch (e) {
      console.log('Verification confirmation not detected, capturing final state.');
      await page.screenshot({ path: 'final_state.png' });
    }
  }

  // Execution flow
  try {
    await fetchSmsNumber();
    await enterPhoneNumber();
    await fillStep3AndSubmit();
  } catch (error) {
    console.error('Registration failed:', error);
    await page.screenshot({ path: 'error.png' });
  } finally {
    await browser.close();
  }
})();
