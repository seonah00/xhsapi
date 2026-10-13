import { expect, type Page, type Locator } from '@playwright/test';
/** Retired workflows remain covered through their API, without restoring removed UI buttons. */
export async function createLegacyReference(page: Page, card: Locator) {
  const href=await card.locator('a[href^="/app/notes/"]').first().getAttribute('href');
  const noteId=href?.match(/\/app\/notes\/([0-9a-f-]{36})/)?.[1];
  expect(noteId).toBeTruthy();
  const response=await page.request.post('/api/v1/references',{headers:{origin:new URL(page.url()).origin},data:{sourceType:'saved_note',noteId}});
  expect(response.status()).toBe(201);
  const result=await response.json();
  await page.goto(`/app/references/${result.data.id}`);
}
