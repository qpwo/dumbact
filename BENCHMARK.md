# Benchmark results

These numbers are produced by `npm run test:bench` or `npm test` in Chromium on this machine. They are not universal performance claims. They are a reproducible smoke benchmark that catches obvious regressions.

| case | median / min / max |
|---|---|
| rows | 1200 |
| direct DOM initial render | 6.8 / 6.4 / 7.6 ms |
| Dumbact initial render | 10 / 7.6 / 48.6 ms |
| Dumbact single text update | 6.8 / 3.2 / 16.3 ms |
| Dumbact keyed reverse | 7.4 / 5.7 / 20.9 ms |
| Dumbact append 100 | 16.7 / 14.6 / 23.2 ms |

Browser:

```
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.0.0 Safari/537.36
```
