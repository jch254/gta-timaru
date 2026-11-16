/** Resolves when the promise does, or after `ms` regardless: a fade that never settles must not lock a shop or freeze the player. */
export function settle(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}
