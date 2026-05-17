import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.VITE_KOVAHUB_API_URL ?? "http://127.0.0.1:48787";

type SessionResponse = {
  token: string;
  user: {
    handle: string;
  };
};

async function waitForApi(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBase}/readyz`).catch(() => null);
      return response?.status() ?? 0;
    })
    .toBe(200);
}

async function createSession(request: APIRequestContext, handle = "tester") {
  const response = await request.post(`${apiBase}/api/v1/e2e/session`, {
    data: {
      handle,
      displayName: "KovaHub E2E Tester",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as SessionResponse;
}

async function installSession(page: Page, token: string) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem("kovahub.authToken", authToken);
  }, token);
}

async function publishPackage(request: APIRequestContext, token: string, packageName: string) {
  const response = await request.post(`${apiBase}/api/v1/packages`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    data: {
      name: packageName,
      displayName: "E2E Moderation Package",
      family: "code-plugin",
      version: "0.1.0",
      summary: "Package created by the Playwright moderation flow.",
      compatibility: {
        pluginApi: "^1.0.0",
        minGatewayVersion: "2026.3.0",
      },
      files: [
        {
          path: "README.md",
          content: "# E2E Moderation Package\n",
          contentType: "text/markdown",
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.describe("KovaHub marketplace flows", () => {
  test.beforeEach(async ({ request }) => {
    await waitForApi(request);
  });

  test("publishes a composed plugin and shows it on the dashboard", async ({ page, request }) => {
    const { token } = await createSession(request);
    const suffix = `${Date.now()}-${test.info().parallelIndex}`;
    const packageName = `@tester/e2e-plugin-${suffix}`;
    const displayName = `E2E Plugin ${suffix}`;

    await installSession(page, token);
    await page.goto("/publish");

    await expect(page.getByRole("heading", { name: "Publish Package" })).toBeVisible();
    await page.getByLabel("Package name").fill(packageName);
    await page.getByLabel("Display name").fill(displayName);
    await page.getByRole("textbox", { name: "Version", exact: true }).fill("0.1.0");
    await page.getByLabel("Summary").fill("Published by the Playwright compose flow.");
    await page.getByLabel("pluginApi").fill("^1.0.0");
    await page.getByLabel("minGatewayVersion").fill("2026.3.0");
    await page.getByLabel("Package content").fill("# E2E Plugin\n\nRendered from the compose flow.");
    await page.getByRole("button", { name: "Publish latest" }).click();

    await expect(page).toHaveURL(new RegExp(`/packages/${encodeURIComponent(packageName)}`));
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "@tester" })).toBeVisible();
    await expect(page.getByText(displayName)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Publish Tokens" })).toBeVisible();
  });

  test("approves a device login from the browser", async ({ page, request }) => {
    const { token } = await createSession(request);
    const start = await request.post(`${apiBase}/api/v1/auth/device/start`, {
      data: { clientName: "Playwright CLI" },
    });
    expect(start.status(), await start.text()).toBe(200);
    const challenge = (await start.json()) as { deviceCode: string; userCode: string };

    await installSession(page, token);
    await page.goto(`/auth/device?user_code=${encodeURIComponent(challenge.userCode)}`);

    await expect(page.getByRole("heading", { name: "Approve device login" })).toBeVisible();
    await page.getByRole("button", { name: "Approve login" }).click();
    await expect(page.getByText("Playwright CLI is connected.")).toBeVisible();

    const poll = await request.post(`${apiBase}/api/v1/auth/device/token`, {
      data: { deviceCode: challenge.deviceCode },
    });
    expect(poll.status(), await poll.text()).toBe(200);
    expect((await poll.json()).accessToken).toMatch(/^khp_/);
  });

  test("reviews a package report from the dashboard moderation queue", async ({ page, request }) => {
    const { token } = await createSession(request);
    const suffix = `${Date.now()}-${test.info().parallelIndex}`;
    const packageName = `@tester/e2e-review-${suffix}`;
    await publishPackage(request, token, packageName);

    const report = await request.post(`${apiBase}/api/v1/packages/${encodeURIComponent(packageName)}/report`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      data: {
        reason: "E2E moderation review.",
      },
    });
    expect(report.status(), await report.text()).toBe(201);

    await installSession(page, token);
    await page.goto("/dashboard");

    const reportRow = page.locator(".moderation-row").filter({ hasText: packageName });
    await expect(reportRow).toContainText("E2E moderation review.");
    await reportRow.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Moderation report updated.")).toBeVisible();
    await expect(reportRow).toHaveCount(0);
  });
});
