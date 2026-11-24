/**
 * GitHub's CI machines have no GPU, so the 3D pages render in software and are very slow there.
 * On CI, every page gets a longer default wait (clicks, waits, page loads); elsewhere Playwright's
 * usual 30 s stands. Explicit per-call timeouts in the tests are unchanged.
 */
const WAIT = process.env.CI ? 120_000 : 30_000;
const patient = (ctx) => {
  ctx.setDefaultTimeout(WAIT);
  ctx.setDefaultNavigationTimeout(WAIT);
  return ctx;
};
export function patientBrowser(browser) {
  const newContext = browser.newContext.bind(browser),
    newPage = browser.newPage.bind(browser);
  browser.newContext = async (o) => patient(await newContext(o));
  browser.newPage = async (o) => {
    const page = await newPage(o);
    patient(page.context());
    page.setDefaultTimeout(WAIT);
    page.setDefaultNavigationTimeout(WAIT);
    return page;
  };
  return browser;
}
