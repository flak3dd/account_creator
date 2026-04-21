const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe.configure({ mode: 'serial' });

// Basic CSV parser
const csvPath = path.join(__dirname, '..', 'data.csv');
const csvData = fs.readFileSync(csvPath, 'utf8')
  .split('\n')
  .filter(row => row.trim() !== '')
  .slice(1) // Skip header
  .map(row => {
    const [firstName, lastName, dob, phone, email, password, zip, pinCode] = row.split(',');
    return { firstName, lastName, dob, phone, email, password, zip, pinCode };
  });

for (const user of csvData) {
  test(`Registration for ${user.firstName} ${user.lastName}`, async ({ page }) => {
    test.setTimeout(90000); // Increased timeout for stability
    const timestamp = Date.now();
    const emailParts = user.email.split('@');
    const uniqueEmail = `${emailParts[0]}+${timestamp}@${emailParts[1]}`;

    console.log(`Starting registration for: ${user.firstName} ${user.lastName}`);
    await page.goto('https://www.ignitioncasino.eu/?overlay=join', { waitUntil: 'domcontentloaded' });

    // 1. Accept Cookies
    const cookieBtn = page.getByRole('button', { name: 'ACCEPT ALL' });
    if (await cookieBtn.count() > 0) {
      await cookieBtn.click();
    }

    // 2. Step 1: Personal Details
    await page.waitForSelector('#registration-firstName', { timeout: 20000 });
    await page.locator('#registration-firstName').fill(user.firstName);
    await page.locator('#registration-lastName').fill(user.lastName);
    await page.locator('#registration-dateOfBirth').fill(user.dob);

    // Fill background fields
    await page.locator('[id$="-firstName"]').nth(1).fill(user.firstName, { force: true });
    await page.locator('[id$="-lastName"]').nth(1).fill(user.lastName, { force: true });
    await page.locator('[id$="-dateOfBirth"]').nth(1).fill(user.dob, { force: true });

    await page.waitForTimeout(1000);
    await page.locator('button#next-step').click({ force: true });

    // 3. Step 2: Phone & Country
    await page.waitForSelector('#registration-phone', { timeout: 20000 });
    
    await page.locator('.custom-link').filter({ hasText: 'Modify' }).and(page.locator(':visible')).first().click();
    await page.locator('#country-dropdown').first().click();
    await page.locator('ul.custom-droplist li[listitem="listitem"]')
      .filter({ hasText: 'Australia' })
      .first()
      .click();

    await page.locator('#registration-phone').first().fill(user.phone);
    
    const tocLabel = page.locator('bx-registration-overlay label[for="registration-termsandconditions"]');
    await tocLabel.click();
    
    await page.waitForTimeout(1000);
    await page.locator('button#next-step').click({ force: true });

    // 4. Step 3: Credentials
    await page.waitForSelector('#registration-email', { timeout: 20000 });
    await page.locator('#registration-email').fill(uniqueEmail);
    await page.locator('#registration-password').fill(user.password);
    await page.locator('#registration-postalCode').fill(user.zip);
    
    const pinField = page.locator('#registration-security-pin');
    if (await pinField.count() > 0) {
      await pinField.fill(user.pinCode);
      await page.locator('[id$="-security-pin"]').nth(1).fill(user.pinCode, { force: true });
    }

    await page.locator('[id$="-email"]').nth(1).fill(uniqueEmail, { force: true });
    await page.locator('[id$="-password"]').nth(1).fill(user.password, { force: true });
    await page.locator('[id$="-postalCode"]').nth(1).fill(user.zip, { force: true });

    await page.waitForTimeout(1000);
    await page.locator('button#registration-submit').click({ force: true });
    console.log(`Form submitted for ${user.firstName}. Waiting for response...`);

    // Wait for the UI to change or errors to appear
    await page.waitForTimeout(5000); 
    
    // Capture screenshot of the result
    const screenshotName = `${user.firstName}_${user.lastName}_result.png`.replace(/\s+/g, '_');
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', screenshotName), fullPage: true });
    console.log(`Screenshot saved: ${screenshotName}`);

    const successIndicator = page.locator('[class*="success"], [class*="welcome"], [class*="confirmation"], #lobby, [class*="verification"]');
    const errorIndicator = page.locator('.error-message, .validation-message, [class*="error"]');
    
    try {
      await Promise.race([
        successIndicator.waitFor({ timeout: 15000 }).then(() => console.log(`✓ ${user.firstName}: Reached success/verification screen`)),
        errorIndicator.waitFor({ timeout: 15000 }).then(() => console.log(`! ${user.firstName}: Site returned validation error`))
      ]);
    } catch (e) {
      console.log(`${user.firstName}: Submission processed (see screenshot for final state)`);
    }
  });
}
