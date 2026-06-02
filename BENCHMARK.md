# Benchmark results

These numbers are produced by `npm run test:bench` or `npm test` in Chromium on this machine. They are not universal performance claims. They are a reproducible smoke benchmark that catches obvious regressions.

| case | median / min / max |
|---|---|
| rows | 1200 |
| direct DOM initial render | 0.6 / 0.4 / 1.3 ms |
| Dumbact initial render | 1.3 / 1 / 5.4 ms |
| Dumbact single text update | 0.8 / 0.8 / 2.3 ms |
| Dumbact keyed reverse | 1 / 0.8 / 1.5 ms |
| Dumbact append 100 | 2 / 1.8 / 2.1 ms |

Browser:

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36
```
