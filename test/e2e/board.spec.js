import { test, expect } from '@playwright/test';

async function register(page) {
  const email = `user-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Test User');
  await page.getByLabel('Age (optional)').fill('28');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('test-board-password');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  return email;
}
async function login(page, email) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('test-board-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
}
test('two browser sessions synchronize task creation, completion and deletion', async ({
  page,
  browser
}) => {
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    const email = await register(page);
    await login(second, email);
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
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
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
  await page.getByLabel('Email', { exact: true }).fill('missing@example.com');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Incorrect email or password'
  );
  await register(page);
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
    route.fulfill({
      json: {
        authenticated: true,
        user: { id: 'test-user', name: 'Test User' }
      }
    })
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
  await expect(page.getByText('A fresh start for you')).toBeVisible();
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

test('different accounts have private boards and retain tasks after login', async ({
  page,
  browser
}) => {
  const otherContext = await browser.newContext();
  try {
    const email = await register(page);
    await page.getByLabel('New task').fill('Private task for Alice');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByTestId('task-row')).toContainText(
      'Private task for Alice'
    );
    const other = await otherContext.newPage();
    await register(other);
    await expect(other.getByText('A fresh start for you')).toBeVisible();
    await other.getByLabel('New task').fill('Private task for Bob');
    await other.getByRole('button', { name: 'Add task' }).click();
    await expect(other.getByTestId('task-row')).toHaveCount(1);
    await expect(other.getByTestId('task-row')).toContainText(
      'Private task for Bob'
    );
    await page.reload();
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(page.getByTestId('task-row')).toContainText(
      'Private task for Alice'
    );
    await page.getByRole('button', { name: 'Sign out' }).click();
    await login(page, email);
    await expect(page.getByTestId('task-row')).toContainText(
      'Private task for Alice'
    );
  } finally {
    await otherContext.close();
  }
});
