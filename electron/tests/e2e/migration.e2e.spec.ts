import { expect } from '@playwright/test'

import { test, page } from '../config/fixtures'
import { seedMessages } from '../seeds/seed-message'

test('shows settings', async () => {
    await seedMessages();
    await page.waitForTimeout(3000)
    await page.click('text=Migrate Now')
    await page.waitForTimeout(10000)
    await page.click('text=Done')
    const response = await page.request.get('http://127.0.0.1:1338/v1/threads')
      // Check if the API call was successful
      expect(response.ok()).toBeTruthy();
      const responseBody = await response.json();
      console.log(responseBody, 'sdfsdfsfsdf')
      expect(responseBody).toEqual(
        {
            "object": "list",
            "data": [
                {
                    "id": "4deea5fe-9766-498f-91c5-3101cc12281f",
                    "object": "thread",
                    "title": "New Thread",
                    "assistants": [
                        {
                            "id": "jan",
                            "avatar": "",
                            "object": "assistant",
                            "created_at": 1723493515016,
                            "name": "Jan",
                            "description": "A default assistant that can use all downloaded models",
                            "model": "tinyllama-1.1b",
                            "instructions": "",
                            "tools": [],
                            "metadata": null,
                            "top_p": null,
                            "temperature": null,
                            "response_format": null,
                            "tool_resources": null
                        }
                    ],
                    "created_at": 1723494396235,
                    "tool_resources": null,
                    "metadata": null
                },
                {
                    "id": "0e6ff465-c1fe-4c10-88ea-df83caabd9e1",
                    "object": "thread",
                    "title": "New Thread",
                    "assistants": [
                        {
                            "id": "jan",
                            "avatar": "",
                            "object": "assistant",
                            "created_at": 1723493515016,
                            "name": "Jan",
                            "description": "A default assistant that can use all downloaded models",
                            "model": "claude-3-opus-20240229",
                            "instructions": "",
                            "tools": [],
                            "metadata": null,
                            "top_p": null,
                            "temperature": null,
                            "response_format": null,
                            "tool_resources": null
                        }
                    ],
                    "created_at": 1723494396206,
                    "tool_resources": null,
                    "metadata": null
                }
            ],
            "first_id": "1723494396235_4deea5fe-9766-498f-91c5-3101cc12281f",
            "last_id": "1723494396206_0e6ff465-c1fe-4c10-88ea-df83caabd9e1",
            "has_more": false
        })
    const threads = responseBody.data;
    for (const thread of threads) {
        const response = await page.request.get(`http://127.0.0.1:1338/v1/threads/${thread.id}/messages`)
        expect(response.ok()).toBeTruthy();
        const messageResponseBody = await response.json();
        console.log(messageResponseBody, 'messageee')
    }
})
