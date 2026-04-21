const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log('Navigating to sms24.me...');
    await page.goto('https://sms24.me/en/countries/au', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'sms24_debug.png' });
    console.log('Screenshot saved to sms24_debug.png');
    const content = await page.content();
    console.log('Page title:', await page.title());
    if (content.includes('Cloudflare') || content.includes('Verify you are human')) {
        console.log('Cloudflare protection detected');
    }
  } catch (e) {
    console.error('Failed to load sms24.me:', e);
  } finally {
    await browser.close();
  }
})();
