import { test, expect } from '@playwright/test';

const testPw = 'password123';

test('register flow lands on dashboard', async ({ page }) => {
  const testEmail = `e2e-${Date.now()}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(testEmail);
  await page.getByLabel('Password').fill(testPw);
  // Register page button says "Create account"
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByText(/Welcome/)).toBeVisible();
});

test('login after sign out works', async ({ page }) => {
  const uniqueEmail = `e2e-flow-${Date.now()}@example.com`;

  // Register first
  await page.goto('/register');
  await page.getByLabel('Name').fill('Flow Test');
  await page.getByLabel('Email').fill(uniqueEmail);
  await page.getByLabel('Password').fill(testPw);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL('/');

  // Sign out
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL('/login');

  // Log back in
  await page.getByLabel('Email').fill(uniqueEmail);
  await page.getByLabel('Password').fill(testPw);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText(/Welcome/)).toBeVisible();
});
