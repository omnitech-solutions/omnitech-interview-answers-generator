// The one place the account flow leaves the page (a seam for tests, since a
// browser's location cannot be replaced).
export const goTo = (url: string) => window.location.assign(url);
