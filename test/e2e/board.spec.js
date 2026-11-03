import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Workspace password').fill('test-board-password');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
}
test('two browser sessions synchronize task creation, completion and deletion', async ({ page, browser }) => {
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await login(page);
    await second.goto(process.env.E2E_BASE_URL || 'http://127.0.0.1:3011');
    await second.getByLabel('Workspace password').fill('test-board-password');
    await second.getByRole('button', { name: 'Open workspace' }).click();
    await expect(second.getByText('Live updates', { exact: true })).toBeVisible();
    const title = `Live browser task ${Date.now()}`;
    await page.getByLabel('New task').fill(title);
    await page.getByRole('button', { name: 'Add task' }).click();
    const otherRow = second.getByTestId('task-row').filter({ hasText: title });
    await expect(otherRow).toBeVisible();
    await otherRow.getByRole('checkbox').click();
    await expect(otherRow.getByRole('checkbox')).toBeChecked();
    const firstRow = page.getByTestId('task-row').filter({ hasText: title });
    await expect(firstRow.getByRole('checkbox')).toBeChecked();
    await page.getByRole('button', { name: 'To do', exact: true }).click();
    await expect(firstRow).toHaveCount(0);
    await page.getByRole('button', { name: 'All tasks', exact: true }).click();
    await firstRow.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    await firstRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(otherRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Workspace password')).toBeVisible();
    await expect(second.getByLabel('New task')).toBeVisible();
  } finally { await secondContext.close(); }
});

test('mobile board loads and invalid login stays protected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Workspace password').fill('incorrect');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');
  await login(page);
  await expect(page.getByLabel('New task')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
