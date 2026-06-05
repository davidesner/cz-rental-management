import { test, expect } from '@playwright/test';

test('create a property', async ({ page }) => {
  const email = `e2e-prop-${Date.now()}@example.com`;

  // Register a fresh user
  await page.goto('/register');
  await page.getByLabel('Name').fill('Prop User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL('/');

  // Create an org via the API (required before properties can be created)
  await page.evaluate(async () => {
    await fetch('/api/organizations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Org' }),
    });
  });

  // Reload to pick up org context in the UI
  await page.reload();

  // Navigate to Properties
  await page.getByRole('link', { name: 'Properties' }).click();
  await expect(page).toHaveURL('/properties');

  // Open "New property" modal
  await page.getByRole('button', { name: /new property/i }).click();

  // The modal has three text inputs in order: Name, Address, Reconciliation skill.
  // Labels don't have htmlFor, so we target inputs by order within the modal card.
  const modal = page.locator('.fixed.inset-0').locator('[class*="max-w-md"]');
  const inputs = modal.getByRole('textbox');
  await inputs.nth(0).fill('<property-name-a>');    // Name
  await inputs.nth(1).fill('Praha');           // Address
  await inputs.nth(2).fill('reference-reconciliation'); // Reconciliation skill

  await modal.getByRole('button', { name: 'Create' }).click();

  // The property should appear in the table
  await expect(page.getByText('<property-name-a>')).toBeVisible();
});
