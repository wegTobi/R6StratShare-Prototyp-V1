async page => {
  const origin = new URL(page.url()).origin;
  await page.goto(origin);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.getByRole('link', { name: 'Strat Editor', exact: true }).click();
  await page.getByRole('button', { name: 'Start Editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Role', exact: true }).fill('Selfhost anchor');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep the stairs covered.');
  await page.getByRole('button', { name: 'Smoke', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByPlaceholder('Strat name...').fill('Selfhost smoke test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const json = await page.evaluate(() => navigator.clipboard.readText());
  if (!json.includes('Selfhost anchor') || !json.includes('Keep the stairs covered.') || !json.includes('smoke')) throw new Error('Editor export lost player data');
  await page.getByRole('link', { name: 'View Strat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste strat JSON' }).fill(json);
  await page.getByRole('button', { name: 'Load Strat', exact: true }).click();
  await page.getByText('Selfhost smoke test', { exact: true }).first().waitFor();
  const brokenImages = await page.locator('img').evaluateAll(images => images.filter(image => image.offsetParent && image.complete && image.naturalWidth === 0).map(image => image.src));
  if (brokenImages.length) throw new Error('Broken images: ' + brokenImages.join(', '));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('heading', { name: 'Accounts are not available on this server yet.', exact: true }).waitFor();
  if (await page.getByRole('link', { name: 'Sign in with ChatGPT' }).count()) throw new Error('Selfhost exposes a broken login');
  console.log('PASS: editor hydration, role/notes/operator, JSON copy and viewer import, visible images, disabled accounts');
}
