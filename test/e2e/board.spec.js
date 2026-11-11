import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Workspace password').fill('test-board-password');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
}
test('two browser sessions synchronize task creation, completion and deletion', async ({
  page,
  browser
}) => {
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await login(page);
    await second.goto(process.env.E2E_BASE_URL || 'http://127.0.0.1:3011');
    await second.getByLabel('Workspace password').fill('test-board-password');
    await second.getByRole('button', { name: 'Open workspace' }).click();
    await expect(
      second.getByText('Live updates', { exact: true })
    ).toBeVisible();
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
    await firstRow
      .getByRole('button', { name: `Delete ${title}`, exact: true })
      .click();
    await firstRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(otherRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Workspace password')).toBeVisible();
    await expect(second.getByLabel('New task')).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test('mobile board loads and invalid login stays protected', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Workspace password').fill('incorrect');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');
  await login(page);
  await expect(page.getByLabel('New task')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('board loads and creates tasks when live updates are unavailable', async ({
  page
}) => {
  const tasks = [];
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { authenticated: true, authDisabled: true } })
  );
  await page.route('**/api/version', (route) =>
    route.fulfill({
      json: { version: 'test', environment: 'test', revision: 'test' }
    })
  );
  await page.route('**/api/events', (route) => route.abort());
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      const task = {
        id: 'test-task',
        ...route.request().postDataJSON(),
        completed: false,
        createdAt: new Date().toISOString()
      };
      tasks.push(task);
      await route.fulfill({ status: 201, json: task });
    } else {
      await route.fulfill({ json: tasks });
    }
  });
  await page.goto('/');
  await expect(page.getByText('A fresh start for your team')).toBeVisible();
  const add = page.getByRole('button', { name: 'Add task' });
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS('cursor', 'not-allowed');
  await expect(add).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('New task').fill('Create without live updates');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByTestId('task-row')).toContainText(
    'Create without live updates'
  );
  await expect(page.getByLabel('New task')).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
