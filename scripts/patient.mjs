/**
 * GitHub's CI machines have no GPU, so the 3D pages render in software and are very slow there
 * (and their speed varies a lot from run to run). On CI, every page gets a much longer default
 * wait (clicks, waits, page loads); elsewhere Playwright's usual 30 s stands. Page loads wait for
 * the HTML to be parsed, not the full "load" event: every test then waits for the element it
 * needs. Explicit per-call timeouts in the tests are stretched with `slow()`.
 */
const WAIT = process.env.CI ? 240_000 : 30_000;
const patientPage = (page) => {
  page.setDefaultTimeout(WAIT);
  page.setDefaultNavigationTimeout(WAIT);
  const goto = page.goto.bind(page);
  page.goto = (url, o = {}) => goto(url, { waitUntil: "domcontentloaded", ...o });
  return page;
};
const patient = (ctx) => {
  ctx.setDefaultTimeout(WAIT);
  ctx.setDefaultNavigationTimeout(WAIT);
  const newPage = ctx.newPage.bind(ctx);
  ctx.newPage = async (...a) => patientPage(await newPage(...a));
  return ctx;
};
export function patientBrowser(browser) {
  const newContext = browser.newContext.bind(browser),
    newPage = browser.newPage.bind(browser);
  browser.newContext = async (o) => patient(await newContext(o));
  browser.newPage = async (o) => {
    const page = await newPage(o);
    patient(page.context());
    return patientPage(page);
  };
  return browser;
}

/** A fixed wait in a test, stretched 4× on CI for the same reason. */
export const slow = (ms) => (process.env.CI ? ms * 4 : ms);
