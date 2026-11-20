import { onPhone } from './quality';

// Import URL strings, not images. Never inline the other tier in the startup JS.
const urls = import.meta.glob<string>('../assets/{textures,phone-textures}/**/*.{jpg,jpeg,png,webp}', {
  eager: true, import: 'default', query: '?url&no-inline',
});

export function surfaceUrl(file: string, phone = onPhone()): string | undefined {
  return urls[`../assets/${phone ? 'phone-textures' : 'textures'}/${file}`];
}

/** A permit covers fetching as well as decoding, so blobs don't pile up waiting for a decoder. */
export function decodeQueue(limit: number) {
  let available = limit;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (available) available--;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else available++;
    }
  };
}

export const decodeTexture = decodeQueue(3);
