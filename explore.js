const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.ignitioncasino.eu/welcome-gift');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'initial_load.png' });
  
  const joinButton = page.getByRole('link', { name: 'Join', exact: true }).or(page.getByRole('button', { name: 'Join', exact: true }));
  if (await joinButton.count() > 0) {
      console.log('Join button found');
      await joinButton.first().click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'after_join_click.png' });
  } else {
      console.log('Join button not found');
  }

  await browser.close();
})();
