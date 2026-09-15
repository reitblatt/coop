# Coop resource measurement — devstack-observed

## Processes — devstack-idle

Total RSS: mean 1332.3 MiB, max 2521.1 MiB, trend -244.34 MiB/min over 394.5s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 198.6 | 466.3 | 148.7 | 11 | 32 | 0.5 | -40.66 |
| concurrently | 1 | 50.2 | 51.2 | 5.9 | 7 | 31 | 0 | -0.2 |
| esbuild-service | 1 | 23.6 | 31.1 | 23.6 | 34 | 5 | 0.2 | -2.04 |
| graphql-codegen-watch | 1 | 96 | 189.4 | 48.8 | 13 | 25 | 0 | -20.12 |
| npm | 5 | 50.2 | 51.7 | 4.5 | 11 | 22 | 0 | -0.16 |
| shell | 8 | 1.8 | 1.9 | 0.1 | 1 | 3 | 0 | 0 |
| tsc-watch(compiler) | 1 | 547.7 | 1293.3 | 502.1 | 11 | 22 | 0.4 | -162.98 |
| tsc-watch(wrapper) | 1 | 40.2 | 43.2 | 4.1 | 7 | 24 | 0 | -0.65 |
| vite-dev-server | 1 | 117.3 | 177.7 | 65.3 | 11 | 25 | 0.2 | -14.4 |

